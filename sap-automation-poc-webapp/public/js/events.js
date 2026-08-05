// Event wiring — shared events + per-tab events

import { state, getTestCase, getSuite, uid } from './state.js';
import { els } from './dom.js';
import { connected, sendToExtension, connectToExtension, getTargetTabId, getTargetTabUrl, isTargetTabFromDb } from './connection.js';
import { renderSteps, renderTestCaseSelectors, renderStepObjectOptions, persistActiveTestCase } from './builder.js';
import { closeStepEditModal, saveStepEdit } from './modal.js';
import { renderSuiteSelectors, renderSuiteItems, persistActiveSuite } from './suite.js';
import * as api from './api.js';
import {
  setRecording,
  setRunButtonsState,
  renderRunSteps,
  renderSuitePreview,
  renderRunStepsForSuite,
  renderVariables,
  expandedTestCaseIds,
} from './run.js';
import { renderReports, hideScreenshotPreview } from './report.js';

// ==================== Shared Events ====================

export function wireSharedEvents() {
  // Connection
  els.btnConnect.addEventListener('click', () => {
    const extId = els.extIdInput.value.trim();
    if (!extId) { alert('Please paste the Extension ID first.'); return; }
    connectToExtension(extId);
  });

  els.btnRefreshTabs.addEventListener('click', () => {
    if (!connected) { alert('Please connect the Web App'); return; }
    sendToExtension('WA_LIST_TABS');
  });

  // Step edit modal (shared across tabs)
  els.btnModalClose.addEventListener('click', closeStepEditModal);
  els.btnModalCancel.addEventListener('click', closeStepEditModal);
  els.btnModalSave.addEventListener('click', saveStepEdit);
  els.stepEditOverlay.addEventListener('click', (e) => {
    if (e.target === els.stepEditOverlay) closeStepEditModal();
  });

  // Screenshot preview modal (shared across tabs)
  els.btnScreenshotClose.addEventListener('click', hideScreenshotPreview);
  els.screenshotOverlay.addEventListener('click', (e) => {
    if (e.target === els.screenshotOverlay) hideScreenshotPreview();
  });

  // Show/hide variable name row when action changes in modal
  els.editStepActionSelect.addEventListener('change', () => {
    const isExtract = els.editStepActionSelect.value === 'extract';
    els.editVariableNameRow.style.display = isExtract ? '' : 'none';
  });

  // Re-render all views when target tab changes (filter by tab URL)
  els.targetTabSelect.addEventListener('change', () => {
    renderStepObjectOptions();
    renderTestCaseSelectors();
    renderSteps();
    renderSuiteSelectors();
    renderSuiteItems();
    renderRunSteps();
    renderReports();
  });
}

// ==================== Builder Tab Events ====================

