// Development QA only: serves one generated artifact over loopback.
// The delivered HTML needs neither this server nor Node.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const artifact = path.join(__dirname, '..', 'LogEn.html');
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' || !['/', '/LogEn.html'].includes(req.url.split('?')[0])) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  fs.createReadStream(artifact).pipe(res);
});
server.listen(8765, '127.0.0.1', () => process.stdout.write('QA preview: http://127.0.0.1:8765/\n'));
