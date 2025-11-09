// background.js  — now safe for MV3 service worker
import { SimpleClassifier } from './simple-classifier.js';
import { pipeline, env } from './libs/transformers/transformers.min.js';

let classifierCache = null;
let embeddingPipelinePromise = null;
let embeddingCacheLoaded = false;
const embeddingCache = new Map();
const embeddingCacheOrder = [];

const EMBEDDING_CACHE_KEY = 'embedding_cache_v1';
const MAX_EMBEDDING_CACHE_ENTRIES = 20;
const LOCAL_MODEL_ROOT = chrome.runtime.getURL('libs/models');
const LOCAL_MODEL_PATH = chrome.runtime.getURL('libs/models/all-MiniLM-L6-v2');
const LOCAL_WASM_PATH = chrome.runtime.getURL('libs/onnxruntime/');

// Configure transformers.js to operate fully offline with local assets
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = LOCAL_MODEL_ROOT;
env.backends.onnx.wasm.wasmPaths = LOCAL_WASM_PATH;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.simd = true;

async function loadClassifier() {
  if (!classifierCache) {
    try {
      classifierCache = new SimpleClassifier();
      const loaded = await classifierCache.load();
      if (!loaded) {
        console.log('[Horizon] No trained classifier found, using default');
        classifierCache = null;
      }
    } catch (error) {
      console.error('[Horizon] Error loading classifier:', error);
      classifierCache = null;
    }
  }
  return classifierCache;
}

async function classifyText(text) {
  try {
    const classifier = await loadClassifier();
    if (!classifier) {
      console.log('[Horizon] Classifier not loaded - model may not be trained');
      return 'unknown'; // Return default if model not trained
    }

    const result = classifier.classify(text);
    const category = result.category || result;
    console.log('[Horizon] Classification result:', { text: text.substring(0, 50), result, category });
    return category;
  } catch (error) {
    console.error('[Horizon] Classification error:', error);
    return 'unknown';
  }
}

async function loadEmbeddingPipeline() {
  if (!embeddingPipelinePromise) {
    embeddingPipelinePromise = pipeline('feature-extraction', LOCAL_MODEL_PATH);
  }
  return embeddingPipelinePromise;
}

async function hashText(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function loadEmbeddingCacheFromStorage() {
  if (embeddingCacheLoaded) {
    return;
  }
  try {
    const stored = await chrome.storage.local.get([EMBEDDING_CACHE_KEY]);
    const entries = stored[EMBEDDING_CACHE_KEY]?.entries;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (entry.hash && Array.isArray(entry.embedding)) {
          embeddingCache.set(entry.hash, entry.embedding);
          embeddingCacheOrder.push(entry.hash);
        }
      }
    }
  } catch (error) {
    console.error('[Horizon] Failed to load embedding cache:', error);
  } finally {
    embeddingCacheLoaded = true;
  }
}

async function persistEmbeddingCache() {
  const entries = embeddingCacheOrder.map((hash) => ({
    hash,
    embedding: embeddingCache.get(hash)
  }));
  try {
    await chrome.storage.local.set({
      [EMBEDDING_CACHE_KEY]: {
        version: 1,
        entries
      }
    });
  } catch (error) {
    console.error('[Horizon] Failed to persist embedding cache:', error);
  }
}

async function rememberEmbedding(hash, embedding) {
  embeddingCache.set(hash, embedding);
  const existingIndex = embeddingCacheOrder.indexOf(hash);
  if (existingIndex !== -1) {
    embeddingCacheOrder.splice(existingIndex, 1);
  }
  embeddingCacheOrder.push(hash);
  while (embeddingCacheOrder.length > MAX_EMBEDDING_CACHE_ENTRIES) {
    const oldest = embeddingCacheOrder.shift();
    if (oldest) {
      embeddingCache.delete(oldest);
    }
  }
  await persistEmbeddingCache();
}

async function getEmbedding(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) {
    return { embedding: null, hash: null };
  }

  await loadEmbeddingCacheFromStorage();
  const hash = await hashText(normalized);

  if (embeddingCache.has(hash)) {
    return { embedding: embeddingCache.get(hash), hash };
  }

  try {
    const extractor = await loadEmbeddingPipeline();
    const result = await extractor(normalized, {
      pooling: 'mean',
      normalize: true
    });
    const tensorData = Array.isArray(result)
      ? result
      : Array.from(result.data ?? []);
    const embeddingVector = tensorData.map((value) =>
      Number(Number(value).toFixed(6))
    );

    if (!embeddingVector.length) {
      return { embedding: null, hash: null };
    }

    await rememberEmbedding(hash, embeddingVector);
    return { embedding: embeddingVector, hash };
  } catch (error) {
    console.error('[Horizon] Embedding error:', error);
    return { embedding: null, hash: null };
  }
}

