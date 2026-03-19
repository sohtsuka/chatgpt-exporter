// background.js — Manifest V3 service worker
// Minimal implementation. Extension point for context menus or keyboard shortcuts.

chrome.runtime.onInstalled.addListener(() => {
  console.log('ChatGPT Markdown Exporter installed.');
});
