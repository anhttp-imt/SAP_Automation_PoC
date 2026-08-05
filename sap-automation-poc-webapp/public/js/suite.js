// Suite Builder

import { state, getTestCase, getSuite, escapeHtml, uid } from './state.js';
import { els } from './dom.js';
import { sendToExtension } from './connection.js';
import * as api from './api.js';

// ---------------- Suite Selectors ----------------

export function renderSuiteSelectors() {
  if (!els.suiteSelect) return; // tab not loaded yet
  // Update Suite tab selector
  {
    const prevValue = els.suiteSelect.value;
    els.suiteSelect.innerHTML = '';
    if (state.testSuites.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '(No Suite)';
      opt.value = '';
      els.suiteSelect.appendChild(opt);
    } else {
      state.testSuites.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (${s.testCaseIds.length} test case)`;
        els.suiteSelect.appendChild(opt);
      });
    }
    if (prevValue && state.testSuites.some((s) => s.id === prevValue)) els.suiteSelect.value = prevValue;
  }
  // Update Run tab selector (may not be loaded yet)
  if (els.runSuiteSelect) {
    const prevValue = els.runSuiteSelect.value;
    els.runSuiteSelect.innerHTML = '';
    if (state.testSuites.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '(No Suite)';
      opt.value = '';
      els.runSuiteSelect.appendChild(opt);
    } else {
      state.testSuites.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (${s.testCaseIds.length} test case)`;
        els.runSuiteSelect.appendChild(opt);
      });
    }
    if (prevValue && state.testSuites.some((s) => s.id === prevValue)) els.runSuiteSelect.value = prevValue;
  }

  if (!state.activeSuiteId || !getSuite(state.activeSuiteId)) {
    state.activeSuiteId = state.testSuites[0]?.id || null;
  }
  if (state.activeSuiteId) els.suiteSelect.value = state.activeSuiteId;
  if (els.btnDeleteSuite) els.btnDeleteSuite.disabled = !state.activeSuiteId;
  if (els.btnExportSuite) els.btnExportSuite.disabled = !state.activeSuiteId;

  // Test case selector for adding to suite
  els.suiteAddTestcaseSelect.innerHTML = '';
  if (state.testCases.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '(No Test Case in Test Builder)';
    opt.value = '';
    els.suiteAddTestcaseSelect.appendChild(opt);
  } else {
    state.testCases.forEach((tc) => {
      const opt = document.createElement('option');
      opt.value = tc.id;
      opt.textContent = tc.name;
      els.suiteAddTestcaseSelect.appendChild(opt);
    });
  }
}

// ---------------- Suite Items ----------------

export function renderSuiteItems() {
  if (!els.suiteItemList) return; // tab not loaded yet
  const suite = getSuite(state.activeSuiteId);
  els.suiteItemList.innerHTML = '';
  const ids = suite ? suite.testCaseIds : [];
  els.suiteEmpty.classList.toggle('visible', ids.length === 0);

  ids.forEach((tcId, idx) => {
    const tc = getTestCase(tcId);
    const li = document.createElement('li');
    li.className = 'item-card';
    const label = tc ? `${tc.name} (${tc.steps.length} step)` : '(Tescase is deleted!)';
    li.innerHTML = `
      <div class="item-card-row">
        <span class="item-title">${idx + 1}. ${escapeHtml(label)}</span>
        <span class="item-actions">
          <button data-action="up" title="Up">↑</button>
          <button data-action="down" title="Down">↓</button>
          <button data-action="delete" title="Delete">🗑</button>
        </span>
      </div>
    `;
    li.querySelector('[data-action="up"]').addEventListener('click', () => moveSuiteItem(idx, -1));
    li.querySelector('[data-action="down"]').addEventListener('click', () => moveSuiteItem(idx, 1));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteSuiteItem(idx));
    els.suiteItemList.appendChild(li);
  });
}

// ---------------- Suite Operations ----------------

export function persistActiveSuite() {
  const suite = getSuite(state.activeSuiteId);
  if (!suite) return;
  sendToExtension('WA_SAVE_TEST_SUITE', { suite });
  api.saveTestSuitesToServer();
  renderSuiteSelectors();
}

export function moveSuiteItem(idx, dir) {
  const suite = getSuite(state.activeSuiteId);
  if (!suite) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= suite.testCaseIds.length) return;
  const [item] = suite.testCaseIds.splice(idx, 1);
  suite.testCaseIds.splice(newIdx, 0, item);
  renderSuiteItems();
  persistActiveSuite();
}

export function deleteSuiteItem(idx) {
  const suite = getSuite(state.activeSuiteId);
  if (!suite) return;
  suite.testCaseIds.splice(idx, 1);
  renderSuiteItems();
  persistActiveSuite();
}