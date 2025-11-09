// options.js
// Wait for page to load and scripts to be available
document.addEventListener('DOMContentLoaded', async () => {
  // Give scripts a moment to load
  await new Promise(resolve => setTimeout(resolve, 100));
  initOptions();
});

// Check and display model training status
async function checkModelStatus(modelData) {
  const trainStatus = document.getElementById('trainStatus');
  if (!trainStatus) return;
  
  // Validate model data structure
  const isValidModel = modelData && 
                       modelData.wordCounts && 
                       typeof modelData.wordCounts === 'object' &&
                       Object.keys(modelData.wordCounts).length > 0 &&
                       modelData.categoryCounts &&
                       typeof modelData.categoryCounts === 'object' &&
                       Object.keys(modelData.categoryCounts).length > 0;
  
  if (isValidModel) {
    // Model exists and appears to be trained
    const categories = modelData.categories || [];
    const uniqueWords = Object.keys(modelData.wordCounts || {}).length;
    const version = modelData.version || 1;
    const totalWords = modelData.totalWords || 0;
    
    // Check if model has expected structure
    const hasAllCategories = categories.length >= 4; // Should have at least politics, sports, tech, entertainment
    const hasVocabulary = uniqueWords > 0;
    const modelNeedsRetraining = !hasAllCategories || !hasVocabulary;
    
    if (modelNeedsRetraining) {
      // Model exists but may be incomplete or corrupted
      trainStatus.innerHTML = `
        <div style="color: #d69e2e; font-weight: 600; margin-bottom: 8px;">
          ⚠️ Model needs retraining
        </div>
        <div style="font-size: 14px; color: #4a5568; line-height: 1.6;">
          <strong>Status:</strong> Model found but incomplete or corrupted<br>
          <strong>Categories found:</strong> ${categories.length}<br>
          <strong>Vocabulary size:</strong> ${uniqueWords} words<br>
          <span style="color: #718096; font-size: 12px; margin-top: 4px; display: block;">
            💡 Please retrain the model by clicking "Train Local Model" to ensure proper classification.
          </span>
        </div>
      `;
    } else {
      // Model is valid and ready
      trainStatus.innerHTML = `
        <div style="color: #38a169; font-weight: 600; margin-bottom: 8px;">
          ✅ Model is trained and ready
        </div>
        <div style="font-size: 14px; color: #4a5568; line-height: 1.6;">
          <strong>Status:</strong> Active<br>
          <strong>Categories:</strong> ${categories.join(', ') || 'N/A'}<br>
          <strong>Vocabulary size:</strong> ${uniqueWords} words<br>
          <strong>Total words trained:</strong> ${totalWords}<br>
          <strong>Model version:</strong> ${version}<br>
          <span style="color: #718096; font-size: 12px; margin-top: 4px; display: block;">
            💡 You can retrain the model by clicking "Train Local Model" again.
          </span>
        </div>
      `;
    }
  } else {
    // Model not found or invalid
    trainStatus.innerHTML = `
      <div style="color: #d69e2e; font-weight: 600; margin-bottom: 8px;">
        ⚠️ Model not trained
      </div>
      <div style="font-size: 14px; color: #4a5568; line-height: 1.6;">
        <strong>Status:</strong> No trained model found<br>
        <span style="color: #718096; font-size: 12px; margin-top: 4px; display: block;">
          💡 Click "Train Local Model" to train a new classifier. This will enable topic classification for your social media posts.
        </span>
      </div>
    `;
  }
}

