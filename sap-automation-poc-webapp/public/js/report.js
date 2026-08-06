// Report rendering

import { state, escapeHtml, getReportsByUrl } from './state.js';
import { els } from './dom.js';
import { getTargetTabUrl } from './connection.js';
import * as api from './api.js';

// Cache: reportId → screenshots array (loaded once)
const screenshotsCache = new Map();

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
    row.dataset.stepId = s.stepId;
    row.dataset.reportId = report.id;
    // <div class="report-screenshot-placeholder" title="Click to load screenshot">
    //     <span class="screenshot-icon">📷</span>
    //   </div>
    row.innerHTML = `
      <div class="report-step-info">
        <div><span class="status-chip status-${s.status}">${s.status}</span> step ${idx + 1} (${s.durationMs}ms)</div>
        <div class="report-step-msg"></div>
      </div>
    `;
    row.querySelector('.report-step-msg').textContent = s.message || '';

    // Lazy-load screenshot on click
    row.addEventListener('click', async (e) => {
      e.stopPropagation();
      const placeholder = row.querySelector('.report-screenshot-placeholder');
      if (!placeholder) return;

      // Check if already loaded
      if (row.querySelector('.report-screenshot-thumb')) return;

      // Load screenshots for this report if not cached
      if (!screenshotsCache.has(report.id)) {
        const screenshots = await api.loadReportScreenshots(report.id);
        screenshotsCache.set(report.id, screenshots);
      }

      const screenshots = screenshotsCache.get(report.id);
      const stepScreenshot = screenshots?.find((ss) => ss.stepId === s.stepId);

      if (stepScreenshot && stepScreenshot.screenshotDataUrl) {
        // Replace placeholder with actual image
        const img = document.createElement('img');
        img.src = stepScreenshot.screenshotDataUrl;
        img.alt = 'screenshot';
        img.className = 'report-screenshot-thumb';
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          showScreenshotPreview(stepScreenshot.screenshotDataUrl);
        });
        placeholder.replaceWith(img);
      } else {
        // No screenshot available
        placeholder.innerHTML = '<span class="screenshot-icon" title="No screenshot">🚫</span>';
        placeholder.style.opacity = '0.3';
      }
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
  const targetUrl = getTargetTabUrl();
  const filteredReports = getReportsByUrl(targetUrl);
  els.reportList.innerHTML = '';
  els.reportEmpty.classList.toggle('visible', filteredReports.length === 0);

  const renderedSuiteRuns = new Set();
  filteredReports.forEach((report) => {
    if (report.suiteRunId) {
      if (renderedSuiteRuns.has(report.suiteRunId)) return;
      renderedSuiteRuns.add(report.suiteRunId);
      const groupReports = filteredReports
        .filter((r) => r.suiteRunId === report.suiteRunId)
        .sort((a, b) => (a.suiteIndex ?? 0) - (b.suiteIndex ?? 0));
      els.reportList.appendChild(buildSuiteReportGroup(report.suiteRunId, report.suiteName, groupReports));
      return;
    }
    els.reportList.appendChild(buildReportCard(report));
  });
}