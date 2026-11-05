/**
 * Alfa DevTools Bridge - Background Service Worker
 *
 * Connects to the local WebSocket bridge server and relays
 * commands from MCP tools to the browser tab.
 *
 * Console capture uses chrome.debugger (Runtime.consoleAPICalled,
 * Runtime.exceptionThrown, Log.entryAdded) with per-tab in-memory
 * ring buffers. No content-script monkey-patching needed.
 */

const BRIDGE_WS_URL = "ws://127.0.0.1:9223";
const RECONNECT_DELAY = 2000;
const MAX_BUFFER_SIZE = 500;

let bridgeWs = null;
let reconnectTimer = null;

// ── debugger session tracking ──────────────────────────────────────
const debuggerSessions = new Map();   // tabId → true
const consoleBuffers  = new Map();    // tabId → ring buffer array

function log(msg) {
  console.log(`[AlfaBridge] ${msg}`);
}

// ── console ring buffer helpers ────────────────────────────────────

function addToConsoleBuffer(tabId, entry) {
  if (!consoleBuffers.has(tabId)) {
    consoleBuffers.set(tabId, []);
  }
  const buf = consoleBuffers.get(tabId);
  buf.push(entry);
  if (buf.length > MAX_BUFFER_SIZE) {
    buf.shift();
  }
}

function normalizeLevel(raw) {
  // Chrome debugger uses "warning" for console.warn
  const map = { log: "log", info: "info", warning: "warn", error: "error", debug: "log" };
  return map[raw] ?? raw;
}

// ── chrome.debugger event listener (global) ────────────────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!tabId) return;

  if (method === "Runtime.consoleAPICalled") {
    const frames = params.stackTrace?.callFrames ?? [];
    const entry = {
      level: normalizeLevel(params.type),
      text: (params.args ?? [])
        .map(a => a.description ?? a.value ?? (typeof a === "object" ? JSON.stringify(a) : String(a)))
        .join(" "),
      source: "console-api",
      timestamp: params.timestamp,
      url: frames[0]?.url ?? "",
      lineNumber:   frames[0]?.lineNumber   ?? 0,
      columnNumber: frames[0]?.columnNumber ?? 0,
    };
    addToConsoleBuffer(tabId, entry);
  } else if (method === "Runtime.exceptionThrown") {
    const d = params.exceptionDetails ?? {};
    const entry = {
      level: "error",
      text: d.text ?? (d.exception?.description ?? "Exception thrown"),
      source: "runtime",
      timestamp: Date.now(),
      url: d.url ?? "",
      lineNumber:   d.lineNumber   ?? 0,
      columnNumber: d.columnNumber ?? 0,
    };
    addToConsoleBuffer(tabId, entry);
  } else if (method === "Log.entryAdded") {
    const e = params.entry ?? {};
    const entry = {
      level: normalizeLevel(e.level ?? "info"),
      text: e.text ?? "",
      source: e.source ?? "other",
      timestamp: (e.timestamp ?? Date.now() / 1000) * 1000,
      url: e.url ?? "",
      lineNumber:   e.lineNumber   ?? 0,
      columnNumber: e.columnNumber ?? 0,
    };
    addToConsoleBuffer(tabId, entry);
  }
});

// ── debugger attach / detach ───────────────────────────────────────

async function attachDebugger(tabId) {
  if (debuggerSessions.has(tabId)) return true;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await Promise.all([
      chrome.debugger.sendCommand({ tabId }, "Runtime.enable"),
      chrome.debugger.sendCommand({ tabId }, "Log.enable"),
    ]);
    debuggerSessions.set(tabId, true);
    log(`Debugger attached to tab ${tabId}`);
    return true;
  } catch (err) {
    log(`Debugger attach failed for tab ${tabId}: ${err.message}`);
    return false;
  }
}

async function detachDebugger(tabId) {
  if (!debuggerSessions.has(tabId)) return;

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // tab may already be gone
  }
  debuggerSessions.delete(tabId);
  consoleBuffers.delete(tabId);
  log(`Debugger detached from tab ${tabId}`);
}

// Clean up when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
});

// When the active tab changes, ensure debugger is attached
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  if (tabId && !debuggerSessions.has(tabId)) {
    // Don't attach to chrome:// or edge:// pages
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
        await attachDebugger(tabId);
      }
    } catch {
      // ignore
    }
  }
});

// ── WebSocket bridge ───────────────────────────────────────────────

