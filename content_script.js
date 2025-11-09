// content_script.js
// Lightweight engagement tracker + content-type heuristics.
// Sends occasional aggregated engagement messages to background.
// Rate-limited to avoid too many messages.

(function () {
  const SEND_INTERVAL_MS = 5000; // how often to send accumulated engagement (every 5s)
  let active = document.visibilityState === 'visible' && document.hasFocus();
  let lastChange = Date.now();
  let accumulatedMs = 0;
  let lastSend = Date.now();
  let contextInvalidated = false; // Flag to stop all messaging attempts
  let currentPostTitle = ''; // Track current post title to detect changes
  let lastPostTitle = ''; // Track last sent post title
  let settings = {
    enableTracking: false,
    includeTitles: false
  };

  function loadSettings() {
    try {
      chrome.storage.local.get(['settings'], (res) => {
        const stored = res?.settings || {};
        settings = {
          enableTracking: stored.enableTracking === true,
          includeTitles: stored.includeTitles === true
        };
      });
    } catch (err) {
      console.error('[Horizon] Failed to load settings:', err);
    }
  }

  // React to option updates without page reload
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const newSettings = changes.settings.newValue || {};
    settings = {
      enableTracking: newSettings.enableTracking === true,
      includeTitles: newSettings.includeTitles === true
    };
    if (!settings.includeTitles) {
      currentPostTitle = '';
      lastPostTitle = '';
    }
  });

  loadSettings();

  // simple content type detection (heuristic)
  function detectContentType() {
    try {
      if (document.querySelector('video')) return 'video';
      const imgs = document.querySelectorAll('img').length;
      if (imgs > 10) return 'gallery';
      const bodyText = (document.body && document.body.innerText) || '';
      const trimmed = bodyText.trim();
      if (trimmed.length > 3000) return 'long_read';
      if (trimmed.length > 800) return 'article';
      return 'short_text';
    } catch (err) {
      return 'unknown';
    }
  }

  // Extract post title/metadata from social media platforms (TOS-compliant: only titles and metadata)
  function extractPostTitle() {
    try {
      const hostname = location.hostname.toLowerCase();
      const pathname = location.pathname.toLowerCase();
      
      // Twitter/X: Extract from meta tags or article elements
      if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
        // Check if we're on an individual post page (has /status/ in URL)
        const isIndividualPost = pathname.includes('/status/');
        
        // Try meta tags first (most reliable, TOS-compliant)
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.content) {
          let title = ogTitle.content.trim();
          // Remove site name suffix if present
          title = title.replace(/\s*\/\s*X$|\s*on X$|\s*on Twitter$/i, '').trim();
          // Only use if it's meaningful (not just "Home / X")
          if (title && title.length > 5 && !title.match(/^(Home|Explore|Notifications|Messages|Profile)/i)) {
            return title;
          }
        }
        
        // Try Twitter card meta
        const twitterTitle = document.querySelector('meta[name="twitter:title"]');
        if (twitterTitle && twitterTitle.content) {
          const title = twitterTitle.content.trim();
          if (title && title.length > 5) {
            return title;
          }
        }
        
        // For individual post pages, try to get tweet text from article
        if (isIndividualPost) {
          const tweetArticle = document.querySelector('article[data-testid="tweet"]');
          if (tweetArticle) {
            // Extract text from tweet text span (first level text content)
            const tweetText = tweetArticle.querySelector('[data-testid="tweetText"]');
            if (tweetText) {
              const text = tweetText.textContent.trim().substring(0, 200);
              if (text && text.length > 5) {
                return text;
              }
            }
          }
        }
      }
      
      // Reddit: Extract from meta tags or post title elements
      if (hostname.includes('reddit.com')) {
        // Check if we're on an individual post page (has /r/ and /comments/ in URL)
        const isIndividualPost = pathname.includes('/r/') && pathname.includes('/comments/');
        
        // Try meta tags first
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.content) {
          const title = ogTitle.content.trim();
          // Remove "posted in r/..." suffix if present
          const cleaned = title.replace(/\s*:\s*.*$/, '').trim();
          if (cleaned && cleaned.length > 5) {
            return cleaned;
          }
        }
        
        // Try Reddit-specific meta
        const twitterTitle = document.querySelector('meta[name="twitter:title"]');
        if (twitterTitle && twitterTitle.content) {
          const title = twitterTitle.content.trim();
          if (title && title.length > 5) {
            return title;
          }
        }
        
        // For individual posts, try to get post title from common containers
        if (isIndividualPost) {
          const postTitle = document.querySelector('h1[data-testid="post-content"]') ||
                           document.querySelector('h2[data-testid="post-content"]') ||
                           document.querySelector('h3[data-testid="post-content"]') ||
                           document.querySelector('a[data-testid="post-title"]') ||
                           document.querySelector('[slot="title"]');
          if (postTitle) {
            const text = postTitle.textContent.trim().substring(0, 200);
            if (text && text.length > 5) {
              return text;
            }
          }
        }
      }
      
      // Instagram: Extract from meta tags
      if (hostname.includes('instagram.com')) {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.content) {
          return ogTitle.content.trim();
        }
        
        const ogDescription = document.querySelector('meta[property="og:description"]');
        if (ogDescription && ogDescription.content) {
          return ogDescription.content.trim().substring(0, 200);
        }
      }
      
      // Fallback: Use page title or meta description
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle && ogTitle.content) {
        return ogTitle.content.trim();
      }
      
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription && metaDescription.content) {
        return metaDescription.content.trim().substring(0, 200);
      }
      
      // Last resort: page title
      return document.title || '';
    } catch (err) {
      console.error('[Horizon] Error extracting post title:', err);
      return document.title || '';
    }
  }

  function sendEngagement(deltaMs) {
    if (!settings.enableTracking || deltaMs <= 0) {
      accumulatedMs = 0;
      return;
    }

    // If context is already invalidated, don't try to send
    if (contextInvalidated) {
      return;
    }
    
    // Safely check if extension runtime is still available
    let runtimeAvailable = false;
    try {
      runtimeAvailable = chrome && chrome.runtime && chrome.runtime.id;
    } catch (e) {
      // Accessing chrome.runtime itself can throw if context is invalidated
      contextInvalidated = true;
      return;
    }
    
    if (!runtimeAvailable) {
      contextInvalidated = true;
      return;
    }
    
    // Build payload safely (don't access chrome.runtime here)
    // Extract post title/metadata (TOS-compliant: only reads titles and metadata)
    currentPostTitle = settings.includeTitles ? extractPostTitle() : '';
    
    // Only send if we have meaningful content (not just page title like "Home / X")
    const meaningfulTitle = settings.includeTitles &&
                           currentPostTitle &&
                           currentPostTitle.length > 5 &&
                           !currentPostTitle.match(/^(Home|Explore|Notifications|Messages|Profile)/i);
    
    const payload = {
      type: 'engagement_time',
      domain: location.hostname,
      deltaMs,
      contentType: detectContentType(),
      capturedAt: Date.now()
    };
    
    if (meaningfulTitle) {
      payload.title = currentPostTitle;
    }
    
    // Log for debugging (only if meaningful title found)
    if (meaningfulTitle && currentPostTitle !== lastPostTitle) {
      console.log('[Horizon] Tracking post:', currentPostTitle.substring(0, 50) + '...');
      lastPostTitle = currentPostTitle;
    }
    
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        // Handle extension context invalidation
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || '';
          if (errorMsg.includes('Extension context invalidated') || 
              errorMsg.includes('message port closed') ||
              errorMsg.includes('Could not establish connection')) {
            // Extension was reloaded - stop trying to send messages
            contextInvalidated = true;
            console.log('[Horizon] Extension context invalidated. Please refresh the page to resume tracking.');
            return;
          }
          // Other errors (service worker may be asleep) - ignore
        }
        if (response?.success && response.embeddingHash) {
          console.log('[Horizon] Embedding cached with hash:', response.embeddingHash);
        }
      });
    } catch (error) {
      // Catch any runtime errors (e.g., extension context invalidated)
      const errorMsg = error.message || '';
      if (errorMsg.includes('Extension context invalidated') ||
          errorMsg.includes('message port closed') ||
          errorMsg.includes('Could not establish connection')) {
        contextInvalidated = true;
        console.log('[Horizon] Extension context invalidated. Please refresh the page to resume tracking.');
      }
      // Silently ignore other errors
    }
  }

  function updateState(isActive) {
    const now = Date.now();
    if (active) {
      accumulatedMs += now - lastChange;
    }
    active = isActive;
    lastChange = now;

    // keep periodic sends to avoid large in-memory accumulation
    if (Date.now() - lastSend > SEND_INTERVAL_MS && accumulatedMs > 0) {
      sendEngagement(accumulatedMs);
      accumulatedMs = 0;
      lastSend = Date.now();
    }
  }

  // event listeners to detect engagement
  document.addEventListener('visibilitychange', () => updateState(document.visibilityState === 'visible'));
  window.addEventListener('focus', () => updateState(true));
  window.addEventListener('blur', () => updateState(false));
  ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, () => {
      if (!active) updateState(true);
    }, { passive: true })
  );

  // periodic flush (sends even if no focus change)
  // Also check for post changes on single-page apps
  setInterval(() => {
    const now = Date.now();
    if (active) {
      accumulatedMs += now - lastChange;
      lastChange = now;
      
      // Check if post title changed (for single-page apps)
      if (settings.includeTitles) {
        const newPostTitle = extractPostTitle();
        if (newPostTitle && newPostTitle !== currentPostTitle && newPostTitle.length > 5) {
          // Post changed, send accumulated time for previous post
          if (accumulatedMs > 0) {
            sendEngagement(accumulatedMs);
            accumulatedMs = 0;
            lastSend = Date.now();
          }
          currentPostTitle = newPostTitle;
        }
      }
    }
    if (accumulatedMs > 0 && Date.now() - lastSend > SEND_INTERVAL_MS) {
      sendEngagement(accumulatedMs);
      accumulatedMs = 0;
      lastSend = Date.now();
    }
  }, SEND_INTERVAL_MS);

  // final flush on unload
  window.addEventListener('beforeunload', () => {
    if (contextInvalidated) {
      return;
    }
    
    const now = Date.now();
    if (active) {
      accumulatedMs += now - lastChange;
    }
    if (accumulatedMs > 0) {
      // Use sendEngagement which has proper error handling
      sendEngagement(accumulatedMs);
    }
  });
})();
