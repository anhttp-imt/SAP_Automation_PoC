// Service worker: central hub. Message prefixes to avoid ambiguity/loops:
//   CS_*  content script -> background
//   BG_*  background -> content script
//   SP_*  side panel (internal, Scan only) -> background
//   EVT_* background -> side panel (broadcast, internal)
//   WA_*  Web App (external, via long-lived Port) <-> background

const STORAGE_KEYS = {
  OBJECTS: 'sap_automation_objects',
  TEST_CASES: 'sap_automation_test_cases',
  TEST_SUITES: 'sap_automation_test_suites',
  REPORTS: 'sap_automation_reports',
  VARIABLES: 'sap_automation_variables',
};

const ALLOWED_WEBAPP_ORIGIN = 'http://localhost:8787';
const externalPorts = new Set();
let cancelRun = false; // flag to cancel running test case / suite
let runVariables = {}; // runtime variables for extract/reuse during test execution

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Safe math expression evaluator (CSP compliant - no eval/Function)
function safeMathEval(expression) {
  // Tokenize: numbers, operators, parentheses
  const tokens = [];
  let i = 0;
  const expr = expression.replace(/\s/g, '');
  
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
    } else if ('+-*/'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
    } else if (ch >= '0' && ch <= '9' || ch === '.') {
      let num = '';
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        num += expr[i++];
      }
      tokens.push({ type: 'num', value: parseFloat(num) });
    } else {
      return { error: `Invalid character: ${ch}` };
    }
  }
  
  // Simple recursive descent parser
  let pos = 0;
  
  function parseExpr() {
    let left = parseTerm();
    while (pos < tokens.length && tokens[pos]?.type === 'op' && (tokens[pos].value === '+' || tokens[pos].value === '-')) {
      const op = tokens[pos++].value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  
  function parseTerm() {
    let left = parseFactor();
    while (pos < tokens.length && tokens[pos]?.type === 'op' && (tokens[pos].value === '*' || tokens[pos].value === '/')) {
      const op = tokens[pos++].value;
      const right = parseFactor();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  
  function parseFactor() {
    if (pos >= tokens.length) return 0;
    const token = tokens[pos];
    
    if (token.type === 'num') {
      pos++;
      return token.value;
    }
    
    if (token.type === 'op' && (token.value === '-' || token.value === '+')) {
      const sign = token.value === '-' ? -1 : 1;
      pos++;
      return sign * parseFactor();
    }
    
    if (token.type === 'paren' && token.value === '(') {
      pos++;
      const result = parseExpr();
      if (pos < tokens.length && tokens[pos]?.type === 'paren' && tokens[pos].value === ')') {
        pos++;
      }
      return result;
    }
    
    return 0;
  }
  
  const result = parseExpr();
  return { value: result };
}

async function getAll(key) {
  const data = await chrome.storage.local.get(key);
  return data[key] || [];
}

async function setAll(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'BG_PING' });
    return true;
  } catch (e) {
    // not injected yet, fall through to inject
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/selector-utils.js', 'content/content.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/content.css'],
    });
    return true;
  } catch (e) {
    console.error('SAP Automation PoC: cannot inject content script', e);
    return false;
  }
}

function broadcastToSidePanel(type, payload) {
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
}

function broadcastToWebApps(type, payload) {
  for (const port of externalPorts) {
    try {
      port.postMessage({ type, ...payload });
    } catch (e) {
      externalPorts.delete(port);
    }
  }
}

function notifyWebAppsDataChanged() {
  broadcastToWebApps('WA_EVT_DATA_CHANGED', {});
}

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab && tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (e) {
    // tab may have been closed - ensureContentScriptInjected will fail right after and report it
  }
}