// Store engagement data
async function storeEngagement(data) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `day_${today}`;
  
  // Get existing data for today
  const result = await chrome.storage.local.get([key]);
  const existing = result[key] || {
    day: today,
    byDomain: {},
    byContentType: {},
    byTopic: {},
    byTopicCounts: {},
    totalMs: 0,
    embeddingSamples: []
  };
  
  // Initialize byTopic if not present (for backward compatibility)
  if (!existing.byTopic) {
    existing.byTopic = {};
  }
  if (!existing.byTopicCounts) {
    existing.byTopicCounts = {};
  }
  if (!Array.isArray(existing.embeddingSamples)) {
    existing.embeddingSamples = [];
  }
  
  // Update domain
  const domain = data.domain || 'unknown';
  existing.byDomain[domain] = (existing.byDomain[domain] || 0) + data.deltaMs;
  
  // Update content type
  const contentType = data.contentType || 'unknown';
  existing.byContentType[contentType] = (existing.byContentType[contentType] || 0) + data.deltaMs;
  
  // Update topic classification if available
  if (data.topic) {
    const topic = data.topic;
    existing.byTopic[topic] = (existing.byTopic[topic] || 0) + data.deltaMs;
    console.log(`[Horizon] Updated topic ${topic}: ${existing.byTopic[topic]}ms total`);
    existing.byTopicCounts[topic] = (existing.byTopicCounts[topic] || 0) + 1;
  }
  
  if (Array.isArray(data.embedding) && data.embedding.length > 0) {
    const sample = {
      domain,
      contentType,
      topic: data.topic || null,
      hash: data.embeddingHash || null,
      embedding: data.embedding,
      capturedAt: data.capturedAt
    };
    existing.embeddingSamples.push(sample);
    if (existing.embeddingSamples.length > 50) {
      existing.embeddingSamples = existing.embeddingSamples.slice(-50);
    }
  }

  // Update total
  existing.totalMs += data.deltaMs;
  
  // Save back
  await chrome.storage.local.set({ [key]: existing });
  
  console.log(`[Horizon] Stored ${data.deltaMs}ms for ${domain}, total today: ${existing.totalMs}ms`);
}

// Get today's summary
async function getTodaySummary() {
  const today = new Date().toISOString().slice(0, 10);
  const key = `day_${today}`;
  
  const result = await chrome.storage.local.get([key]);
  const summary = result[key] || {
    day: today,
    byDomain: {},
    byContentType: {},
    byTopic: {},
    byTopicCounts: {},
    totalMs: 0,
    embeddingSamples: []
  };
  
  // Ensure byTopic exists for backward compatibility
  if (!summary.byTopic) {
    summary.byTopic = {};
  }
  if (!summary.byTopicCounts) {
    summary.byTopicCounts = {};
  }
  if (!Array.isArray(summary.embeddingSamples)) {
    summary.embeddingSamples = [];
  }
  
  // Debug logging
  console.log('[Horizon] Summary requested:', {
    day: today,
    byTopicKeys: Object.keys(summary.byTopic),
    byTopicValues: summary.byTopic,
    totalMs: summary.totalMs
  });
  
  return summary;
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    
    if (msg.type === 'engagement_time') {
      const { settings } = await chrome.storage.local.get(['settings']);
      if (!settings || settings.enableTracking !== true) {
        console.log('[Horizon] Tracking disabled; engagement message ignored.');
        sendResponse({ success: false, disabled: true });
        return;
      }
      if (settings.includeTitles !== true && msg.title) {
        delete msg.title;
      }
      // Try to classify if ML is enabled (optional)
      let topic = null;
      let embeddingResult = { embedding: null, hash: null };
      try {
        console.log('[Horizon] Settings check:', { enableML: settings.enableML });
        
        if (settings.enableML) {
          const title = msg.title || '';
          console.log('[Horizon] Title received:', title.substring(0, 100));
          
          if (title && title.length > 5) {
            const classificationResult = await classifyText(title);
            topic = typeof classificationResult === 'string' ? classificationResult : (classificationResult?.category || classificationResult);
            console.log('[Horizon] Final topic:', topic, 'from result:', classificationResult);
            embeddingResult = await getEmbedding(title);
          } else {
            console.log('[Horizon] Title too short or empty, skipping classification. Title length:', title.length);
          }
        } else {
          console.log('[Horizon] ML classification not enabled in settings');
        }
      } catch (error) {
        console.error('[Horizon] Error during classification:', error);
        // Continue even if classification fails
      }
      
      // Store the engagement data (with topic if available)
      await storeEngagement({
        ...msg,
        topic,
        embedding: embeddingResult.embedding,
        embeddingHash: embeddingResult.hash
      });
      if (topic) {
        console.log('[Horizon] Stored engagement with topic:', topic, 'for', msg.deltaMs, 'ms');
      } else {
        console.log('[Horizon] Stored engagement without topic');
      }
      sendResponse({ success: true, topic, embeddingHash: embeddingResult.hash });
    } else if (msg.type === 'get_today_summary') {
      const summary = await getTodaySummary();
      sendResponse(summary);
    }
  })();
  return true; // keep the message channel open for async reply
});
