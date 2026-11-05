# Browser DevTools Bridge Setup

## Architecture

```
Agent/OpenCode → Alfa MCP Tool → Local WebSocket Bridge → Chrome Extension → Browser Tab
```

## Quick Start

### 1. Start the Bridge Server

```bash
cd alfa-agent-mcp
npx tsx bridge/server.ts
```

Bridge runs on `ws://127.0.0.1:9223` (localhost only).

### 2. Load Chrome Extension

1. Open Chrome/Edge
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `alfa-agent-mcp/extension/` folder
6. Extension icon appears in toolbar

### 3. Start MCP Server

```bash
cd alfa-agent-mcp
npm run dev
```

### 4. Verify Connection

```bash
# Check bridge status
# In MCP tool: browser_status
```

## Available MCP Tools

### Read-Only (no approval needed)

| Tool | Description |
|------|-------------|
| `browser_status` | Check bridge/extension connection status |
| `browser_tabs` | List all open browser tabs |
| `browser_observe` | Get active tab metadata (title, URL, status) |
| `browser_dom_snapshot` | Capture DOM tree structure |
| `browser_console_logs` | Get captured console logs |
| `browser_network_logs` | Get captured network requests |
| `browser_inspect_element` | Inspect element styles and dimensions |
| `browser_eval_safe` | Execute read-only safe JS |
| `browser_screenshot` | Capture tab screenshot |
| `browser_scroll` | Scroll page or element |

### Dangerous (requires approval)

| Tool | Description |
|------|-------------|
| `browser_click` | Click element in browser |
| `browser_type` | Type text into input field |

## Security

### browser_eval_safe Approved Operations

- DOM read (querySelector, textContent, attributes)
- Computed styles inspection
- Element dimensions/position
- Console history read
- Network history read

### Blocked Operations

- Password/token/cookie extraction
- localStorage/sessionStorage access
- Form submission
- Navigation
- Arbitrary code execution

## File Structure

```
alfa-agent-mcp/
├── src/
│   ├── core/
│   │   └── browserBridge.ts    # WebSocket client
│   └── tools/
│       ├── browserStatus.ts
│       ├── browserTabs.ts
│       ├── browserObserve.ts
│       ├── browserDomSnapshot.ts
│       ├── browserConsoleLogs.ts
│       ├── browserNetworkLogs.ts
│       ├── browserInspectElement.ts
│       ├── browserClick.ts
│       ├── browserType.ts
│       ├── browserScroll.ts
│       ├── browserEvalSafe.ts
│       └── browserScreenshot.ts
├── bridge/
│   └── server.ts               # WebSocket bridge server
└── extension/
    ├── manifest.json           # Manifest V3
    ├── background.js           # Service worker
    ├── content.js              # Content script
    ├── popup.html              # Extension popup
    └── popup.js                # Popup script
```

## Troubleshooting

### Extension not connecting

1. Ensure bridge server is running
2. Check `ws://127.0.0.1:9223` is accessible
3. Reload extension in `chrome://extensions/`

### Tools return "Extension not connected"

1. Click extension icon in toolbar
2. Check connection status
3. Click "Connect to Bridge" if disconnected

### Port already in use

```bash
# Kill existing bridge process
netstat -ano | findstr :9223
taskkill /PID <pid> /F
```
