// Routes: /api/testcases
const db = require('../db');

exports.handle = async (req, res, { parseBody, sendJSON }) => {
  const urlPath = req.url.split('?')[0];

  // GET /api/testcases
  if (urlPath === '/api/testcases' && req.method === 'GET') {
    try {
      const testCases = await db.loadTestCases();
      sendJSON(res, 200, testCases);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  // POST /api/testcases
  if (urlPath === '/api/testcases' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      await db.saveAllTestCases(body.testCases || []);
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return true;
  }

  // DELETE /api/testcases
  if (urlPath === '/api/testcases' && req.method === 'DELETE') {
    try {
      await db.deleteAllTestCases();
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  return false;
};