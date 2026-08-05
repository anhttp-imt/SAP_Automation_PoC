// State management & utility functions

export const state = {
  objects: [],
  testCases: [],
  testSuites: [],
  reports: [],
  activeTestCaseId: null,
  activeSuiteId: null,
  scanning: false,
  recording: false,
  running: false,
  suiteRun: null,
  variables: {},
};

export function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getTestCase(id) {
  return state.testCases.find((t) => t.id === id) || null;
}

export function getObject(id) {
  return state.objects.find((o) => o.id === id) || null;
}

export function getSuite(id) {
  return state.testSuites.find((s) => s.id === id) || null;
}

export function actionLabel(action) {
  return {
    click: 'Click',
    input: 'Input',
    select: 'Select',
    extract: 'Extract',
    verify: 'Verify Text',
    wait: 'Wait',
    openurl: 'Open URL',
    sendkey: 'Send Key',
  }[action] || action;
}

export function stepSummary(step) {
  const obj = getObject(step.objectId);
  const objName = obj
    ? obj.name
    : step.action === 'wait' || step.action === 'sendkey'
      ? '(no target)'
      : '(Object is deleted)';

  if (step.action === 'wait') return `Wait ${step.waitMs || step.value || 500}ms`;
  if (step.action === 'sendkey') return `Send Key "${step.value ?? ''}"`;
  if (step.action === 'openurl') {
    const url = step.value ?? '';
    const truncated = url.length > 50 ? url.slice(0, 50) + '...' : url;
    return `Open URL "${truncated}"`;
  }
  if (step.action === 'extract') return `Extract "${objName}" → $${step.variableName || 'value'}`;
  if (step.action === 'verify') return `Verify "${objName}" == "${step.expectedValue ?? step.value ?? ''}"`;
  if (step.action === 'input' || step.action === 'select')
    return `${actionLabel(step.action)} "${objName}" = "${step.value ?? ''}"`;
  return `${actionLabel(step.action)} "${objName}"`;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}