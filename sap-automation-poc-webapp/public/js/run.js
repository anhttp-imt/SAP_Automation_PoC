// Run tab: step list, suite preview, variables

import { state, getTestCase, getSuite, getObject, escapeHtml, stepSummary } from './state.js';
import { els } from './dom.js';

// Track expanded state per test case ID
export const expandedTestCaseIds = new Set();

// ---------------- Recording ----------------

export function setRecording(on) {
  state.recording = on;
  if (els.btnRecordToggle) {
    els.btnRecordToggle.textContent = on ? 'Stop Record' : 'Start Record';
    els.btnRecordToggle.classList.toggle('active', on);
  }
}

// ---------------- Run Buttons ----------------

export function setRunButtonsState(isRunning) {
  if (!els.btnRunTestcase) return; // Run tab not loaded yet
  if (isRunning) {
    els.btnRunTestcase.disabled = true;
    if (els.btnRunSuite) els.btnRunSuite.disabled = true;
  } else {
    const isSuite = els.runModeSelect && els.runModeSelect.value === 'suite';
    els.btnRunTestcase.disabled = isSuite;
    if (els.btnRunSuite) els.btnRunSuite.disabled = !isSuite;
  }
  els.btnCancelRun.disabled = !isRunning;
}

// ---------------- Variables ----------------

export function renderVariables() {
  if (!els.variablesPanel) return; // tab not loaded yet
  const keys = Object.keys(state.variables);
  if (keys.length === 0) {
    els.variablesPanel.style.display = 'none';
    return;
  }
  els.variablesPanel.style.display = '';
  els.variablesList.innerHTML = '';
  keys.forEach((key) => {
    const div = document.createElement('div');
    div.className = 'variable-item';
    div.innerHTML = `
      <span class="variable-name">${escapeHtml(key)}</span>
      <span class="variable-value">${escapeHtml(state.variables[key])}</span>
    `;
    els.variablesList.appendChild(div);
  });
}

// ---------------- Single Test Case Run ----------------

export function renderRunSteps(explicitTcId) {
  if (!els.runStepList) return; // tab not loaded yet
  const tc = getTestCase(explicitTcId || els.runTestcaseSelect.value);
  els.runStepList.innerHTML = '';
  const steps = tc ? tc.steps : [];
  els.runEmpty.classList.toggle('visible', steps.length === 0);

  steps.forEach((step, idx) => {
    const li = document.createElement('li');
    li.className = 'item-card';
    li.dataset.stepId = step.id;
    li.innerHTML = `
      <div class="item-card-row">
        <span class="item-title">${idx + 1}. ${escapeHtml(stepSummary(step))}</span>
        <span class="status-chip status-pending">pending</span>
      </div>
      <span class="item-sub run-msg"></span>
    `;
    els.runStepList.appendChild(li);
  });
}

export function updateRunStepStatus(stepId, status, message) {
  const li = els.runStepList.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`);
  if (!li) return;
  const chip = li.querySelector('.status-chip');
  chip.className = `status-chip status-${status}`;
  chip.textContent = status;
  li.querySelector('.run-msg').textContent = message || '';
}

// ---------------- Suite Preview ----------------

export function renderSuitePreview() {
  if (!els.runStepList) return; // tab not loaded yet
  els.runStepList.innerHTML = '';
  const suite = getSuite(els.runSuiteSelect.value);
  if (!suite || suite.testCaseIds.length === 0) {
    els.runEmpty.classList.add('visible');
    return;
  }
  els.runEmpty.classList.remove('visible');

  suite.testCaseIds.forEach((tcId, tcIdx) => {
    const tc = getTestCase(tcId);
    if (!tc) return;

    // Create section wrapper
    const section = document.createElement('div');
    section.className = 'suite-testcase-section';
    section.dataset.testCaseId = tcId;

    // Header (clickable)
    const header = document.createElement('div');
    header.className = 'suite-testcase-header';
    header.innerHTML = `
      <span class="item-title">
        <span class="expand-icon">▶</span>
        Test Case ${tcIdx + 1}: ${escapeHtml(tc.name)} <span style="color:var(--muted); font-weight:400; font-size:12px;">(${tc.steps.length} steps)</span>
      </span>
      <span class="status-chip status-pending" data-suite-tc="${CSS.escape(tcId)}">pending</span>
    `;
    header.addEventListener('click', () => {
      const isExpanded = expandedTestCaseIds.has(tcId);
      if (isExpanded) {
        expandedTestCaseIds.delete(tcId);
        header.classList.remove('expanded');
        stepsContainer.classList.remove('expanded');
      } else {
        expandedTestCaseIds.add(tcId);
        header.classList.add('expanded');
        stepsContainer.classList.add('expanded');
      }
    });

    // Steps container (collapsible)
    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'suite-testcase-steps';

    tc.steps.forEach((step, stepIdx) => {
      const li = document.createElement('div');
      li.className = 'suite-step item-card';
      li.dataset.stepId = step.id;
      li.dataset.testCaseId = tcId;
      li.innerHTML = `
        <div class="item-card-row">
          <span class="item-title">${tcIdx + 1}.${stepIdx + 1}. ${escapeHtml(stepSummary(step))}</span>
          <span class="status-chip status-pending">pending</span>
        </div>
        <span class="item-sub run-msg"></span>
      `;
      stepsContainer.appendChild(li);
    });

    section.appendChild(header);
    section.appendChild(stepsContainer);
    els.runStepList.appendChild(section);
  });
}

export function renderRunStepsForSuite(testCaseIds) {
  if (!els.runStepList) return; // tab not loaded yet
  // Reset all status chips on existing list (don't rebuild DOM)
  els.runStepList.querySelectorAll('.status-chip').forEach((chip) => {
    chip.className = 'status-chip status-pending';
    chip.textContent = 'pending';
  });
  els.runStepList.querySelectorAll('.run-msg').forEach((msg) => {
    msg.textContent = '';
  });
  // Clear expanded state
  expandedTestCaseIds.clear();
  els.runStepList.querySelectorAll('.suite-testcase-header').forEach((h) => {
    h.classList.remove('expanded');
  });
  els.runStepList.querySelectorAll('.suite-testcase-steps').forEach((s) => {
    s.classList.remove('expanded');
  });
}

export function updateSuiteTestCaseStatus(tcId, status) {
  const chip = els.runStepList.querySelector(`[data-suite-tc="${CSS.escape(tcId)}"]`);
  if (!chip) return;
  chip.className = `status-chip status-${status}`;
  chip.textContent = status;

  // Auto-expand when test case starts running
  if (status === 'running') {
    const section = chip.closest('.suite-testcase-section');
    if (section) {
      const header = section.querySelector('.suite-testcase-header');
      const stepsContainer = section.querySelector('.suite-testcase-steps');
      expandedTestCaseIds.add(tcId);
      header.classList.add('expanded');
      stepsContainer.classList.add('expanded');
    }
  }
}