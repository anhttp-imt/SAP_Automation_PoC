// Server API helpers — shared between app.js and events.js

import { state } from './state.js';

// ---------------- Reports ----------------

export async function loadReportsFromServer() {
  try {
    const res = await fetch('/api/reports');
    state.reports = await res.json();
  } catch (e) {
    console.error('[API] Failed to load reports from server:', e);
  }
}

export async function saveReportToServer(report) {
  try {
    await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch (e) {
    console.error('[API] Failed to save report to server:', e);
  }
}

export async function clearReportsFromServer() {
  try {
    await fetch('/api/reports', { method: 'DELETE' });
    state.reports = [];
  } catch (e) {
    console.error('[API] Failed to clear reports:', e);
  }
}

// ---------------- Objects ----------------

export async function loadObjectsFromServer() {
  try {
    const res = await fetch('/api/objects');
    state.objects = await res.json();
  } catch (e) {
    console.error('[API] Failed to load objects from server:', e);
  }
}

export async function saveObjectsToServer() {
  try {
    await fetch('/api/objects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objects: state.objects }),
    });
    console.log('[API] Objects saved to server');
  } catch (e) {
    console.error('[API] Failed to save objects to server:', e);
  }
}

export async function clearObjectsFromServer() {
  try {
    await fetch('/api/objects', { method: 'DELETE' });
    state.objects = [];
  } catch (e) {
    console.error('[API] Failed to clear objects:', e);
  }
}

// ---------------- Test Cases ----------------

export async function loadTestCasesFromServer() {
  try {
    const res = await fetch('/api/testcases');
    state.testCases = await res.json();
  } catch (e) {
    console.error('[API] Failed to load test cases from server:', e);
  }
}

export async function saveTestCasesToServer() {
  try {
    await fetch('/api/testcases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCases: state.testCases }),
    });
    console.log('[API] Test cases saved to server');
  } catch (e) {
    console.error('[API] Failed to save test cases to server:', e);
  }
}

export async function clearTestCasesFromServer() {
  try {
    await fetch('/api/testcases', { method: 'DELETE' });
    state.testCases = [];
  } catch (e) {
    console.error('[API] Failed to clear test cases:', e);
  }
}

// ---------------- Test Suites ----------------

export async function loadTestSuitesFromServer() {
  try {
    const res = await fetch('/api/testsuites');
    state.testSuites = await res.json();
  } catch (e) {
    console.error('[API] Failed to load test suites from server:', e);
  }
}

export async function saveTestSuitesToServer() {
  try {
    await fetch('/api/testsuites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testSuites: state.testSuites }),
    });
    console.log('[API] Test suites saved to server');
  } catch (e) {
    console.error('[API] Failed to save test suites to server:', e);
  }
}

export async function clearTestSuitesFromServer() {
  try {
    await fetch('/api/testsuites', { method: 'DELETE' });
    state.testSuites = [];
  } catch (e) {
    console.error('[API] Failed to clear test suites:', e);
  }
}