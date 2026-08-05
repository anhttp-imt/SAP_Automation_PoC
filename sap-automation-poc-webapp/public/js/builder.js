// Test Builder: step list rendering, CRUD, drag-drop

import { state, getTestCase, getObject, escapeHtml, stepSummary, uid } from './state.js';
import { els } from './dom.js';
import { sendToExtension } from './connection.js';
import { openStepEditModal } from './modal.js';
import * as api from './api.js';

// ---------------- Step List Rendering ----------------

export function renderSteps() {
  if (!els.stepList) return; // tab not loaded yet
  const tc = getTestCase(state.activeTestCaseId);
  els.stepList.innerHTML = '';
  const steps = tc ? tc.steps : [];
  els.stepEmpty.classList.toggle('visible', steps.length === 0);

  steps.forEach((step, idx) => {
    const li = document.createElement('li');
    li.className = 'item-card';
    li.draggable = true;
    li.dataset.stepIndex = idx;
    li.innerHTML = `
      <div class="item-card-row">
        <span class="drag-handle" title="Drag to reorder">☰</span>
        <span class="item-title">${idx + 1}. ${escapeHtml(stepSummary(step))}</span>
        <span class="item-actions">
          <button data-action="up" title="Up">↑</button>
          <button data-action="down" title="Down">↓</button>
          <button data-action="edit" title="Edit">✏️</button>
          <button data-action="delete" title="Delete">🗑</button>
        </span>
      </div>
    `;
    li.querySelector('[data-action="up"]').addEventListener('click', () => moveStep(idx, -1));
    li.querySelector('[data-action="down"]').addEventListener('click', () => moveStep(idx, 1));
    li.querySelector('[data-action="edit"]').addEventListener('click', () => openStepEditModal(idx));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteStep(idx));

    // Drag and drop events
    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragend', handleDragEnd);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('dragleave', handleDragLeave);
    li.addEventListener('drop', handleDrop);

    els.stepList.appendChild(li);
  });
}

// ---------------- Test Case Selectors ----------------

export function renderTestCaseSelectors() {
  if (!els.testcaseSelect) return; // tab not loaded yet
  // Update Builder tab selector
  {
    const prevValue = els.testcaseSelect.value;
    els.testcaseSelect.innerHTML = '';
    if (state.testCases.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '(No Test Case)';
      opt.value = '';
      els.testcaseSelect.appendChild(opt);
    } else {
      state.testCases.forEach((tc) => {
        const opt = document.createElement('option');
        opt.value = tc.id;
        opt.textContent = `${tc.name} (${tc.steps.length} step)`;
        els.testcaseSelect.appendChild(opt);
      });
    }
    if (prevValue && state.testCases.some((t) => t.id === prevValue)) els.testcaseSelect.value = prevValue;
  }
  // Update Run tab selector (may not be loaded yet)
  if (els.runTestcaseSelect) {
    const prevValue = els.runTestcaseSelect.value;
    els.runTestcaseSelect.innerHTML = '';
    if (state.testCases.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '(No Test Case)';
      opt.value = '';
      els.runTestcaseSelect.appendChild(opt);
    } else {
      state.testCases.forEach((tc) => {
        const opt = document.createElement('option');
        opt.value = tc.id;
        opt.textContent = `${tc.name} (${tc.steps.length} step)`;
        els.runTestcaseSelect.appendChild(opt);
      });
    }
    if (prevValue && state.testCases.some((t) => t.id === prevValue)) els.runTestcaseSelect.value = prevValue;
  }

  if (!state.activeTestCaseId || !getTestCase(state.activeTestCaseId)) {
    state.activeTestCaseId = state.testCases[0]?.id || null;
  }
  if (state.activeTestCaseId) els.testcaseSelect.value = state.activeTestCaseId;

  const hasActive = !!state.activeTestCaseId;
  if (els.btnRecordToggle) els.btnRecordToggle.disabled = !hasActive;
  if (els.btnDeleteTestcase) els.btnDeleteTestcase.disabled = !hasActive;
  if (els.btnExportTc) els.btnExportTc.disabled = !hasActive;
}

// ---------------- Object Select ----------------

export function renderStepObjectOptions() {
  if (!els.stepObjectSelect) return; // tab not loaded yet
  els.stepObjectSelect.innerHTML = '';
  if (state.objects.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '(No Object - Please scan in the extension first.)';
    opt.value = '';
    els.stepObjectSelect.appendChild(opt);
    return;
  }
  state.objects.forEach((obj) => {
    const opt = document.createElement('option');
    opt.value = obj.id;
    opt.textContent = obj.name;
    els.stepObjectSelect.appendChild(opt);
  });
}

// ---------------- Step Operations ----------------

export function persistActiveTestCase() {
  const tc = getTestCase(state.activeTestCaseId);
  if (!tc) return;
  sendToExtension('WA_SAVE_TEST_CASE', { testCase: tc });
  api.saveTestCasesToServer();
  renderTestCaseSelectors();
}

export function moveStep(idx, dir) {
  const tc = getTestCase(state.activeTestCaseId);
  if (!tc) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= tc.steps.length) return;
  const [item] = tc.steps.splice(idx, 1);
  tc.steps.splice(newIdx, 0, item);
  renderSteps();
  persistActiveTestCase();
}

export function deleteStep(idx) {
  const tc = getTestCase(state.activeTestCaseId);
  if (!tc) return;
  tc.steps.splice(idx, 1);
  renderSteps();
  persistActiveTestCase();
}

// ---------------- Drag and Drop ----------------

let dragSrcIndex = null;

function handleDragStart(e) {
  dragSrcIndex = parseInt(this.dataset.stepIndex, 10);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcIndex);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  els.stepList.querySelectorAll('.item-card').forEach((card) => {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  dragSrcIndex = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  els.stepList.querySelectorAll('.item-card').forEach((card) => {
    card.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  const rect = this.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (e.clientY < midY) {
    this.classList.add('drag-over-top');
  } else {
    this.classList.add('drag-over-bottom');
  }
}

function handleDragLeave(e) {
  this.classList.remove('drag-over-top', 'drag-over-bottom');
}

function handleDrop(e) {
  e.preventDefault();
  const destIndex = parseInt(this.dataset.stepIndex, 10);
  if (dragSrcIndex === null || dragSrcIndex === destIndex) return;

  const tc = getTestCase(state.activeTestCaseId);
  if (!tc) return;

  const rect = this.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const insertIndex = e.clientY < midY ? destIndex : destIndex + 1;

  const [item] = tc.steps.splice(dragSrcIndex, 1);
  const adjustedInsertIndex = dragSrcIndex < insertIndex ? insertIndex - 1 : insertIndex;
  tc.steps.splice(adjustedInsertIndex, 0, item);

  renderSteps();
  persistActiveTestCase();
}