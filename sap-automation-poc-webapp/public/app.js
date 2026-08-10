// Main entry point — message handling & initialization

import { state, uid, getTestCase } from './js/state.js';
import { els, $, cacheElements, initTabs, loadTab } from './js/dom.js';
import {
  connected,
  connectToExtension,
  sendToExtension,
  renderTabOptions,
  setPortMessageHandler,
  getTargetTabUrl,
} from './js/connection.js';
import {
  renderSteps,
  renderTestCaseSelectors,
  renderStepObjectOptions,
} from './js/builder.js';
import { renderSuiteSelectors, renderSuiteItems } from './js/suite.js';
import {
  setRunButtonsState,
  renderRunSteps,
  renderSuitePreview,
  renderRunStepsForSuite,
  updateRunStepStatus,
  updateSuiteTestCaseStatus,
  renderVariables,
  expandedTestCaseIds,
} from './js/run.js';
import { renderReports, clearScreenshotsCache } from './js/report.js';
import {
  wireSharedEvents,
  wireBuilderEvents,
  wireSuiteEvents,
  wireRunEvents,
  wireReportEvents,
} from './js/events.js';
import * as api from './js/api.js';

// Cached DB pageUrlPatterns (loaded from server on init)
let dbPageUrlPatterns = [];

/**
 * Refresh DB pageUrlPatterns from server, then re-render target tab dropdown.
 */
async function refreshDbPageUrlPatterns() {
  try {
    const res = await fetch('/api/target-tabs');
    dbPageUrlPatterns = await res.json();
  } catch (e) {
    console.error('[Frontend] Failed to load target tabs from server:', e);
  }
  // Re-render merged tab list (Chrome tabs + DB patterns)
  refreshTargetTabDropdown();
}

/**
 * Re-render the target tab dropdown with current Chrome tabs + DB patterns.
 * Called after DB patterns change or Chrome tabs change.
 */
function refreshTargetTabDropdown() {
  // Get current Chrome tabs from extension if connected
  let chromeTabs = [];
  if (connected) {
    sendToExtension('WA_LIST_TABS');
  }
  // If not connected, still show DB patterns
  if (!connected && dbPageUrlPatterns.length > 0) {
    const dbTabs = dbPageUrlPatterns.map((p) => {
      let hash = 0;
      const normalized = p.trim();
      for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
      }
      return {
        id: `db_${Math.abs(hash).toString(36)}`,
        pageUrlPattern: p,
        url: p,
        title: '',
        source: 'db',
      };
    });
    renderTabOptions(dbTabs);
  }
}

// Also update DB patterns from in-memory state (after WA_ALL_DATA or server load)
function updateDbPatternsFromState() {
  const patterns = new Set();
  state.objects.forEach((o) => {
    if (o.pageUrlPattern && o.pageUrlPattern.trim()) patterns.add(o.pageUrlPattern.trim());
  });
  state.testCases.forEach((tc) => {
    if (tc.pageUrlPattern && tc.pageUrlPattern.trim()) patterns.add(tc.pageUrlPattern.trim());
  });
  dbPageUrlPatterns = [...patterns];
}

// ---------------- Port Message Handler ----------------

