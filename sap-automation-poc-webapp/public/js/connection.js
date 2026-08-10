// Connection handling with Chrome extension

import { els } from './dom.js';

export let port = null;
export let connected = false;
let messageHandler = null;

export function setPortMessageHandler(handler) {
  messageHandler = handler;
}

export function setConnectStatus(ok, text) {
  els.connectStatus.textContent = text;
  els.connectStatus.className = `status-chip status-${ok ? 'pass' : 'fail'}`;
}

export function sendToExtension(type, payload) {
  if (!port) return;
  try {
    port.postMessage({ type, ...(payload || {}) });
  } catch (e) {
    // port likely dead; onDisconnect will handle state cleanup
  }
}

export function connectToExtension(extId) {
  if (port) {
    try { port.disconnect(); } catch (e) { /* ignore */ }
    port = null;
  }
  if (!window.chrome || !chrome.runtime || !chrome.runtime.connect) {
    setConnectStatus(false, 'Browser does not support chrome.runtime.connect');
    return;
  }
  try {
    port = chrome.runtime.connect(extId, { name: 'sap-automation-poc-webapp' });
  } catch (e) {
    setConnectStatus(false, `Connection error: ${e.message}`);
    return;
  }
  port.onMessage.addListener(messageHandler);
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    connected = false;
    setConnectStatus(false, err ? `Error: ${err.message}` : 'Disconnected');
    port = null;
    // Signal SW died mid-run so app.js can reset running state
    try {
      if (messageHandler) {
        messageHandler({ type: 'WA_EVT_PORT_DISCONNECTED' }, null);
      }
    } catch (e) { /* ignore */ }
  });
  connected = true;
  setConnectStatus(true, 'Connected');
  localStorage.setItem('sap_automation_poc_ext_id', extId);
  sendToExtension('WA_LIST_TABS');
  // No longer requesting WA_GET_ALL_DATA — DB is the source of truth.
}

export function getTargetTabId() {
  const v = els.targetTabSelect.value;
  if (!v) return null;
  const id = parseInt(v, 10);
  // DB pattern IDs like 'db_0' produce NaN — only real Chrome tabs have numeric IDs
  return isNaN(id) ? null : id;
}

/**
 * Returns true if the currently selected target tab is a DB URL pattern (not a live Chrome tab).
 */
export function isTargetTabFromDb() {
  const sel = els.targetTabSelect;
  if (!sel || !sel.value) return false;
  return sel.value.startsWith('db_');
}

/**
 * Returns the URL of the currently selected target tab.
 */
export function getTargetTabUrl() {
  const sel = els.targetTabSelect;
  if (!sel || !sel.value) return '';
  const opt = sel.options[sel.selectedIndex];
  // Read full URL from data-url attribute (avoids truncation issues)
  return opt.dataset.url || '';
}

export function renderTabOptions(tabs) {
  const prevValue = els.targetTabSelect.value;
  els.targetTabSelect.innerHTML = '';

  // Group tabs: Chrome tabs first, then DB tabs
  const chromeTabs = (tabs || []).filter((t) => t.source === 'chrome');
  const dbTabs = (tabs || []).filter((t) => t.source === 'db');

  if (chromeTabs.length === 0 && dbTabs.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '(No tab)';
    opt.value = '';
    els.targetTabSelect.appendChild(opt);
    return;
  }

  // Chrome tabs section
  if (chromeTabs.length > 0) {
    const group = document.createElement('optgroup');
    group.label = '🌐 Chrome Tabs';
    chromeTabs.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = String(t.id);
      opt.dataset.url = t.url || '';
      // Check if this Chrome tab URL matches any DB pattern
      const tabUrl = (t.url || '').trim();
      const hasDbMatch = dbTabs.some(db => {
        const dbUrl = (db.url || '').trim();
        return tabUrl && dbUrl && (tabUrl.startsWith(dbUrl) || dbUrl.startsWith(tabUrl));
      });
      opt.textContent = `${hasDbMatch ? '[✓DB] ' : ''}${t.title || t.url} — ${t.url}`.slice(0, 90);
      group.appendChild(opt);
    });
    els.targetTabSelect.appendChild(group);
  }

  // DB tabs section (URL patterns from scanned objects)
  if (dbTabs.length > 0) {
    const group = document.createElement('optgroup');
    group.label = '🗂 URL Patterns';
    dbTabs.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = String(t.id);
      opt.dataset.url = t.pageUrlPattern || t.url || '';
      opt.textContent = `${t.title || t.pageUrlPattern} — ${t.pageUrlPattern}`.slice(0, 90);
      group.appendChild(opt);
    });
    els.targetTabSelect.appendChild(group);
  }

  // Restore previous selection if still valid
  // Priority: exact match > first tab of same source type > first available tab
  const allIds = new Set(tabs.map((t) => String(t.id)));
  if (prevValue && allIds.has(prevValue)) {
    els.targetTabSelect.value = prevValue;
  } else if (prevValue) {
    // Previous selection lost (tab closed or DB pattern removed)
    // Try to find a DB tab if previous was DB, or first Chrome tab otherwise
    const wasDb = prevValue.startsWith('db_');
    const fallback = wasDb ? dbTabs[0] : chromeTabs[0];
    if (fallback) {
      els.targetTabSelect.value = String(fallback.id);
    }
  }
  // Trigger change event so dependent views re-render
  els.targetTabSelect.dispatchEvent(new Event('change'));
}