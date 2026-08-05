// Report rendering

import { state, escapeHtml } from './state.js';
import { els } from './dom.js';

export function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('en-US');
}

export function showScreenshotPreview(dataUrl) {
  els.screenshotPreviewImg.src = dataUrl;
  els.screenshotOverlay.classList.add('active');
}

export function hideScreenshotPreview() {
  els.screenshotOverlay.classList.remove('active');
  els.screenshotPreviewImg.src = '';
}

export function buildReportCard(report) {
  const card = document.createElement('div');
  card.className = 'report-card';
  const duration = report.finishedAt ? report.finishedAt - report.startedAt : 0;
  card.innerHTML = `
    <div class="report-card-header">
      <span class="item-title"></span>
      <span class="status-chip status-${report.overallStatus}"></span>
    </div>
    <div class="report-card-body"></div>
  `;
  card.querySelector('.item-title').textContent = `${report.testCaseName} — ${fmtTime(report.startedAt)} (${duration}ms)`;
  card.querySelector('.status-chip').textContent = report.overallStatus;

  const body = card.querySelector('.report-card-body');
  (report.steps || []).forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'report-step-row';
    row.innerHTML = `
      ${s.screenshotDataUrl ? `<img src="${s.screenshotDataUrl}" alt="screenshot" class="report-screenshot-thumb" />` : ''}
      <div class="report-step-info">
        <div><span class="status-chip status-${s.status}">${s.status}</span> step ${idx + 1} (${s.durationMs}ms)</div>
        <div class="report-step-msg"></div>
      </div>
    `;
    row.querySelector('.report-step-msg').textContent = s.message || '';
    const img = row.querySelector('img');
    if (img) img.addEventListener('click', (e) => {
      e.stopPropagation();
      showScreenshotPreview(s.screenshotDataUrl);
    });
    body.appendChild(row);
  });

  card.querySelector('.report-card-header').addEventListener('click', () => body.classList.toggle('open'));
  return card;
}

export function buildSuiteReportGroup(suiteRunId, suiteName, reports) {
  const group = document.createElement('div');
  group.className = 'report-card suite-report-group';
  const overallStatus = reports.some((r) => r.overallStatus === 'fail') ? 'fail' : 'pass';
  const first = reports[0];
  group.innerHTML = `
    <div class="report-card-header">
      <span class="item-title"></span>
      <span class="status-chip status-${overallStatus}"></span>
    </div>
    <div class="report-card-body"></div>
  `;
  group.querySelector('.item-title').textContent = `🗂 Suite: ${suiteName} — ${fmtTime(first.startedAt)} (${reports.length} test case)`;
  group.querySelector('.status-chip').textContent = overallStatus;

  const body = group.querySelector('.report-card-body');
  reports.forEach((r) => body.appendChild(buildReportCard(r)));

  group.querySelector('.report-card-header').addEventListener('click', () => body.classList.toggle('open'));
  return group;
}

export function renderReports() {
  if (!els.reportList) return; // tab not loaded yet
  els.reportList.innerHTML = '';
  els.reportEmpty.classList.toggle('visible', state.reports.length === 0);

  const renderedSuiteRuns = new Set();
  state.reports.forEach((report) => {
    if (report.suiteRunId) {
      if (renderedSuiteRuns.has(report.suiteRunId)) return;
      renderedSuiteRuns.add(report.suiteRunId);
      const groupReports = state.reports
        .filter((r) => r.suiteRunId === report.suiteRunId)
        .sort((a, b) => (a.suiteIndex ?? 0) - (b.suiteIndex ?? 0));
      els.reportList.appendChild(buildSuiteReportGroup(report.suiteRunId, report.suiteName, groupReports));
      return;
    }
    els.reportList.appendChild(buildReportCard(report));
  });
}