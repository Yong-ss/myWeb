import '../runtime-env.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const root = resolve('apps/club/out');
http.createServer(async (request,response) => {
  const path = new URL(request.url,'http://127.0.0.1').pathname;
  if (path === '/health') return response.end('local browser fixture ready');
  // APIs must be mocked by the tests: this server has no DB/Auth credentials.
  if (path.startsWith('/api/')) { response.writeHead(501,{'Content-Type':'application/json'}); return response.end('{"error":"Missing test API mock"}'); }
  try {
    const file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : extname(path) ? path : path + '.html'));
    if (!file.startsWith(root + sep)) { response.statusCode=403; return response.end(); }
    const content = await readFile(file);
    response.setHeader('Content-Type', {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.txt':'text/plain'}[extname(file)] ?? 'application/octet-stream');
    response.end(content);
  } catch { response.statusCode=404; response.end('not found'); }
}).listen(8791,'127.0.0.1');