async function handlePortMessage(message) {
  if (!message || typeof message.type !== 'string') return;
  switch (message.type) {
    case 'WA_TABS_LIST': {
      // Merge Chrome tabs with DB pageUrlPatterns
      const chromeTabs = (message.tabs || []).map((t) => ({
        id: String(t.id),
        url: t.url || '',
        title: t.title || '',
        source: 'chrome',
      }));
      // Get URLs already covered by Chrome tabs (normalized)
      const chromeUrls = new Set(chromeTabs.map((t) => (t.url || '').trim().toLowerCase()));
      // Use hash of URL pattern as ID for stability across re-renders
      const dbTabs = dbPageUrlPatterns
        .filter((p) => !chromeUrls.has(p.trim().toLowerCase())) // Deduplicate against Chrome tabs
        .map((p) => {
          // Simple hash: convert URL pattern to a stable numeric ID
          let hash = 0;
          const normalized = p.trim();
          for (let i = 0; i < normalized.length; i++) {
            hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
          }
          return {
            id: `db_${Math.abs(hash).toString(36)}`,
            pageUrlPattern: p,
            url: p,
            title: '',
            source: 'db',
          };
        });
      renderTabOptions([...chromeTabs, ...dbTabs]);
      break;
    }
    case 'WA_ALL_DATA':
      // Data source is now DB only — do NOT overwrite state from extension.
      // Extension is only used for runtime (record, run, tab listing).
      // Objects, test cases, test suites are loaded from server in init().
      console.log('[Frontend] WA_ALL_DATA received but ignored — using DB as data source.');
      break;
    case 'WA_EVT_OBJECT_ADDED': {
      const currentTabUrl = getTargetTabUrl();
      const entry = {
        ...message.entry,
        // Priority: extension's pageUrlPattern > parentUrl > url > current target tab URL
        pageUrlPattern: message.entry.pageUrlPattern || message.entry.parentUrl || message.entry.url || currentTabUrl,
      };
      // Update existing object or add new one
      const existingIdx = state.objects.findIndex((o) => o.id === entry.id);
      if (existingIdx !== -1) {
        state.objects[existingIdx] = entry;
      } else {
        state.objects.push(entry);
      }
      renderStepObjectOptions();
      renderSteps();
      // Not auto-saved: user must click "Save to Server" in the extension Side Panel
      // to persist to DB, same as rename/delete — then Refresh here to see it.
      break;
    }
    case 'WA_EVT_STEP_ADDED': {
      let tc = getTestCase(state.activeTestCaseId);
      if (!tc) {
        // No active TC — create one and notify user
        tc = { id: uid('tc'), name: `Recorded ${new Date().toLocaleTimeString('en-US')}`, steps: [], createdAt: Date.now(), pageUrlPattern: getTargetTabUrl() };
        state.testCases.push(tc);
        state.activeTestCaseId = tc.id;
        renderTestCaseSelectors();
        console.log(`[Frontend] Auto-created TC "${tc.name}" for recorded step.`);
      }
      // Check for duplicate in real-time — mark with _duplicateOf badge immediately
      const dupIdx = tc.steps.findIndex(s =>
        s.objectId === message.step.objectId && s.action === message.step.action
      );
      if (dupIdx >= 0) {
        message.step._duplicateOf = dupIdx;
      }
      tc.steps.push(message.step);
      renderSteps();
      renderTestCaseSelectors();
      break;
    }
    case 'WA_EVT_RUN_STARTED':
      state.running = true;
      renderVariables();
      setRunButtonsState(true);
      if (!state.suiteRun) {
        renderRunSteps();
      }
      break;
    case 'WA_EVT_VARIABLE_SET':
      state.variables[message.variableName] = message.value;
      renderVariables();
      break;
    case 'WA_EVT_STEP_RUNNING':
      updateRunStepStatus(message.stepId, 'running', '');
      break;
    case 'WA_EVT_STEP_RESULT':
      updateRunStepStatus(message.stepId, message.status, message.message);
      break;
    case 'WA_EVT_RUN_FINISHED':
      state.running = false;
      setRunButtonsState(false);
      // Save report to server FIRST, then update UI
      if (message.report) {
        try {
          await api.saveReportToServer(message.report);
          state.reports.unshift(message.report);
        } catch (e) {
          console.error('Failed to save report to server:', e);
          // Still show report in UI but warn user
          state.reports.unshift(message.report);
          alert('Report saved to UI but failed to persist to server. It may be lost on refresh.');
        }
        renderReports();
      }
      break;
    case 'WA_EVT_SUITE_STARTED': {
      state.running = true;
      state.variables = {};
      renderVariables();
      setRunButtonsState(true);
      const statuses = {};
      (message.testCaseIds || []).forEach((id) => { statuses[id] = 'pending'; });
      state.suiteRun = { suiteRunId: message.suiteRunId, testCaseIds: message.testCaseIds || [], statuses };
      renderRunStepsForSuite(message.testCaseIds);
      expandedTestCaseIds.clear();
      message.testCaseIds.forEach((tcId) => {
        expandedTestCaseIds.add(tcId);
      });
      els.runStepList.querySelectorAll('.suite-testcase-header').forEach((h) => {
        h.classList.add('expanded');
      });
      els.runStepList.querySelectorAll('.suite-testcase-steps').forEach((s) => {
        s.classList.add('expanded');
      });
      break;
    }
    case 'WA_EVT_SUITE_TESTCASE_STARTED': {
      if (state.suiteRun) state.suiteRun.statuses[message.testCaseId] = 'running';
      break;
    }
    case 'WA_EVT_SUITE_TESTCASE_FINISHED': {
      if (state.suiteRun) state.suiteRun.statuses[message.testCaseId] = message.status;
      updateSuiteTestCaseStatus(message.testCaseId, message.status);
      break;
    }
    case 'WA_EVT_SUITE_FINISHED':
      state.running = false;
      setRunButtonsState(false);
      break;
    case 'WA_RUN_ERROR':
      // Note: no alert() here — this arrives async on a port message, and a blocking
      // alert() freezes all page JS (including pending fetch/render) until dismissed,
      state.running = false;
      setRunButtonsState(false);
      console.error('[Run] Extension reported an error:', message.error);
      break;
    case 'WA_EVT_DATA_CHANGED':
      // Data changes from extension are ignored — DB is the source of truth.
      // If user needs to sync, they should use Save/Load buttons.
      break;
    case 'WA_EVT_PORT_DISCONNECTED':
      // SW died mid-run — reset running state to prevent permanent UI freeze
      state.running = false;
      state.suiteRun = null;
      setRunButtonsState(false);
      break;
    default:
      break;
  }
}

