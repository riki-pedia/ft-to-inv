// mock-invidious.js
// used for the ci workflow
// starts a webserver on port 9999 or the port specified in the MOCK_PORT environment variable
// then it handles requests to the correct endpoints for addition/deletion
import { createServer } from 'http';
const PORT = process.env.MOCK_PORT || 9999;

const server = createServer((req, res) => {
  // CORS for safety in browser-like calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  // Simulate mark watched
  if (req.method === 'POST' && /^\/api\/v1\/auth\/history\//.test(req.url)) {
    res.statusCode = 204; // no content
    console.log(`[test-server] hit add history at ${req.url}`);
    return res.end();
  }

  if (req.method === 'POST' && /^\/api\/v1\/auth\/subscriptions\//.test(req.url)) {
    res.statusCode = 204; // no content
    console.log(`[test-server] hit add subscription at ${req.url}`);
    return res.end();
  }

  if (req.method === 'DELETE' && /^\/api\/v1\/auth\/history\//.test(req.url)) {
    res.statusCode = 204; // no content
    console.log(`[test-server] hit remove history at ${req.url}`);
    return res.end();
  }

  if (req.method === 'DELETE' && /^\/api\/v1\/auth\/subscriptions\//.test(req.url)) {
    res.statusCode = 204; // no content
    console.log(`[test-server] hit remove subscription at ${req.url}`);
    return res.end();
  }
  if (req.method === 'GET' && /^\/api\/v1\/channels\//.test(req.url)) {
    // Simulate channel retrieval
    const channelId = req.url.split('/').pop();
    console.log(`[test-server] hit get channel at ${req.url}`);
    res.statusCode = 200;
    return res.end(JSON.stringify({ name: `Channel ${channelId}` }));
  }
  if (req.method === 'GET' && /^\/api\/v1\/videos\//.test(req.url)) {
    // Simulate video retrieval
    const videoId = req.url.split('/').pop();
    console.log(`[test-server] hit get video at ${req.url}`);
    res.statusCode = 200;
    return res.end(JSON.stringify({ title: `Video Title ${videoId}`, author: `Author ${videoId}` }));
  }
  // no actual playlist api in invidious, so we dont simulate it
  
  // Default: pretend endpoint not found
  console.log(`[test-server] unknown endpoint ${req.method} ${req.url}`);
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Mock Invidious running on http://localhost:${PORT}`);
});