// chrome.tabs.sendMessage has no built-in timeout: if the content script never calls
// sendResponse (e.g. stuck waiting on a busy indicator, or an unhandled exception before
// responding), the run hangs forever with no way to cancel it. Bound every step-execution
// call so a non-responding page fails that step instead of freezing the whole run.
function sendMessageWithTimeout(tabId, message, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs / 1000}s waiting for page response`));
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, message).then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// MV3 service workers are terminated by Chrome after ~30s without a qualifying chrome.*
// API call in flight. A test case with many steps/waits can easily go quiet longer than
// that from Chrome's point of view, killing the worker mid-run: the step loop is abandoned
// (run looks hung), the web app's port disconnects, and WA_CANCEL_RUN silently no-ops
// because there's nothing left listening. Ping a trivial API on an interval while a run is
// in progress to keep the worker alive for the whole run.
function startKeepAlive() {
  const timer = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
  return () => clearInterval(timer);
}

function waitForElement(tabId, selectors, timeoutMs = 10000, intervalMs = 300) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      if (cancelRun) {
        clearInterval(timer);
        resolve(false); // cancelled
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false); // timeout
        return;
      }
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: 'BG_CHECK_ELEMENT',
          selectors,
        });
        if (result && result.found) {
          clearInterval(timer);
          resolve(true);
        }
      } catch (e) {
        // content script not ready yet, keep waiting
      }
    }, intervalMs);
  });
}

// Resolve ${variableName} placeholders in step values
function resolveVariables(step) {
  const resolved = { ...step };
  if (resolved.value && typeof resolved.value === 'string') {
    resolved.value = resolved.value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      return runVariables[varName] !== undefined ? runVariables[varName] : match;
    });
  }
  if (resolved.expectedValue && typeof resolved.expectedValue === 'string') {
    resolved.expectedValue = resolved.expectedValue.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      return runVariables[varName] !== undefined ? runVariables[varName] : match;
    });
  }
  return resolved;
}

// suiteMeta (when this test case is run as part of a Suite): { suiteRunId, suiteName, index, count }
// Returns report.overallStatus ('pass' | 'fail') so runTestSuite can decide whether to continue.
async function runTestCase(tabId, testCase, suiteMeta = null) {
  if (!tabId) return 'fail';
  const stopKeepAlive = startKeepAlive();
  try {
    // Don't focus target tab so web app can still show realtime status.
    // Content script still works on non-visible tabs.
    // Screenshots may fail on non-visible tabs but are handled with try/catch.
    const ok = await ensureContentScriptInjected(tabId);
  if (!ok) {
    const failReport = {
      id: uid('rep'),
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      overallStatus: 'fail',
      steps: [],
      error: 'Cannot run on selected tab (page has permission restrictions).',
      ...(suiteMeta ? { suiteRunId: suiteMeta.suiteRunId, suiteName: suiteMeta.suiteName, suiteIndex: suiteMeta.index, suiteCount: suiteMeta.count } : {}),
    };
    // Reports are persisted by the web app (to MongoDB), not in chrome.storage.local —
    // storing per-step screenshots here risks hitting the storage quota and delays the run.
    broadcastToWebApps('WA_EVT_RUN_FINISHED', { report: failReport });
    // Reset cancelRun on early exit to avoid permanent lockout
    if (!suiteMeta) cancelRun = false;
    return 'fail';
  }

  const objects = await getAll(STORAGE_KEYS.OBJECTS);
  const report = {
    id: uid('rep'),
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    startedAt: Date.now(),
    finishedAt: null,
    overallStatus: 'running',
    steps: [],
    ...(suiteMeta ? { suiteRunId: suiteMeta.suiteRunId, suiteName: suiteMeta.suiteName, suiteIndex: suiteMeta.index, suiteCount: suiteMeta.count } : {}),
  };

  broadcastToWebApps('WA_EVT_RUN_STARTED', { testCaseId: testCase.id });

  // Reset variables only when NOT running as part of a suite
  // (suite-level reset happens in runTestSuite)
  if (!suiteMeta) {
    // Load persisted variables from storage instead of clearing
    const savedVars = await getAll(STORAGE_KEYS.VARIABLES);
    runVariables = savedVars || {};
  }

  for (const step of testCase.steps) {
    if (cancelRun) break;
    const objEntry = objects.find((o) => o.id === step.objectId);
    broadcastToWebApps('WA_EVT_STEP_RUNNING', { stepId: step.id });
    const start = Date.now();

    let result;
    let causedReload = false;

    if (step.action === 'wait') {
      await new Promise((r) => setTimeout(r, step.waitMs || 500));
      result = { status: 'pass', message: 'OK' };
    } else if (step.action === 'calculate') {
      // Calculate action - evaluate expression with variables and store result
      try {
        // Resolve variables in the expression first
        const resolvedStep = resolveVariables(step);
        let expression = resolvedStep.value ?? '';
        
        // Also resolve any remaining ${varName} that weren't in runVariables yet
        expression = expression.replace(/\$\{([^}]+)\}/g, (match, varName) => {
          return runVariables[varName] !== undefined ? runVariables[varName] : match;
        });
        
        // Safe math evaluation without eval/Function (CSP compliant)
        const calcResult = safeMathEval(expression);
        if (calcResult.error) {
          result = { status: 'fail', message: `Calculation error: ${calcResult.error}` };
        } else {
          const varName = step.variableName || 'result';
          runVariables[varName] = String(calcResult.value);
          await setAll(STORAGE_KEYS.VARIABLES, runVariables);
          broadcastToWebApps('WA_EVT_VARIABLE_SET', { variableName: varName, value: String(calcResult.value) });
          result = { status: 'pass', message: `Calculated: ${expression} = ${calcResult.value}` };
        }
      } catch (e) {
        result = { status: 'fail', message: `Calculation error: ${e.message}` };
      }
    } else if (step.action === 'openurl') {
      // Open URL in the target tab
      try {
        await chrome.tabs.update(tabId, { url: step.value });
        // Wait for page to fully load
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            chrome.tabs.get(tabId).then((tab) => {
              if (tab && tab.status === 'complete') {
                clearInterval(checkInterval);
                resolve();
              }
            }).catch(() => {
              clearInterval(checkInterval);
              resolve();
            });
          }, 200);
          setTimeout(resolve, 30000);
        });
        // Extra wait for SAP UI / SPA to finish rendering
        await new Promise((r) => setTimeout(r, 2000));
        // Re-inject content script after navigation (content scripts are lost on navigation)
        await ensureContentScriptInjected(tabId);
        // Wait for content script to be ready
        await new Promise((r) => setTimeout(r, 500));
        // Focus the target tab so user can see the navigation
        await focusTab(tabId);
        result = { status: 'pass', message: `Opened: ${step.value}` };
      } catch (e) {
        result = { status: 'fail', message: `Error opening URL: ${e.message}` };
      }
    } else if (step.action === 'extract') {
      // Extract action - find element, read value, store in variable
      try {
        result = await sendMessageWithTimeout(tabId, {
          type: 'BG_EXECUTE_STEP',
          step,
          selectors: objEntry.selectors,
        });
        if (result.status === 'pass' && result.extractedValue !== undefined) {
          const varName = step.variableName || 'extractedValue';
          runVariables[varName] = result.extractedValue;
          // Persist to storage so variables survive across runs
          await setAll(STORAGE_KEYS.VARIABLES, runVariables);
          broadcastToWebApps('WA_EVT_VARIABLE_SET', { variableName: varName, value: result.extractedValue });
        }
      } catch (e) {
        result = { status: 'fail', message: `Extract error: ${e.message}` };
      }
    } else if (step.action === 'sendkey' && (step.value || '').includes('F5')) {
      // Handle F5 reload directly in background - wait for page to fully load
      try {
        await chrome.tabs.reload(tabId);
        // Wait for page to reach 'complete' state
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            chrome.tabs.get(tabId).then((tab) => {
              if (tab && tab.status === 'complete') {
                clearInterval(checkInterval);
                resolve();
              }
            }).catch(() => {
              // Tab closed
              clearInterval(checkInterval);
              resolve();
            });
          }, 200);
          // Safety timeout after 30 seconds
          setTimeout(resolve, 30000);
        });
        // Extra wait for SAP UI / SPA to finish initial rendering
        await new Promise((r) => setTimeout(r, 2000));
        result = { status: 'pass', message: 'OK' };
        causedReload = true;
      } catch (e) {
        result = { status: 'fail', message: `Error reloading page: ${e.message}` };
      }
    } else if (!objEntry) {
      result = { status: 'fail', message: 'Object does not exist in repository' };
    } else {
      // Resolve variables in step value before sending to content script
      const resolvedStep = resolveVariables(step);
      try {
        result = await sendMessageWithTimeout(tabId, {
          type: 'BG_EXECUTE_STEP',
          step: resolvedStep,
          selectors: objEntry.selectors,
        });
      } catch (e) {
        result = { status: 'fail', message: `Communication error with page: ${e.message}` };
      }
    }

    let screenshotDataUrl = null;
    try {
      const tab = await chrome.tabs.get(tabId);
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
    } catch (e) {
      // capture can fail (e.g. devtools open, chrome:// page, tab not visible) - ignore
    }

    report.steps.push({
      stepId: step.id,
      status: result.status,
      message: result.message,
      durationMs: Date.now() - start,
      screenshotDataUrl, // Store screenshot in report so it persists after reload
    });
    // Send screenshot to web app in real-time (not stored in chrome.storage to avoid quota exceeded)
    broadcastToWebApps('WA_EVT_STEP_RESULT', { stepId: step.id, status: result.status, message: result.message, screenshotDataUrl });

    if (result.status === 'fail') report.overallStatus = 'fail';

    // After a reload (F5), re-inject content script and wait for page to be fully ready
    if (causedReload) {
      await ensureContentScriptInjected(tabId);
      // Wait for page to be interactive (SAP UI frameworks need extra time)
      try {
        const checkResult = await sendMessageWithTimeout(tabId, {
          type: 'BG_CHECK_PAGE_READY',
        }, 5000);
        if (!checkResult || !checkResult.ready) {
          // Page not ready yet, wait a bit more
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (e) {
        // Content script not ready, wait and retry
        await new Promise((r) => setTimeout(r, 2000));
        await ensureContentScriptInjected(tabId);
      }
    }

    // After click, wait for next step's element to appear AND be ready (SPA navigation)
    if (step.action === 'click' && result.status === 'pass') {
      const nextStep = testCase.steps[testCase.steps.indexOf(step) + 1];
      if (nextStep && nextStep.objectId) {
        const nextObj = objects.find((o) => o.id === nextStep.objectId);
        if (nextObj && nextObj.selectors) {
          await ensureContentScriptInjected(tabId);
          // Wait for element to appear in DOM
          await waitForElement(tabId, nextObj.selectors);
          // Additional wait for SAP UI / SPA to finish rendering
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
  }

  if (report.overallStatus === 'running') {
    if (cancelRun) {
      report.overallStatus = 'cancel';
    } else {
      report.overallStatus = 'pass';
    }
  }
  // Only reset cancel flag when NOT running as part of a suite
  // (runTestSuite handles the reset at the end)
  if (!suiteMeta) {
    cancelRun = false;
  }
  report.finishedAt = Date.now();

  // Reports are persisted by the web app (to MongoDB), not in chrome.storage.local —
  // storing per-step screenshots here risks hitting the storage quota and delays the run.
  broadcastToWebApps('WA_EVT_RUN_FINISHED', { report });
  return report.overallStatus;
  } finally {
    stopKeepAlive();
  }
}

// Run test cases sequentially in a Suite. Stops immediately when a test case fails (fail-fast).
async function runTestSuite(tabId, suite) {
  if (!tabId) return;
  try {
    const testCases = await getAll(STORAGE_KEYS.TEST_CASES);
    const suiteRunId = uid('suiterun');
    const count = suite.testCaseIds.length;

    // Reset variables at suite level (not per test case) so extracted values persist
    runVariables = {};
    await setAll(STORAGE_KEYS.VARIABLES, runVariables);

    broadcastToWebApps('WA_EVT_SUITE_STARTED', {
      suiteRunId,
      suiteId: suite.id,
      suiteName: suite.name,
      testCaseIds: suite.testCaseIds,
    });

    // Broadcast initial empty variables state
    broadcastToWebApps('WA_EVT_VARIABLES_RESET', {});

    let overallStatus = 'pass';
    for (let i = 0; i < suite.testCaseIds.length; i++) {
      if (cancelRun) break;
      const testCaseId = suite.testCaseIds[i];
      const tc = testCases.find((t) => t.id === testCaseId);
      if (!tc) {
        broadcastToWebApps('WA_EVT_SUITE_TESTCASE_FINISHED', { suiteRunId, testCaseId, status: 'fail' });
        overallStatus = 'fail';
        break;
      }

      broadcastToWebApps('WA_EVT_SUITE_TESTCASE_STARTED', { suiteRunId, testCaseId: tc.id, index: i, count });
      const status = await runTestCase(tabId, tc, { suiteRunId, suiteName: suite.name, index: i, count });
      broadcastToWebApps('WA_EVT_SUITE_TESTCASE_FINISHED', { suiteRunId, testCaseId: tc.id, status });

      if (status === 'fail') {
        overallStatus = 'fail';
        break; // fail-fast: dung ngay, khong chay cac test case con lai
      }
    }

    if (cancelRun) {
      overallStatus = 'cancel';
    }

    broadcastToWebApps('WA_EVT_SUITE_FINISHED', { suiteRunId, overallStatus });
  } finally {
    // Always reset cancelRun to avoid permanent lockout
    cancelRun = false;
  }
}

// ---------------- Events from content script (shared by Scan + Record + Run) ----------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  (async () => {
    switch (message.type) {
      case 'CS_OBJECT_CAPTURED': {
        const objects = await getAll(STORAGE_KEYS.OBJECTS);
        const entry = { id: uid('obj'), ...message.entry };
        objects.push(entry);
        await setAll(STORAGE_KEYS.OBJECTS, objects);
        broadcastToSidePanel('EVT_OBJECT_ADDED', { entry });
        broadcastToWebApps('WA_EVT_OBJECT_ADDED', { entry });
        break;
      }
      case 'CS_STEP_RECORDED': {
        const objects = await getAll(STORAGE_KEYS.OBJECTS);
        let objEntry = objects.find(
          (o) =>
            o.pageUrlPattern === message.objectEntry.pageUrlPattern &&
            o.selectors.css === message.objectEntry.selectors.css
        );
        if (!objEntry) {
          objEntry = { id: uid('obj'), ...message.objectEntry };
          objects.push(objEntry);
          await setAll(STORAGE_KEYS.OBJECTS, objects);
          broadcastToSidePanel('EVT_OBJECT_ADDED', { entry: objEntry });
          broadcastToWebApps('WA_EVT_OBJECT_ADDED', { entry: objEntry });
        }
        broadcastToWebApps('WA_EVT_STEP_ADDED', {
          step: { id: uid('step'), objectId: objEntry.id, ...message.step },
        });
        break;
      }

      // ---- commands from the Side Panel (Scan only) ----
      case 'SP_START_SCAN': {
        const tabId = await getActiveTabId();
        if (tabId && (await ensureContentScriptInjected(tabId))) {
          chrome.tabs.sendMessage(tabId, { type: 'BG_ENABLE_SCAN' }).catch(() => {});
        }
        sendResponse({ ok: true });
        break;
      }
      case 'SP_STOP_SCAN': {
        const tabId = await getActiveTabId();
        if (tabId) chrome.tabs.sendMessage(tabId, { type: 'BG_DISABLE_SCAN' }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }
      case 'SP_SCAN_ALL': {
        const tabId = await getActiveTabId();
        if (!tabId || !(await ensureContentScriptInjected(tabId))) {
          sendResponse({ objects: [] });
          break;
        }
        try {
          const result = await chrome.tabs.sendMessage(tabId, { type: 'BG_SCAN_ALL' });
          sendResponse({ objects: (result && result.objects) || [] });
        } catch (e) {
          sendResponse({ objects: [] });
        }
        break;
      }
      case 'SP_ADD_SCANNED_OBJECTS': {
        const objects = await getAll(STORAGE_KEYS.OBJECTS);
        const added = [];
        for (const entry of message.entries || []) {
          const obj = { id: uid('obj'), ...entry };
          objects.push(obj);
          added.push(obj);
        }
        await setAll(STORAGE_KEYS.OBJECTS, objects);
        added.forEach((entry) => broadcastToSidePanel('EVT_OBJECT_ADDED', { entry }));
        notifyWebAppsDataChanged();
        sendResponse({ ok: true, added });
        break;
      }
      case 'SP_HIGHLIGHT_ELEMENT': {
        const tabId = await getActiveTabId();
        if (tabId) chrome.tabs.sendMessage(tabId, { type: 'BG_HIGHLIGHT_ELEMENT', selectors: message.selectors }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }
      case 'SP_UNHIGHLIGHT_ELEMENT': {
        const tabId = await getActiveTabId();
        if (tabId) chrome.tabs.sendMessage(tabId, { type: 'BG_UNHIGHLIGHT_ELEMENT' }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }
      case 'SP_DELETE_OBJECT': {
        let objects = await getAll(STORAGE_KEYS.OBJECTS);
        objects = objects.filter((o) => o.id !== message.objectId);
        await setAll(STORAGE_KEYS.OBJECTS, objects);
        notifyWebAppsDataChanged();
        sendResponse({ ok: true });
        break;
      }
      case 'SP_RENAME_OBJECT': {
        const objects = await getAll(STORAGE_KEYS.OBJECTS);
        const obj = objects.find((o) => o.id === message.objectId);
        if (obj) obj.name = message.name;
        await setAll(STORAGE_KEYS.OBJECTS, objects);
        notifyWebAppsDataChanged();
        sendResponse({ ok: true });
        break;
      }
      case 'SP_GET_OBJECTS': {
        const objects = await getAll(STORAGE_KEYS.OBJECTS);
        sendResponse({ objects });
        break;
      }
      case 'SP_SAVE_ALL_OBJECTS': {
        if (message.objects !== undefined) {
          await setAll(STORAGE_KEYS.OBJECTS, message.objects);
          notifyWebAppsDataChanged();
        }
        sendResponse({ ok: true });
        break;
      }
      default:
        break;
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});

// ---------------- Web App connections (external, via chrome.runtime.connect) ----------------

chrome.runtime.onConnectExternal.addListener((port) => {
  const origin = port.sender && (port.sender.origin || (port.sender.url ? new URL(port.sender.url).origin : ''));
  if (origin !== ALLOWED_WEBAPP_ORIGIN) {
    port.disconnect();
    return;
  }

  externalPorts.add(port);
  port.onDisconnect.addListener(() => externalPorts.delete(port));

  port.onMessage.addListener((message) => {
    if (!message || typeof message.type !== 'string') return;

    (async () => {
      switch (message.type) {
        case 'WA_LIST_TABS': {
          const tabs = await chrome.tabs.query({});
          const list = tabs
            .filter((t) => t.url && /^https?:/.test(t.url) && !t.url.startsWith(ALLOWED_WEBAPP_ORIGIN))
            .map((t) => ({ id: t.id, title: t.title, url: t.url }));
          port.postMessage({ type: 'WA_TABS_LIST', tabs: list });
          break;
        }
        case 'WA_GET_ALL_DATA': {
          const [objects, testCases, testSuites, reports, variables] = await Promise.all([
            getAll(STORAGE_KEYS.OBJECTS),
            getAll(STORAGE_KEYS.TEST_CASES),
            getAll(STORAGE_KEYS.TEST_SUITES),
            getAll(STORAGE_KEYS.REPORTS),
            getAll(STORAGE_KEYS.VARIABLES),
          ]);
          port.postMessage({ type: 'WA_ALL_DATA', objects, testCases, testSuites, reports, variables });
          break;
        }
        case 'WA_SAVE_TEST_CASE': {
          const testCases = await getAll(STORAGE_KEYS.TEST_CASES);
          const idx = testCases.findIndex((t) => t.id === message.testCase.id);
          if (idx >= 0) testCases[idx] = message.testCase;
          else testCases.push(message.testCase);
          await setAll(STORAGE_KEYS.TEST_CASES, testCases);
          notifyWebAppsDataChanged();
          break;
        }
        case 'WA_DELETE_TEST_CASE': {
          let testCases = await getAll(STORAGE_KEYS.TEST_CASES);
          testCases = testCases.filter((t) => t.id !== message.testCaseId);
          await setAll(STORAGE_KEYS.TEST_CASES, testCases);
          notifyWebAppsDataChanged();
          break;
        }
        case 'WA_SAVE_TEST_SUITE': {
          const testSuites = await getAll(STORAGE_KEYS.TEST_SUITES);
          const idx = testSuites.findIndex((s) => s.id === message.suite.id);
          if (idx >= 0) testSuites[idx] = message.suite;
          else testSuites.push(message.suite);
          await setAll(STORAGE_KEYS.TEST_SUITES, testSuites);
          notifyWebAppsDataChanged();
          break;
        }
        case 'WA_DELETE_TEST_SUITE': {
          let testSuites = await getAll(STORAGE_KEYS.TEST_SUITES);
          testSuites = testSuites.filter((s) => s.id !== message.suiteId);
          await setAll(STORAGE_KEYS.TEST_SUITES, testSuites);
          notifyWebAppsDataChanged();
          break;
        }
        case 'WA_RUN_TEST_SUITE': {
          // DB URL mode: open URL in NEW tab, then run suite
          if (message.url) {
            (async () => {
              try {
                // Open URL in new tab
                const newTab = await chrome.tabs.create({ url: message.url, active: true });
                // Wait for page to fully load
                await new Promise((resolve) => {
                  const checkInterval = setInterval(() => {
                    chrome.tabs.get(newTab.id).then((tab) => {
                      if (tab && tab.status === 'complete') {
                        clearInterval(checkInterval);
                        resolve();
                      }
                    }).catch(() => {
                      clearInterval(checkInterval);
                      resolve();
                    });
                  }, 200);
                  setTimeout(resolve, 30000);
                });
                // Extra wait for SAP UI / SPA to finish rendering
                await new Promise((r) => setTimeout(r, 2000));
                // Inject content script in new tab
                await ensureContentScriptInjected(newTab.id);
                await new Promise((r) => setTimeout(r, 500));
                // Focus the new tab
                await focusTab(newTab.id);
                // Now run the suite
                runTestSuite(newTab.id, message.suite);
              } catch (e) {
                port.postMessage({ type: 'WA_RUN_ERROR', error: `Navigation failed: ${e.message}` });
              }
            })();
          } else {
            // Chrome tab mode: use tabId directly
            runTestSuite(message.tabId, message.suite);
          }
          break;
        }
        case 'WA_DELETE_OBJECT': {
          let objects = await getAll(STORAGE_KEYS.OBJECTS);
          objects = objects.filter((o) => o.id !== message.objectId);
          await setAll(STORAGE_KEYS.OBJECTS, objects);
          notifyWebAppsDataChanged();
          break;
        }
        case 'WA_RENAME_OBJECT': {
          const objects = await getAll(STORAGE_KEYS.OBJECTS);
          const obj = objects.find((o) => o.id === message.objectId);
          if (obj) obj.name = message.name;
          await setAll(STORAGE_KEYS.OBJECTS, objects);
          notifyWebAppsDataChanged();
          break;
        }
        case 'WA_START_RECORD': {
          if (message.tabId) {
            await focusTab(message.tabId);
            if (await ensureContentScriptInjected(message.tabId)) {
              chrome.tabs.sendMessage(message.tabId, { type: 'BG_ENABLE_RECORD' }).catch(() => {});
            }
          }
          break;
        }
        case 'WA_STOP_RECORD': {
          if (message.tabId) chrome.tabs.sendMessage(message.tabId, { type: 'BG_DISABLE_RECORD' }).catch(() => {});
          break;
        }
        case 'WA_RUN_TEST_CASE': {
          // DB URL mode: open URL in NEW tab, then run
          if (message.url) {
            (async () => {
              try {
                // Open URL in new tab
                const newTab = await chrome.tabs.create({ url: message.url, active: true });
                // Wait for page to fully load
                await new Promise((resolve) => {
                  const checkInterval = setInterval(() => {
                    chrome.tabs.get(newTab.id).then((tab) => {
                      if (tab && tab.status === 'complete') {
                        clearInterval(checkInterval);
                        resolve();
                      }
                    }).catch(() => {
                      clearInterval(checkInterval);
                      resolve();
                    });
                  }, 200);
                  setTimeout(resolve, 30000);
                });
                // Extra wait for SAP UI / SPA to finish rendering
                await new Promise((r) => setTimeout(r, 2000));
                // Inject content script in new tab
                await ensureContentScriptInjected(newTab.id);
                await new Promise((r) => setTimeout(r, 500));
                // Focus the new tab
                await focusTab(newTab.id);
                // Now run the test case
                runTestCase(newTab.id, message.testCase);
              } catch (e) {
                port.postMessage({ type: 'WA_RUN_ERROR', error: `Navigation failed: ${e.message}` });
              }
            })();
          } else {
            // Chrome tab mode: use tabId directly
            runTestCase(message.tabId, message.testCase);
          }
          break;
        }
        case 'WA_CANCEL_RUN': {
          cancelRun = true;
          break;
        }
        case 'WA_CLEAR_REPORTS': {
          await setAll(STORAGE_KEYS.REPORTS, []);
          break;
        }
        case 'WA_CLEAR_ALL_STORAGE': {
          await chrome.storage.local.clear();
          break;
        }
        case 'WA_SAVE_ALL_OBJECTS': {
          await setAll(STORAGE_KEYS.OBJECTS, message.objects || []);
          notifyWebAppsDataChanged();
          break;
        }
        case 'WA_SAVE_ALL_TEST_CASES': {
          await setAll(STORAGE_KEYS.TEST_CASES, message.testCases || []);
          notifyWebAppsDataChanged();
          break;
        }
        case 'WA_SAVE_ALL_TEST_SUITES': {
          await setAll(STORAGE_KEYS.TEST_SUITES, message.testSuites || []);
          notifyWebAppsDataChanged();
          break;
        }
        default:
          break;
      }
    })();
  });
});