export function wireBuilderEvents() {
  // Test Case
  els.btnNewTestcase.addEventListener('click', async () => {
    const name = prompt('TC Name:', `Test case ${state.testCases.length + 1}`);
    if (!name) return;
    const tc = {
      id: uid('tc'),
      name,
      steps: [],
      createdAt: Date.now(),
      pageUrlPattern: getTargetTabUrl(),
    };
    state.testCases.push(tc);
    state.activeTestCaseId = tc.id;
    // Auto-save to DB
    try { await api.saveTestCasesToServer(); } catch (e) { console.error(e); }
    renderTestCaseSelectors();
    renderSteps();
  });

  els.testcaseSelect.addEventListener('change', () => {
    state.activeTestCaseId = els.testcaseSelect.value || null;
    renderTestCaseSelectors();
    renderSteps();
  });

  els.btnDeleteTestcase.addEventListener('click', async () => {
    const tc = getTestCase(state.activeTestCaseId);
    if (!tc || !confirm(`Delete Test Case "${tc.name}"?`)) return;
    state.testCases = state.testCases.filter((t) => t.id !== tc.id);
    state.activeTestCaseId = null;
    // Auto-save to DB
    try { await api.saveTestCasesToServer(); } catch (e) { console.error(e); }
    renderTestCaseSelectors();
    renderSteps();
  });

  // Recording
  els.btnRecordToggle.addEventListener('click', () => {
    if (!connected) { alert('Please connect to extension!'); return; }
    if (isTargetTabFromDb()) { alert('Please select a live Chrome Tab to record (URL Patterns are for filtering only).'); return; }
    const tabId = getTargetTabId();
    if (!tabId) { alert('Choose Target Tab'); return; }
    if (!state.activeTestCaseId) return;
    setRecording(!state.recording);
    sendToExtension(state.recording ? 'WA_START_RECORD' : 'WA_STOP_RECORD', { tabId });
  });

  // Add Step
  els.btnAddStep.addEventListener('click', () => {
    const tc = getTestCase(state.activeTestCaseId);
    if (!tc) { alert('Please select or create new testcase!'); return; }
    const action = els.stepActionSelect.value;
    const objectId = els.stepObjectSelect.value || null;
    const rawValue = els.stepValueInput.value;
    const variableName = els.stepVariableNameInput.value.trim();
    if (action !== 'wait' && action !== 'sendkey' && action !== 'openurl' && !objectId) {
      alert('Please scan objects in the extension before adding steps.');
      return;
    }

    const step = { id: uid('step'), action, objectId };
    if (action === 'input' || action === 'select') step.value = rawValue;
    if (action === 'verify') step.expectedValue = rawValue;
    if (action === 'wait') step.waitMs = parseInt(rawValue, 10) || 500;
    if (action === 'sendkey') step.value = rawValue;
    if (action === 'openurl') step.value = rawValue;
    if (action === 'extract') step.variableName = variableName || 'extractedValue';

    tc.steps.push(step);
    // Ensure pageUrlPattern is set from current target tab
    if (!tc.pageUrlPattern) {
      tc.pageUrlPattern = getTargetTabUrl();
    }
    els.stepValueInput.value = '';
    els.stepVariableNameInput.value = '';
    renderSteps();
    // Update dropdowns only — save to DB when clicking Save button
    renderTestCaseSelectors();
  });

  // Show/hide variable name input based on action
  els.stepActionSelect.addEventListener('change', () => {
    const isExtract = els.stepActionSelect.value === 'extract';
    els.stepVariableNameInput.style.display = isExtract ? '' : 'none';
  });

  // Save test cases to server
  els.btnSaveTcToServer.addEventListener('click', async () => {
    try {
      await api.saveTestCasesToServer();
      alert(`Saved ${state.testCases.length} test cases to server.`);
    } catch (e) {
      alert(`Failed to save test cases to server: ${e.message}`);
    }
  });

  // Load test cases from server
  els.btnLoadTcFromServer.addEventListener('click', async () => {
    try {
      await api.loadTestCasesFromServer();
      if (connected) sendToExtension('WA_SAVE_ALL_TEST_CASES', { testCases: state.testCases });
      renderTestCaseSelectors();
      renderSteps();
      alert(`Loaded ${state.testCases.length} test cases from server.`);
    } catch (e) {
      alert(`Failed to load test cases from server: ${e.message}`);
    }
  });
}

// ==================== Suite Tab Events ====================

