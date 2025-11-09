// popup.js
// Requests summary from background and renders charts & lists.

const MS_TO_MIN = 1000 * 60;

function formatMinutes(ms) {
  const mins = Math.round(ms / MS_TO_MIN);
  return `${mins} min`;
}

function entropyFromCounts(counts) {
  // counts: array of raw counts (e.g., ms)
  const total = counts.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let ent = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    ent -= p * Math.log2(p);
  }
  return ent;
}

function topNFromMap(mapObj, n = 5) {
  return Object.entries(mapObj)
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n);
}

function renderTopDomains(byDomain, totalMs) {
  const ul = document.getElementById('topDomains');
  ul.innerHTML = '';
  const top = topNFromMap(byDomain, 10);
  for (const item of top) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.k;
    const val = document.createElement('strong');
    val.textContent = formatMinutes(item.v);
    li.appendChild(name);
    li.appendChild(val);
    ul.appendChild(li);
  }
  if (top.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No tracking data for today yet.';
    ul.appendChild(li);
  }
}

let pieChart = null;
let barChart = null;
let topicChart = null;
let topicCountChart = null;

function renderCharts(byContentType, byDomain, byTopic, byTopicCounts) {
  // Ensure Chart.js is loaded
  if (typeof Chart === 'undefined') {
    console.error('[Horizon] Chart.js is not loaded');
    return;
  }

  // Define consistent colors for content types
  const contentTypeColors = {
    'video': '#e53e3e',
    'gallery': '#805ad5',
    'article': '#38a169',
    'long_read': '#2b6cb0',
    'short_text': '#d69e2e',
    'unknown': '#718096'
  };

  // Pie: content types
  const pieCtx = document.getElementById('contentPie');
  if (!pieCtx) {
    console.error('[Horizon] Pie chart canvas not found');
    return;
  }
  
  const pieContext = pieCtx.getContext('2d');
  const labels = Object.keys(byContentType).filter(k => byContentType[k] > 0);
  const data = labels.map(k => {
    const minutes = byContentType[k] / MS_TO_MIN;
    return Math.max(0.1, Math.round(minutes * 10) / 10);
  });
  
  // Map colors to labels consistently
  const backgroundColor = labels.map(label => 
    contentTypeColors[label] || '#319795'
  );
  
  // Handle empty data
  if (labels.length === 0) {
    labels.push('No data');
    data.push(0);
    backgroundColor.push('#e2e8f0');
  }
  
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(pieContext, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: backgroundColor
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { 
          position: 'bottom',
          labels: {
            font: {
              size: 12
            },
            padding: 12
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              const originalMs = byContentType[label] || 0;
              const seconds = Math.round(originalMs / 1000);
              if (value < 1) {
                return `${label}: ${seconds} sec (${percentage}%)`;
              }
              return `${label}: ${value.toFixed(1)} min (${percentage}%)`;
            }
          }
        }
      },
      // Ensure small segments are visible
      elements: {
        arc: {
          borderWidth: 2,
          borderColor: '#ffffff'
        }
      }
    }
  });

  // Bar: top domains
  const barCtx = document.getElementById('domainsBar');
  if (!barCtx) {
    console.error('[Horizon] Bar chart canvas not found');
    return;
  }
  
  const barContext = barCtx.getContext('2d');
  const top = topNFromMap(byDomain, 10); // Show top 10 domains
  
  // Color palette for bars (different color per bar)
  const barColors = [
    '#2b6cb0', // blue
    '#38a169', // green
    '#d69e2e', // yellow
    '#e53e3e', // red
    '#805ad5', // purple
    '#319795', // teal
    '#dd6b20', // orange
    '#e83e8c', // pink
    '#4299e1', // light blue
    '#48bb78'  // light green
  ];
  
  // Handle empty data with a message
  let barLabels, barData, barBackgroundColors;
  if (top.length === 0) {
    barLabels = ['No data yet'];
    barData = [0];
    barBackgroundColors = ['#e2e8f0'];
  } else {
    barLabels = top.map(t => {
      // Clean up domain names for display
      const domain = t.k.replace('www.', '');
      return domain.length > 15 ? domain.substring(0, 12) + '...' : domain;
    });
    barData = top.map(t => Math.round(t.v / MS_TO_MIN));
    // Assign a different color to each bar
    barBackgroundColors = barData.map((_, index) => barColors[index % barColors.length]);
  }
  
  if (barChart) barChart.destroy();
  barChart = new Chart(barContext, {
    type: 'bar',
    data: {
      labels: barLabels,
      datasets: [{
        label: 'Minutes',
        data: barData,
        backgroundColor: barBackgroundColors,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.parsed.y === 0 && top.length === 0) {
                return 'Visit social media sites to see tracking data';
              }
              return context.parsed.y + ' min';
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return value + ' min';
            }
          }
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 0,
            font: {
              size: 10
            }
          }
        }
      }
    }
  });

  // Topic Classifications Chart (Doughnut)
  const topicCtx = document.getElementById('topicChart');
  if (!topicCtx) {
    console.error('[Horizon] Topic chart canvas not found');
    return;
  }
  
  const topicContext = topicCtx.getContext('2d');
  // Filter topics with meaningful time (> 1000ms = 1 second minimum)
  const topicLabels = Object.keys(byTopic || {}).filter(k => byTopic[k] >= 1000);
  // Convert to minutes, but keep at least 0.1 min for display if there's any time
  const topicData = topicLabels.map(k => {
    const minutes = byTopic[k] / MS_TO_MIN;
    // Round to 1 decimal place, but show at least 0.1 if there's any data
    return Math.max(0.1, Math.round(minutes * 10) / 10);
  });
  
  // Debug logging for topic chart
  console.log('[Horizon Popup] Topic chart data:', {
    rawByTopic: byTopic,
    topicLabels,
    topicData,
    topicDataInMs: topicLabels.map(k => byTopic[k]),
    filtered: Object.keys(byTopic || {}).filter(k => byTopic[k] < 1000)
  });
  
  // Define colors for topics
  const topicColors = {
    'politics': '#e53e3e',
    'sports': '#2b6cb0',
    'tech': '#38a169',
    'entertainment': '#805ad5',
    'unknown': '#718096'
  };
  
  // Map colors to labels consistently
  const topicBackgroundColor = topicLabels.map(label => 
    topicColors[label] || '#319795'
  );
  
  // Handle empty data
  if (topicLabels.length === 0) {
    topicLabels.push('No data');
    topicData.push(0);
    topicBackgroundColor.push('#e2e8f0');
  }
  
  if (topicChart) topicChart.destroy();
  topicChart = new Chart(topicContext, {
    type: 'doughnut',
    data: {
      labels: topicLabels,
      datasets: [{
        data: topicData,
        backgroundColor: topicBackgroundColor
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { 
          position: 'bottom',
          labels: {
            font: {
              size: 12
            },
            padding: 12
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              // Get original time in ms for this label
              const labelIndex = context.dataIndex;
              const originalMs = topicLabels[labelIndex] ? byTopic[topicLabels[labelIndex]] : 0;
              const seconds = Math.round(originalMs / 1000);
              // Show seconds if less than 1 minute
              if (value < 1) {
                return `${label}: ${seconds} sec (${percentage}%)`;
              }
              return `${label}: ${value.toFixed(1)} min (${percentage}%)`;
            }
          }
        }
      },
      elements: {
        arc: {
          borderWidth: 2,
          borderColor: '#ffffff'
        }
      }
    }
  });

  // Topic Counts Bar Chart
  const topicCountCanvas = document.getElementById('topicCountBar');
  if (!topicCountCanvas) {
    console.error('[Horizon] Topic count bar canvas not found');
    return;
  }

  const topicCountContext = topicCountCanvas.getContext('2d');
  const countEntries = Object.entries(byTopicCounts || {}).filter(([, count]) => count > 0);

  let topicCountLabels;
  let topicCountData;
  let topicCountColors;

  if (countEntries.length === 0) {
    topicCountLabels = ['No data yet'];
    topicCountData = [0];
    topicCountColors = ['#e2e8f0'];
  } else {
    topicCountLabels = countEntries.map(([label]) => label);
    topicCountData = countEntries.map(([, count]) => count);
    topicCountColors = topicCountLabels.map(label => topicColors[label] || '#319795');
  }

  if (topicCountChart) topicCountChart.destroy();
  topicCountChart = new Chart(topicCountContext, {
    type: 'bar',
    data: {
      labels: topicCountLabels,
      datasets: [{
        label: 'Posts',
        data: topicCountData,
        backgroundColor: topicCountColors,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.parsed.y === 0 && countEntries.length === 0) {
                return 'Topic classifications will appear here once available';
              }
              return `${context.parsed.y} posts`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
            callback: function(value) {
              return `${value} posts`;
            }
          }
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 0,
            font: {
              size: 10
            }
          }
        }
      }
    }
  });
}