function initOptions() {
  const enableTracking = document.getElementById('enableTracking');
  const includeTitles = document.getElementById('includeTitles');
  const enableML = document.getElementById('enableML');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');
  const trainBtn = document.getElementById('trainBtn');
  const exportDataDiv = document.getElementById('exportData');
  const trainStatus = document.getElementById('trainStatus');

  // Check if all elements exist
  if (!enableTracking || !includeTitles || !enableML || !exportBtn || 
      !clearBtn || !trainBtn || !exportDataDiv || !trainStatus) {
    console.error('[Horizon] Missing required DOM elements in options page');
    return;
  }

  // Load existing settings and check model status
  chrome.storage.local.get(['settings', 'simple-classifier-model'], (res) => {
    const s = res.settings || {};
    enableTracking.checked = s.enableTracking === true;
    includeTitles.checked = s.includeTitles === true;
    enableML.checked = s.enableML === true;
    
    // Check if model exists and display status
    checkModelStatus(res['simple-classifier-model']);
  });

  // Save settings on change
  [enableTracking, includeTitles, enableML].forEach(el =>
    el.addEventListener('change', () => {
      chrome.storage.local.set({
        settings: {
          enableTracking: enableTracking.checked,
          includeTitles: includeTitles.checked,
          enableML: enableML.checked
        }
      });
    })
  );

  // Export
  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(null, (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `horizon-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      exportDataDiv.textContent = "Data exported successfully.";
    });
  });

  // Clear
  clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete all stored data?')) {
      chrome.storage.local.clear(() => {
        alert('All data cleared.');
        // Update model status after clearing
        checkModelStatus(null);
      });
    }
  });

  trainBtn.addEventListener('click', async () => {
    // Disable button during training
    trainBtn.disabled = true;
    trainBtn.style.opacity = '0.6';
    trainBtn.style.cursor = 'not-allowed';
    
    // Initial feedback
    trainStatus.innerHTML = '<div style="color: #2b6cb0; font-weight: 500;">🔄 Initializing model training...</div>';
    
    try {
      // Use simple classifier (no TensorFlow.js required, no eval needed)
      trainStatus.innerHTML = '<div style="color: #2b6cb0; font-weight: 500;">⚙️ Training simple classifier (no external dependencies)...</div>';
      
      // Import and train the simple classifier
      const { trainSimpleClassifier } = await import(chrome.runtime.getURL('simple-classifier.js'));
      
      const startTime = Date.now();
      const result = await trainSimpleClassifier();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      // Success feedback with details
      const accuracy = (result.accuracy * 100).toFixed(1);
      const timestamp = new Date().toLocaleTimeString();
      
      // Reload model data to show updated status
      chrome.storage.local.get(['simple-classifier-model'], (res) => {
        const modelData = res['simple-classifier-model'];
        const categories = modelData?.categories || [];
        const uniqueWords = modelData ? Object.keys(modelData.wordCounts || {}).length : 0;
        
        trainStatus.innerHTML = `
          <div style="color: #38a169; font-weight: 600; margin-bottom: 8px;">
            ✅ Training completed successfully!
          </div>
          <div style="font-size: 14px; color: #4a5568; line-height: 1.6;">
            <strong>Accuracy:</strong> ${accuracy}%<br>
            <strong>Training time:</strong> ${duration}s<br>
            <strong>Completed:</strong> ${timestamp}<br>
            <strong>Categories:</strong> ${categories.join(', ') || 'N/A'}<br>
            <strong>Vocabulary size:</strong> ${uniqueWords} words<br>
            <span style="color: #718096; font-size: 12px; margin-top: 4px; display: block;">
              Model saved locally and ready to use. Status will persist when you return to this page.
            </span>
          </div>
        `;
      });
    } catch (error) {
      // Error feedback with detailed debugging info
      console.error('[Horizon] Training error:', error);
      
      // Collect debugging information
      const debugInfo = [];
      debugInfo.push(`Error occurred during training`);
      
      trainStatus.innerHTML = `
        <div style="color: #e53e3e; font-weight: 600; margin-bottom: 8px;">
          ❌ Training failed
        </div>
        <div style="font-size: 14px; color: #4a5568; line-height: 1.6;">
          <strong>Error:</strong> ${error.message || 'Unknown error'}<br>
          <div style="margin-top: 8px; padding: 8px; background: #f7fafc; border-radius: 4px; font-size: 12px; color: #4a5568;">
            <strong>Debug Info:</strong><br>
            ${debugInfo.join('<br>')}
          </div>
          <span style="color: #718096; font-size: 12px; margin-top: 8px; display: block;">
            💡 Try: Refresh this page, then click "Train Local Model" again.
          </span>
        </div>
      `;
    } finally {
      // Re-enable button
      trainBtn.disabled = false;
      trainBtn.style.opacity = '1';
      trainBtn.style.cursor = 'pointer';
    }
  });
}