// ---------------- Report API Helpers (with render) ----------------

async function loadReportsFromServer() {
  try {
    const res = await fetch('/api/reports');
    state.reports = await res.json();
    clearScreenshotsCache();
    renderReports();
  } catch (e) {
    console.error('[Frontend] Failed to load reports from server:', e);
  }
}

// ---------------- Init ----------------

async function init() {
  // Register message handler BEFORE any connection attempt
  setPortMessageHandler(handlePortMessage);

  // Cache shared elements (header, connect bar, modal, etc.)
  cacheElements();

  // Wire shared events (connection, modal)
  wireSharedEvents();

  // Load all data from server (independent of extension connection)
  await Promise.all([
    api.loadReportsFromServer(),
    api.loadObjectsFromServer(),
    api.loadTestCasesFromServer(),
    api.loadTestSuitesFromServer(),
  ]);
  // Load DB pageUrlPatterns for target tab dropdown
  await refreshDbPageUrlPatterns();
  // Also update from in-memory state (objects + test cases just loaded)
  updateDbPatternsFromState();
  // Render reports after loading
  renderReports();

  // Initialize tabs with per-tab event wiring + refresh functions
  initTabs({
    builder: {
      wireFn: wireBuilderEvents,
      refreshFn: async () => {
        await api.loadTestCasesFromServer();
        await api.loadObjectsFromServer();
        renderStepObjectOptions();
        renderTestCaseSelectors();
        renderSteps();
      },
    },
    suite: {
      wireFn: wireSuiteEvents,
      refreshFn: async () => {
        await api.loadTestSuitesFromServer();
        await api.loadTestCasesFromServer();
        renderSuiteSelectors();
        renderSuiteItems();
      },
    },
    run: {
      wireFn: wireRunEvents,
      refreshFn: async () => {
        await api.loadTestCasesFromServer();
        await api.loadTestSuitesFromServer();
        renderTestCaseSelectors();
        renderSuiteSelectors();
        renderVariables();
        renderRunSteps();
        if (els.runModeSelect && els.runModeSelect.value === 'suite') {
          renderSuitePreview();
        }
      },
    },
    report: {
      wireFn: wireReportEvents,
      refreshFn: async () => {
        await api.loadReportsFromServer();
        renderReports();
      },
    },
  });

  // Pre-load Builder tab as default
  await loadTab('builder', wireBuilderEvents, () => {
    renderStepObjectOptions();
    renderTestCaseSelectors();
    renderSteps();
  });
  const builderPanel = $('tab-builder');
  if (builderPanel) builderPanel.classList.add('active');

  // btnRunSuite is only available after run tab is loaded (lazy)
  // setRunButtonsState will handle button states when run tab opens

  // Restore last connected extension ID
  const savedId = localStorage.getItem('sap_automation_poc_ext_id');
  if (savedId) {
    els.extIdInput.value = savedId;
    connectToExtension(savedId);
  }
}

init();