function renderMetrics(byDomain, byContentType, totalMs) {
  const metricsDiv = document.getElementById('metrics');

  const domainCounts = Object.values(byDomain);
  const topicCounts = Object.values(byContentType);

  const ent = entropyFromCounts(topicCounts).toFixed(2);
  // top-3 concentration: percent of time in top 3 domains
  const top3 = topNFromMap(byDomain, 3).reduce((s, x) => s + x.v, 0);
  const concentration = totalMs > 0 ? Math.round((top3 / totalMs) * 100) : 0;

  metricsDiv.innerHTML = `
    <div>Topic entropy: <strong>${ent}</strong></div>
    <div>Top-3 domain concentration: <strong>${concentration}%</strong></div>
  `;
}

function drawUI(cache) {
  const totalMs = cache.totalMs || 0;
  const byDomain = cache.byDomain || {};
  const byContentType = cache.byContentType || {};
  const byTopic = cache.byTopic || {};
  const byTopicCounts = cache.byTopicCounts || {};

  // Debug logging
  console.log('[Horizon Popup] Data received:', {
    totalMs,
    byDomain: Object.keys(byDomain).length,
    byContentType: Object.keys(byContentType).length,
    byTopic: Object.keys(byTopic).length,
    byTopicCounts: Object.keys(byTopicCounts).length,
    byTopicData: byTopic,
    byTopicCountsData: byTopicCounts
  });

  document.getElementById('summarySmall').textContent = `Today • ${formatMinutes(totalMs)}`;

  renderTopDomains(byDomain, totalMs);
  renderCharts(byContentType, byDomain, byTopic, byTopicCounts);
  renderMetrics(byDomain, byContentType, totalMs);
}

function loadSummary() {
  chrome.runtime.sendMessage({ type: 'get_today_summary' }, (res) => {
    const cache = res || { day: new Date().toISOString().slice(0,10), byDomain: {}, byContentType: {}, byTopic: {}, byTopicCounts: {}, totalMs: 0 };
    drawUI(cache);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Wait for Chart.js to be fully loaded
  if (typeof Chart !== 'undefined') {
    loadSummary();
    document.getElementById('refreshBtn').addEventListener('click', loadSummary);
  } else {
    // If Chart.js isn't loaded yet, wait a bit and try again
    setTimeout(() => {
      if (typeof Chart !== 'undefined') {
        loadSummary();
        document.getElementById('refreshBtn').addEventListener('click', loadSummary);
      } else {
        console.error('[Horizon] Chart.js failed to load');
        document.body.innerHTML = '<div style="padding: 20px; color: #e53e3e;">Error: Chart.js library failed to load. Please refresh the extension.</div>';
      }
    }, 500);
  }
});
