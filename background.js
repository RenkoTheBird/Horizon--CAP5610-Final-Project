// background.js  — now safe for MV3 service worker
import { SimpleClassifier } from './simple-classifier.js';

let classifierCache = null;

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
    totalMs: 0
  };
  
  // Initialize byTopic if not present (for backward compatibility)
  if (!existing.byTopic) {
    existing.byTopic = {};
  }
  if (!existing.byTopicCounts) {
    existing.byTopicCounts = {};
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
    totalMs: 0
  };
  
  // Ensure byTopic exists for backward compatibility
  if (!summary.byTopic) {
    summary.byTopic = {};
  }
  if (!summary.byTopicCounts) {
    summary.byTopicCounts = {};
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
      try {
        console.log('[Horizon] Settings check:', { enableML: settings.enableML });
        
        if (settings.enableML) {
          const title = msg.title || '';
          console.log('[Horizon] Title received:', title.substring(0, 100));
          
          if (title && title.length > 5) {
            const classificationResult = await classifyText(title);
            topic = typeof classificationResult === 'string' ? classificationResult : (classificationResult?.category || classificationResult);
            console.log('[Horizon] Final topic:', topic, 'from result:', classificationResult);
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
      await storeEngagement({ ...msg, topic });
      if (topic) {
        console.log('[Horizon] Stored engagement with topic:', topic, 'for', msg.deltaMs, 'ms');
      } else {
        console.log('[Horizon] Stored engagement without topic');
      }
      sendResponse({ success: true, topic });
    } else if (msg.type === 'get_today_summary') {
      const summary = await getTodaySummary();
      sendResponse(summary);
    }
  })();
  return true; // keep the message channel open for async reply
});
