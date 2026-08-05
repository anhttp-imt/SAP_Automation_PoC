// Routes: /api/target-tabs
// Returns unique pageUrlPatterns from objects + test cases collections
const db = require('../db');

exports.handle = async (req, res, { parseBody, sendJSON }) => {
  const urlPath = req.url.split('?')[0];

  // GET /api/target-tabs
  if (urlPath === '/api/target-tabs' && req.method === 'GET') {
    try {
      const patterns = await db.getUniquePageUrlPatterns();
      sendJSON(res, 200, patterns);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return true;
  }

  return false;
};