// Routes: /api/objects
const db = require('../db');

exports.handle = async (req, res, { parseBody, sendJSON }) => {
  const urlPath = req.url.split('?')[0];

  // GET /api/objects
  if (urlPath === '/api/objects' && req.method === 'GET') {
    try {
      const objects = await db.loadObjects();
      sendJSON(res, 200, objects);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  // POST /api/objects
  if (urlPath === '/api/objects' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      await db.saveAllObjects(body.objects || []);
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return true;
  }

  // DELETE /api/objects
  if (urlPath === '/api/objects' && req.method === 'DELETE') {
    try {
      await db.deleteAllObjects();
      sendJSON(res, 200, { success: true });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  return false;
};