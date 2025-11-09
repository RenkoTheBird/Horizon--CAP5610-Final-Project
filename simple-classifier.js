// simple-classifier.js
// A lightweight text classifier that doesn't require eval or external ML libraries
// Uses Naive Bayes algorithm for topic classification

export class SimpleClassifier {
  constructor() {
    this.wordCounts = {}; // word -> category -> count
    this.categoryCounts = {}; // category -> total count
    this.totalWords = 0;
    this.categories = ['politics', 'sports', 'tech', 'entertainment'];
  }

  // Tokenize text into words
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2); // Filter out very short words
  }

  // Train the classifier with labeled examples
  train(texts, labels) {
    const categoryLabels = ['politics', 'sports', 'tech', 'entertainment'];
    
    texts.forEach((text, index) => {
      const category = categoryLabels[labels[index]];
      if (!this.categoryCounts[category]) {
        this.categoryCounts[category] = 0;
      }
      this.categoryCounts[category]++;

      const words = this.tokenize(text);
      words.forEach(word => {
        if (!this.wordCounts[word]) {
          this.wordCounts[word] = {};
        }
        if (!this.wordCounts[word][category]) {
          this.wordCounts[word][category] = 0;
        }
        this.wordCounts[word][category]++;
        this.totalWords++;
      });
    });

    console.log('[SimpleClassifier] Training complete');
    console.log('[SimpleClassifier] Categories:', this.categoryCounts);
    console.log('[SimpleClassifier] Unique words:', Object.keys(this.wordCounts).length);
  }

  // Classify a text
  classify(text) {
    const words = this.tokenize(text);
    const scores = {};

    // Initialize scores
    this.categories.forEach(cat => {
      scores[cat] = Math.log(this.categoryCounts[cat] || 1);
    });

    // Calculate probability for each category
    words.forEach(word => {
      this.categories.forEach(cat => {
        const wordCount = (this.wordCounts[word] && this.wordCounts[word][cat]) || 0;
        const categoryTotal = this.categoryCounts[cat] || 1;
        const probability = (wordCount + 1) / (categoryTotal + this.totalWords);
        scores[cat] += Math.log(probability);
      });
    });

    // Find the category with highest score
    let maxScore = -Infinity;
    let predictedCategory = 'unknown';

    this.categories.forEach(cat => {
      if (scores[cat] > maxScore) {
        maxScore = scores[cat];
        predictedCategory = cat;
      }
    });

    // Calculate confidence (normalize scores)
    const expScores = this.categories.map(cat => Math.exp(scores[cat] - maxScore));
    const sumExpScores = expScores.reduce((a, b) => a + b, 0);
    const confidence = Math.exp(scores[predictedCategory] - maxScore) / sumExpScores;

    return {
      category: predictedCategory,
      confidence: confidence,
      scores: scores
    };
  }

  // Save model to storage
  async save() {
    const modelData = {
      wordCounts: this.wordCounts,
      categoryCounts: this.categoryCounts,
      totalWords: this.totalWords,
      categories: this.categories,
      version: 1
    };
    
    await chrome.storage.local.set({ 'simple-classifier-model': modelData });
    console.log('[SimpleClassifier] Model saved to chrome.storage');
    return modelData;
  }

  // Load model from storage
  async load() {
    const result = await chrome.storage.local.get(['simple-classifier-model']);
    if (result['simple-classifier-model']) {
      const modelData = result['simple-classifier-model'];
      this.wordCounts = modelData.wordCounts || {};
      this.categoryCounts = modelData.categoryCounts || {};
      this.totalWords = modelData.totalWords || 0;
      this.categories = modelData.categories || ['politics', 'sports', 'tech', 'entertainment'];
      console.log('[SimpleClassifier] Model loaded from chrome.storage');
      return true;
    }
    return false;
  }
}

// Training function
export async function trainSimpleClassifier() {
  console.log("[SimpleClassifier] Starting training...");

  // Training data
  const texts = [
    "Election results announced today", // politics
    "New NBA record set by LeBron",     // sports
    "Latest iPhone released",           // tech
    "Oscar nominations revealed",       // entertainment
    "Senate debates new bill",          // politics
    "Basketball championship game tonight", // sports
    "New smartphone features unveiled",  // tech
    "Movie premiere red carpet",        // entertainment
    "Congressional hearing scheduled",   // politics
    "Football season starts",           // sports
    "Software update available",       // tech
    "Music festival lineup announced"   // entertainment
  ];
  const labels = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]; // More training data

  const classifier = new SimpleClassifier();
  classifier.train(texts, labels);

  // Test the classifier
  const testTexts = [
    "Senator proposes new legislation",
    "Quarterback throws touchdown",
    "New app released for download",
    "Actor wins academy award"
  ];

  console.log("[SimpleClassifier] Testing classifier:");
  testTexts.forEach(text => {
    const result = classifier.classify(text);
    console.log(`  "${text}" -> ${result.category} (${(result.confidence * 100).toFixed(1)}%)`);
  });

  // Save model
  await classifier.save();

  // Calculate accuracy on training data
  let correct = 0;
  const categoryLabels = ['politics', 'sports', 'tech', 'entertainment'];
  texts.forEach((text, index) => {
    const result = classifier.classify(text);
    if (result.category === categoryLabels[labels[index]]) {
      correct++;
    }
  });
  const accuracy = correct / texts.length;

  console.log(`[SimpleClassifier] Training accuracy: ${(accuracy * 100).toFixed(2)}%`);

  return { accuracy };
}

