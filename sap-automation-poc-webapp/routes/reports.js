// Routes: /api/reports
const db = require('../db');

exports.handle = async (req, res, { parseBody, sendJSON }) => {
  const urlPath = req.url.split('?')[0];

  // GET /api/reports
  if (urlPath === '/api/reports' && req.method === 'GET') {
    try {
      const reports = await db.loadReports();
      sendJSON(res, 200, reports);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  // POST /api/reports
  if (urlPath === '/api/reports' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      body.id = body.id || `report-${Date.now()}`;
      await db.saveReport(body);
      sendJSON(res, 201, { success: true });
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return true;
  }

  // DELETE /api/reports
  if (urlPath === '/api/reports' && req.method === 'DELETE') {
    try {
      await db.deleteAllReports();
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  // DELETE /api/reports/:id
  if (urlPath.startsWith('/api/reports/') && req.method === 'DELETE') {
    try {
      const reportId = urlPath.split('/').pop();
      await db.deleteReport(reportId);
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  return false;
};