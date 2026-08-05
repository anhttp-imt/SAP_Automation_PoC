// Step Edit Modal

import { state, getTestCase, getObject } from './state.js';
import { els } from './dom.js';
import { renderSteps, persistActiveTestCase } from './builder.js';

let editingStepIndex = null;

export function openStepEditModal(idx) {
  const tc = getTestCase(state.activeTestCaseId);
  if (!tc) return;
  const step = tc.steps[idx];
  editingStepIndex = idx;

  // Populate object select
  els.editStepObjectSelect.innerHTML = '';
  if (state.objects.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '(No Object)';
    opt.value = '';
    els.editStepObjectSelect.appendChild(opt);
  } else {
    state.objects.forEach((obj) => {
      const opt = document.createElement('option');
      opt.value = obj.id;
      opt.textContent = obj.name;
      if (obj.id === step.objectId) opt.selected = true;
      els.editStepObjectSelect.appendChild(opt);
    });
  }

  // Set action
  els.editStepActionSelect.value = step.action;

  // Set value based on action
  let value = '';
  if (step.action === 'input' || step.action === 'select') value = step.value ?? '';
  else if (step.action === 'verify') value = step.expectedValue ?? '';
  else if (step.action === 'wait') value = String(step.waitMs ?? 500);
  else if (step.action === 'openurl') value = step.value ?? '';
  else if (step.action === 'extract') value = step.variableName || '';
  els.editStepValueInput.value = value;

  // Show/hide variable name row based on action
  els.editVariableNameRow.style.display = step.action === 'extract' ? '' : 'none';
  if (step.action === 'extract') {
    els.editStepVariableNameInput.value = step.variableName || '';
  }

  els.stepEditOverlay.classList.add('active');
}

export function closeStepEditModal() {
  els.stepEditOverlay.classList.remove('active');
  editingStepIndex = null;
}

export function saveStepEdit() {
  const tc = getTestCase(state.activeTestCaseId);
  if (!tc || editingStepIndex === null) return;

  const step = tc.steps[editingStepIndex];
  const action = els.editStepActionSelect.value;
  const objectId = els.editStepObjectSelect.value || null;
  const rawValue = els.editStepValueInput.value;
  const variableName = els.editStepVariableNameInput.value.trim();

  step.action = action;
  step.objectId = objectId;
  delete step.value;
  delete step.expectedValue;
  delete step.waitMs;
  delete step.variableName;

  if (action === 'input' || action === 'select') step.value = rawValue;
  if (action === 'verify') step.expectedValue = rawValue;
  if (action === 'wait') step.waitMs = parseInt(rawValue, 10) || 500;
  if (action === 'sendkey') step.value = rawValue;
  if (action === 'openurl') step.value = rawValue;
  if (action === 'extract') step.variableName = variableName || 'extractedValue';

  closeStepEditModal();
  renderSteps();
  persistActiveTestCase();
}