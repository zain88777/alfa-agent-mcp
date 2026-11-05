/**
 * Alfa DevTools Bridge - Content Script
 *
 * Injected into every page. Captures network requests via
 * PerformanceObserver and stores them for the extension to retrieve.
 *
 * Console capture is handled by chrome.debugger in background.js
 * (Runtime.consoleAPICalled + Log.entryAdded) — no monkey-patching
 * needed here.
 */

(function () {
  "use strict";

  const MAX_LOGS = 500;
  let tabId = null;

  // Ask background for our tab ID (used for network log storage key)
  chrome.runtime.sendMessage({ type: "getTabId" }, (response) => {
    tabId = response?.tabId;
  });

  // ── Network request capture via Performance API ─────────────────

  const observer = new PerformanceObserver((list) => {
    if (!tabId) return;

    const key = `network_logs_${tabId}`;
    const entries = list.getEntries().map((entry) => ({
      name: entry.name,
      type: entry.initiatorType,
      duration: entry.duration,
      size: entry.transferSize,
      startTime: entry.startTime,
      timestamp: Date.now(),
    }));

    if (entries.length === 0) return;

    chrome.storage.local.get(key, (data) => {
      let logs = data[key] || [];
      logs = logs.concat(entries);
      if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
      chrome.storage.local.set({ [key]: logs });
    });
  });

  try {
    observer.observe({ entryTypes: ["resource"] });
  } catch {
    // PerformanceObserver not supported for resources
  }
})();
