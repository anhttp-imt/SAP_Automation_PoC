// DOM element cache & tab initialization with lazy template loading

export const els = {};
export const $ = (id) => document.getElementById(id);

// Template cache: { builder: '<html...>', suite: null, ... }
const templateCache = {};

// Which tabs have been loaded
const loadedTabs = new Set();

// Per-tab element cache functions (called after template injection)
const tabCacheFns = {
  builder() {
    Object.assign(els, {
      testcaseSelect: $('testcase-select'),
      btnNewTestcase: $('btn-new-testcase'),
      btnDeleteTestcase: $('btn-delete-testcase'),
      btnRecordToggle: $('btn-record-toggle'),
      stepList: $('step-list'),
      stepEmpty: $('step-empty'),
      stepObjectSelect: $('step-object-select'),
      stepActionSelect: $('step-action-select'),
      stepValueInput: $('step-value-input'),
      stepVariableNameInput: $('step-variable-name-input'),
      btnAddStep: $('btn-add-step'),
      btnExportTc: $('btn-export-tc'),
      btnImportTc: $('btn-import-tc'),
      importTcFileInput: $('import-tc-file-input'),
    });
  },
  suite() {
    Object.assign(els, {
      suiteSelect: $('suite-select'),
      btnNewSuite: $('btn-new-suite'),
      btnDeleteSuite: $('btn-delete-suite'),
      suiteItemList: $('suite-item-list'),
      suiteEmpty: $('suite-empty'),
      suiteAddTestcaseSelect: $('suite-add-testcase-select'),
      btnSuiteAddTestcase: $('btn-suite-add-testcase'),
      btnExportSuite: $('btn-export-suite'),
      btnImportSuite: $('btn-import-suite'),
      importSuiteFileInput: $('import-suite-file-input'),
    });
  },
  run() {
    Object.assign(els, {
      runModeSelect: $('run-mode-select'),
      runModeTestcaseDiv: $('run-mode-testcase'),
      runModeSuiteDiv: $('run-mode-suite'),
      runTestcaseSelect: $('run-testcase-select'),
      runSuiteSelect: $('run-suite-select'),
      runStepList: $('run-step-list'),
      runEmpty: $('run-empty'),
      variablesPanel: $('variables-panel'),
      variablesList: $('variables-list'),
      btnRunTestcase: $('btn-run-testcase'),
      btnRunSuite: $('btn-run-suite'),
      btnCancelRun: $('btn-cancel-run'),
    });
  },
  report() {
    Object.assign(els, {
      reportList: $('report-list'),
      reportEmpty: $('report-empty'),
      btnClearReports: $('btn-clear-reports'),
      btnClearStorage: $('btn-clear-storage'),
    });
  },
};

/**
 * Fetch a template HTML file, cache it, and return the HTML string.
 */
export async function fetchTemplate(name) {
  if (templateCache[name] !== undefined) {
    return templateCache[name];
  }
  const res = await fetch(`templates/${name}.html`);
  if (!res.ok) throw new Error(`Failed to load template: ${name}`);
  templateCache[name] = await res.text();
  return templateCache[name];
}

/**
 * Load a tab panel: fetch template → inject into <main> → cache elements → wire events → refresh data.
 * wireFn is the per-tab event wiring function.
 * refreshFn is called after load to populate data (selectors, lists, etc.).
 */
export async function loadTab(name, wireFn, refreshFn) {
  if (loadedTabs.has(name)) return; // already loaded
  loadedTabs.add(name);

  const html = await fetchTemplate(name);
  const main = document.querySelector('main');
  main.insertAdjacentHTML('beforeend', html);

  // Cache elements for this tab
  if (tabCacheFns[name]) tabCacheFns[name]();

  // Wire tab-specific events
  if (wireFn) wireFn();

  // Refresh data for this tab (populate selectors, lists, etc.)
  if (refreshFn) refreshFn();
}

/**
 * Cache shared elements (header, connect bar, target bar, modal).
 * Called once on init.
 */
export function cacheElements() {
  Object.assign(els, {
    extIdInput: $('ext-id-input'),
    btnConnect: $('btn-connect'),
    connectStatus: $('connect-status'),
    targetTabSelect: $('target-tab-select'),
    btnRefreshTabs: $('btn-refresh-tabs'),
    // Modal elements (always present in index.html)
    stepEditOverlay: $('step-edit-overlay'),
    editStepObjectSelect: $('edit-step-object-select'),
    editStepActionSelect: $('edit-step-action-select'),
    editStepValueInput: $('edit-step-value-input'),
    editStepVariableNameInput: $('edit-step-variable-name-input'),
    editVariableNameRow: $('edit-variable-name-row'),
    btnModalClose: $('btn-modal-close'),
    btnModalCancel: $('btn-modal-cancel'),
    btnModalSave: $('btn-modal-save'),
    // Screenshot preview modal elements (always present in index.html)
    screenshotOverlay: $('screenshot-overlay'),
    screenshotPreviewImg: $('screenshot-preview-img'),
    btnScreenshotClose: $('btn-screenshot-close'),
  });
}

/**
 * Initialize tab switching.
 * On click: activate tab button + load panel if not loaded.
 * config: { builder: { wireFn, refreshFn }, suite: { wireFn, refreshFn }, ... }
 */
export function initTabs(config = {}) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tabName = btn.dataset.tab;

      // Update active states on tab buttons
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Hide all tab panels
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

      const tabConfig = config[tabName] || {};

      // Load tab if not already loaded
      await loadTab(tabName, tabConfig.wireFn, tabConfig.refreshFn);

      // Show the panel
      const panel = $(`tab-${tabName}`);
      if (panel) panel.classList.add('active');
    });
  });
}