function connectToBridge() {
  if (bridgeWs && (bridgeWs.readyState === WebSocket.OPEN || bridgeWs.readyState === WebSocket.CONNECTING)) return;

  try {
    bridgeWs = new WebSocket(BRIDGE_WS_URL);

    bridgeWs.onopen = () => {
      log("Connected to bridge server");
      bridgeWs.send(JSON.stringify({ role: "extension" }));
    };

    bridgeWs.onmessage = async (event) => {
      try {
        const request = JSON.parse(event.data);
        if (request.id && request.method) {
          const response = await handleRequest(request);
          bridgeWs.send(JSON.stringify(response));
        }
      } catch (err) {
        log(`Error handling message: ${err.message}`);
      }
    };

    bridgeWs.onclose = () => {
      log("Disconnected from bridge");
      scheduleReconnect();
    };

    bridgeWs.onerror = (err) => {
      log(`Bridge error: ${err.message}`);
    };
  } catch (err) {
    log(`Connection failed: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToBridge();
  }, RECONNECT_DELAY);
}

// ── command dispatcher ─────────────────────────────────────────────

async function handleRequest(request) {
  const { id, method, params } = request;

  try {
    let result;
    switch (method) {
      case "tabs_list":        result = await handleTabsList();           break;
      case "tab_observe":      result = await handleTabObserve(params);   break;
      case "dom_snapshot":     result = await handleDomSnapshot(params);  break;
      case "console_logs":     result = await handleConsoleLogs(params);  break;
      case "network_logs":     result = await handleNetworkLogs(params);  break;
      case "inspect_element":  result = await handleInspectElement(params); break;
      case "element_click":    result = await handleClick(params);        break;
      case "element_type":     result = await handleType(params);         break;
      case "element_scroll":   result = await handleScroll(params);       break;
      case "eval_safe":        result = await handleEvalSafe(params);     break;
      case "screenshot":       result = await handleScreenshot(params);   break;
      default:
        return { id, success: false, error: `Unknown method: ${method}` };
    }

    return { id, success: true, data: result };
  } catch (err) {
    return { id, success: false, error: err.message };
  }
}

// ── tab / DOM / interaction handlers ───────────────────────────────

async function handleTabsList() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(t => ({
    id: t.id,
    title: t.title,
    url: t.url,
    active: t.active,
    windowId: t.windowId,
    status: t.status,
  }));
}

async function handleTabObserve(params) {
  const tabId = params?.tabId ?? (await getActiveTabId());
  const tab = await chrome.tabs.get(tabId);
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    status: tab.status,
    favIconUrl: tab.favIconUrl,
  };
}

async function handleDomSnapshot(params) {
  const tabId = params?.tabId ?? (await getActiveTabId());

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, depth) => {
      function serialize(el, currentDepth, maxDepth) {
        if (!el || currentDepth > maxDepth) return null;

        const node = {
          tag: el.tagName?.toLowerCase() || "#text",
          attributes: {},
          children: [],
        };

        if (el.attributes) {
          for (const attr of el.attributes) {
            node.attributes[attr.name] = attr.value;
          }
        }

        if (currentDepth < maxDepth && el.children) {
          for (const child of el.children) {
            const serialized = serialize(child, currentDepth + 1, maxDepth);
            if (serialized) node.children.push(serialized);
          }
        }

        return node;
      }

      const root = selector ? document.querySelector(selector) : document.body;
      return serialize(root, 0, depth ?? 5);
    },
    args: [params?.selector ?? null, params?.depth ?? 5],
  });

  return results?.[0]?.result ?? null;
}

// ── console logs (debugger-based) ──────────────────────────────────

async function handleConsoleLogs(params) {
  const requestedTabId = params?.tabId;

  if (requestedTabId) {
    // Specific tab requested — attach debugger and return that tab's buffer
    await attachDebugger(requestedTabId);
    const buffer = consoleBuffers.get(requestedTabId) ?? [];
    let filtered = buffer;

    const level = params?.level ?? "all";
    if (level !== "all") {
      filtered = filtered.filter(l => l.level === level);
    }

    const limit = params?.limit ?? 100;
    return filtered.slice(-limit);
  }

  // No tabId specified — attach to active tab and return ALL tabs' logs combined
  const activeTabId = await getActiveTabId();
  await attachDebugger(activeTabId);

  let allLogs = [];
  for (const [tabId, buf] of consoleBuffers) {
    allLogs = allLogs.concat(buf.map(e => ({ ...e, tabId })));
  }

  // Sort by timestamp ascending
  allLogs.sort((a, b) => a.timestamp - b.timestamp);

  const level = params?.level ?? "all";
  if (level !== "all") {
    allLogs = allLogs.filter(l => l.level === level);
  }

  const limit = params?.limit ?? 100;
  return allLogs.slice(-limit);
}

// ── network logs (PerformanceObserver via content script) ──────────

async function handleNetworkLogs(params) {
  const key = `network_logs_${params?.tabId ?? "current"}`;
  const data = await chrome.storage.local.get(key);
  let logs = data[key] || [];

  const type = params?.type ?? "all";
  if (type !== "all") {
    logs = logs.filter(l => l.type === type);
  }

  const limit = params?.limit ?? 100;
  return logs.slice(-limit);
}

// ── element inspection / interaction ───────────────────────────────

async function handleInspectElement(params) {
  const tabId = params?.tabId ?? (await getActiveTabId());

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector) => {
      const el = document.querySelector(selector);
      if (!el) return { error: `Element not found: ${selector}` };

      const computed = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      return {
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        innerHTML: el.innerHTML?.substring(0, 5000),
        textContent: el.textContent?.substring(0, 2000),
        attributes: Array.from(el.attributes).map(a => ({ name: a.name, value: a.value })),
        computedStyles: {
          display: computed.display,
          visibility: computed.visibility,
          position: computed.position,
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          fontSize: computed.fontSize,
          fontFamily: computed.fontFamily,
          padding: computed.padding,
          margin: computed.margin,
          border: computed.border,
          width: computed.width,
          height: computed.height,
        },
        boundingRect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          right: rect.right,
        },
        parentTag: el.parentElement?.tagName,
        childCount: el.children?.length ?? 0,
      };
    },
    args: [params.selector],
  });

  return results?.[0]?.result ?? null;
}

async function handleClick(params) {
  const tabId = params?.tabId ?? (await getActiveTabId());

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector) => {
      const el = document.querySelector(selector);
      if (!el) return { error: `Element not found: ${selector}` };
      el.click();
      return { clicked: true, selector };
    },
    args: [params.selector],
  });

  return results?.[0]?.result ?? null;
}

async function handleType(params) {
  const tabId = params?.tabId ?? (await getActiveTabId());

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, text, clear) => {
      const el = document.querySelector(selector);
      if (!el) return { error: `Element not found: ${selector}` };

      el.focus();
      if (clear) el.value = "";
      el.value += text;

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));

      return { typed: true, selector, text };
    },
    args: [params.selector, params.text, params.clear ?? false],
  });

  return results?.[0]?.result ?? null;
}

async function handleScroll(params) {
  const tabId = params?.tabId ?? (await getActiveTabId());

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (direction, pixels, selector) => {
      const el = selector ? document.querySelector(selector) : window;
      if (!el) return { error: `Element not found: ${selector}` };

      const scrollMap = {
        up: { top: -pixels },
        down: { top: pixels },
        left: { left: -pixels },
        right: { left: pixels },
      };

      const scrollBy = scrollMap[direction] || scrollMap.down;

      if (selector) {
        el.scrollBy(scrollBy.left ?? 0, scrollBy.top ?? 0);
      } else {
        window.scrollBy(scrollBy.left ?? 0, scrollBy.top ?? 0);
      }

      return { scrolled: true, direction, pixels };
    },
    args: [params.direction ?? "down", params.pixels ?? 300, params.selector],
  });

  return results?.[0]?.result ?? null;
}

async function handleEvalSafe(params) {
  const tabId = params?.tabId ?? (await getActiveTabId());

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (script) => {
      try {
        const result = new Function(script)();
        return { result };
      } catch (err) {
        return { error: err.message };
      }
    },
    args: [params.script],
  });

  return results?.[0]?.result ?? null;
}

async function handleScreenshot(params) {
  const tabId = params?.tabId ?? (await getActiveTabId());

  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: params?.format ?? "png",
    quality: params?.quality ?? 80,
  });

  return {
    dataUrl,
    format: params?.format ?? "png",
  };
}

// ── helpers ────────────────────────────────────────────────────────

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  return tab.id;
}

function getConnectionStatus() {
  return bridgeWs && bridgeWs.readyState === WebSocket.OPEN;
}

// ── popup messages ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getStatus") {
    sendResponse({ connected: getConnectionStatus() });
    return true;
  }
  if (message.type === "connect") {
    connectToBridge();
    setTimeout(() => {
      sendResponse({ connected: getConnectionStatus() });
    }, 500);
    return true;
  }
});

// ── startup ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  log("Extension installed");
  connectToBridge();
});

connectToBridge();