export function wireSuiteEvents() {
  els.btnNewSuite.addEventListener('click', async () => {
    const name = prompt('New suite name:', `Suite ${state.testSuites.length + 1}`);
    if (!name) return;
    const suite = { id: uid('suite'), name, testCaseIds: [], createdAt: Date.now() };
    state.testSuites.push(suite);
    state.activeSuiteId = suite.id;
    // Auto-save to DB
    try { await api.saveTestSuitesToServer(); } catch (e) { console.error(e); }
    renderSuiteSelectors();
    renderSuiteItems();
  });

  els.suiteSelect.addEventListener('change', () => {
    state.activeSuiteId = els.suiteSelect.value || null;
    renderSuiteSelectors();
    renderSuiteItems();
  });

  els.btnDeleteSuite.addEventListener('click', async () => {
    const suite = getSuite(state.activeSuiteId);
    if (!suite || !confirm(`Delete suite "${suite.name}"?`)) return;
    state.testSuites = state.testSuites.filter((s) => s.id !== suite.id);
    state.activeSuiteId = null;
    // Auto-save to DB
    try { await api.saveTestSuitesToServer(); } catch (e) { console.error(e); }
    renderSuiteSelectors();
    renderSuiteItems();
  });

  els.btnSuiteAddTestcase.addEventListener('click', async () => {
    const suite = getSuite(state.activeSuiteId);
    if (!suite) { alert('Please select or create suite!'); return; }
    const tcId = els.suiteAddTestcaseSelect.value;
    if (!tcId) { alert('Please create testcase in Test Builder!'); return; }
    suite.testCaseIds.push(tcId);
    renderSuiteItems();
    await persistActiveSuite();
  });

  // Save test suites to server
  els.btnSaveSuiteToServer.addEventListener('click', async () => {
    try {
      await api.saveTestSuitesToServer();
      alert(`Saved ${state.testSuites.length} test suites to server.`);
    } catch (e) {
      alert(`Failed to save test suites to server: ${e.message}`);
    }
  });

  // Load test suites from server
  els.btnLoadSuiteFromServer.addEventListener('click', async () => {
    try {
      await api.loadTestSuitesFromServer();
      if (connected) sendToExtension('WA_SAVE_ALL_TEST_SUITES', { testSuites: state.testSuites });
      renderSuiteSelectors();
      renderSuiteItems();
      alert(`Loaded ${state.testSuites.length} test suites from server.`);
    } catch (e) {
      alert(`Failed to load test suites from server: ${e.message}`);
    }
  });

}

// ==================== Run Tab Events ====================

