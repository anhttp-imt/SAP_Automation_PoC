// Routes: /api/testsuites
const db = require('../db');

exports.handle = async (req, res, { parseBody, sendJSON }) => {
  const urlPath = req.url.split('?')[0];

  // GET /api/testsuites
  if (urlPath === '/api/testsuites' && req.method === 'GET') {
    try {
      const testSuites = await db.loadTestSuites();
      sendJSON(res, 200, testSuites);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  // POST /api/testsuites
  if (urlPath === '/api/testsuites' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      await db.saveAllTestSuites(body.testSuites || []);
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return true;
  }

  // DELETE /api/testsuites
  if (urlPath === '/api/testsuites' && req.method === 'DELETE') {
    try {
      await db.deleteAllTestSuites();
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  return false;
};