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
  });
  connected = true;
  setConnectStatus(true, 'Connected');
  localStorage.setItem('sap_automation_poc_ext_id', extId);
  sendToExtension('WA_LIST_TABS');
  sendToExtension('WA_GET_ALL_DATA');
}

export function getTargetTabId() {
  const v = els.targetTabSelect.value;
  return v ? parseInt(v, 10) : null;
}

export function renderTabOptions(tabs) {
  const prevValue = els.targetTabSelect.value;
  els.targetTabSelect.innerHTML = '';
  if (tabs.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '(No tab)';
    opt.value = '';
    els.targetTabSelect.appendChild(opt);
    return;
  }
  tabs.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = `${t.title || t.url} — ${t.url}`.slice(0, 90);
    els.targetTabSelect.appendChild(opt);
  });
  if (tabs.some((t) => String(t.id) === prevValue)) els.targetTabSelect.value = prevValue;
}