export function wireRunEvents() {
  els.runTestcaseSelect.addEventListener('change', () => renderRunSteps());

  els.runModeSelect.addEventListener('change', () => {
    const isSuite = els.runModeSelect.value === 'suite';
    els.runModeTestcaseDiv.style.display = isSuite ? 'none' : '';
    els.runModeSuiteDiv.style.display = isSuite ? '' : 'none';

    if (isSuite) {
      els.btnRunTestcase.disabled = true;
      els.btnRunSuite.disabled = false;
      renderSuitePreview();
    } else {
      els.btnRunTestcase.disabled = false;
      els.btnRunSuite.disabled = true;
      renderRunSteps();
    }
  });

  els.runSuiteSelect.addEventListener('change', () => renderSuitePreview());

  // Run buttons
  els.btnRunTestcase.addEventListener('click', () => {
    if (!connected) { alert('Please connect to extension!'); return; }

    // If DB URL pattern selected → navigate to that URL in current tab
    if (isTargetTabFromDb()) {
      const runUrl = getTargetTabUrl();
      if (!runUrl) { alert('No URL available for this tab.'); return; }
      const tc = getTestCase(els.runTestcaseSelect.value);
      if (!tc || tc.steps.length === 0) { alert('Test case is empty or not selected.'); return; }
      state.suiteRun = null;
      renderRunSteps();
      // Send URL instead of tabId — extension will navigate in current tab
      const payload = { url: runUrl, testCase: tc };
      sendToExtension('WA_RUN_TEST_CASE', payload);
      return;
    }

    // Chrome tab selected — use tabId as before
    const tabId = getTargetTabId();
    if (!tabId) { alert('Please select a Target Tab first.'); return; }

    if (els.runModeSelect.value === 'suite') {
      const suite = getSuite(els.runSuiteSelect.value);
      if (!suite || suite.testCaseIds.length === 0) { alert('Suite is empty or not selected.'); return; }
      sendToExtension('WA_RUN_TEST_SUITE', { tabId, suite });
      return;
    }

    const tc = getTestCase(els.runTestcaseSelect.value);
    if (!tc || tc.steps.length === 0) { alert('Test case is empty or not selected.'); return; }
    state.suiteRun = null;
    renderRunSteps();
    sendToExtension('WA_RUN_TEST_CASE', { tabId, testCase: tc });
  });

  els.btnRunSuite.addEventListener('click', () => {
    if (!connected) { alert('Please Connect to the extension first.'); return; }

    // If DB URL pattern selected → navigate to that URL in current tab
    if (isTargetTabFromDb()) {
      const runUrl = getTargetTabUrl();
      if (!runUrl) { alert('No URL available for this tab.'); return; }
      const suite = getSuite(els.runSuiteSelect.value);
      if (!suite || suite.testCaseIds.length === 0) { alert('Suite is empty or not selected.'); return; }

      const statuses = {};
      suite.testCaseIds.forEach((id) => { statuses[id] = 'pending'; });
      state.suiteRun = { suiteRunId: uid('sr'), testCaseIds: suite.testCaseIds, statuses };

      renderSuitePreview();
      renderRunStepsForSuite(suite.testCaseIds);
      expandedTestCaseIds.clear();
      suite.testCaseIds.forEach((tcId) => {
        expandedTestCaseIds.add(tcId);
      });
      els.runStepList.querySelectorAll('.suite-testcase-header').forEach((h) => {
        h.classList.add('expanded');
      });
      els.runStepList.querySelectorAll('.suite-testcase-steps').forEach((s) => {
        s.classList.add('expanded');
      });

      // Send URL instead of tabId — extension will navigate in current tab
      sendToExtension('WA_RUN_TEST_SUITE', { url: runUrl, suite });
      return;
    }

    // Chrome tab selected — use tabId as before
    const tabId = getTargetTabId();
    if (!tabId) { alert('Please select a Target Tab first.'); return; }
    const suite = getSuite(els.runSuiteSelect.value);
    if (!suite || suite.testCaseIds.length === 0) { alert('Suite is empty or not selected.'); return; }

    const statuses = {};
    suite.testCaseIds.forEach((id) => { statuses[id] = 'pending'; });
    state.suiteRun = { suiteRunId: uid('sr'), testCaseIds: suite.testCaseIds, statuses };

    renderSuitePreview();
    renderRunStepsForSuite(suite.testCaseIds);
    expandedTestCaseIds.clear();
    suite.testCaseIds.forEach((tcId) => {
      expandedTestCaseIds.add(tcId);
    });
    els.runStepList.querySelectorAll('.suite-testcase-header').forEach((h) => {
      h.classList.add('expanded');
    });
    els.runStepList.querySelectorAll('.suite-testcase-steps').forEach((s) => {
      s.classList.add('expanded');
    });

    sendToExtension('WA_RUN_TEST_SUITE', { tabId, suite });
  });

  // Cancel run
  els.btnCancelRun.addEventListener('click', () => {
    if (!state.running) return;
    sendToExtension('WA_CANCEL_RUN', {});
  });
}

// ==================== Report Tab Events ====================

export function wireReportEvents() {
  els.btnClearReports.addEventListener('click', async () => {
    if (!confirm(
      '🗑 Delete report history\n\n' +
      'This will delete all saved test results (PASS/FAIL).\n' +
      'Objects, Test Cases, and Test Suites remain unaffected.\n\n' +
      'Are you sure you want to continue?'
    )) return;
    // Clear reports from server
    try {
      await api.clearReportsFromServer();
      renderReports();
    } catch (e) {
      alert('Failed to clear reports: ' + e.message);
    }
  });

  els.btnClearStorage.addEventListener('click', () => {
    if (!confirm(
      '⚠️ Delete all storages\n\n' +
      'This action will permanently delete all data:\n' +
      '  • Object Repository (all scanned selectors)\n' +
      '  • Test Cases (all created tests)\n' +
      '  • Test Suites (all configured suites)\n' +
      '  • Reports (all saved test results)\n\n' +
      'This action CANNOT be undone.\n\n' +
      'Are you sure you want to continue?'
    )) return;
    sendToExtension('WA_CLEAR_ALL_STORAGE');
    state.objects = [];
    state.testCases = [];
    state.testSuites = [];
    state.reports = [];
    renderStepObjectOptions();
    renderTestCaseSelectors();
    renderSuiteSelectors();
    renderReports();
  });
}