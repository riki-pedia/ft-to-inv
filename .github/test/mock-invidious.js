// mock-invidious.js
// used for the ci workflow
// starts a webserver on port 9999 or the port specified in the MOCK_PORT environment variable
// then it handles requests to the correct endpoints for addition/deletion
const http = require('http');
const PORT = process.env.MOCK_PORT || 9999;

const server = http.createServer((req, res) => {
  // CORS for safety in browser-like calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  // Simulate mark watched
  if (req.method === 'POST' && /^\/api\/v1\/auth\/history\//.test(req.url)) {
    res.statusCode = 204; // no content
    return res.end();
  }

  if (req.method === 'POST' && /^\/api\/v1\/auth\/subscriptions\//.test(req.url)) {
    res.statusCode = 204; // no content
    return res.end();
  }

  if (req.method === 'DELETE' && /^\/api\/v1\/auth\/history\//.test(req.url)) {
    res.statusCode = 204; // no content
    return res.end();
  }

  if (req.method === 'DELETE' && /^\/api\/v1\/auth\/subscriptions\//.test(req.url)) {
    res.statusCode = 204; // no content
    return res.end();
  }
  // no actual playlist api in invidious, so we dont simulate it
  
  // Default: pretend endpoint not found
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Mock Invidious running on http://localhost:${PORT}`);
});
