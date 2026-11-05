/**
 * Alfa DevTools Bridge - Popup Script
 */

const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connect");

function updateStatus(connected) {
  if (connected) {
    statusEl.textContent = "Connected to bridge";
    statusEl.className = "status connected";
  } else {
    statusEl.textContent = "Disconnected";
    statusEl.className = "status disconnected";
  }
}

// Check current status
chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
  if (chrome.runtime.lastError) {
    updateStatus(false);
    return;
  }
  updateStatus(response?.connected ?? false);
});

connectBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "connect" }, (response) => {
    if (chrome.runtime.lastError) {
      updateStatus(false);
      return;
    }
    updateStatus(response?.connected ?? false);
  });
});
