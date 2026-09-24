import { createServer } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8765);
const maxBytes = 3_000_000;
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/webp.mjs', ['webp.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    if (value.startsWith('::ffff:')) return publicAddress(value.slice(7));
    return !(value === '::' || value === '::1' || value.startsWith('fc') ||
      value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('2001:db8:'));
  }
  return false;
}

async function validateTarget(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持公开的 HTTP/HTTPS 地址');
  if ((url.protocol === 'https:' && url.port && url.port !== '443') ||
      (url.protocol === 'http:' && url.port && url.port !== '80')) throw new Error('不支持自定义端口');
  const name = url.hostname.toLowerCase().replace(/\.$/, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal')) throw new Error('不支持本地或内部地址');
  const addresses = isIP(name) ? [{ address: name, family: isIP(name) }] : await lookup(name, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw new Error('不支持本地或内部地址');
  return { url, address: addresses[0] };
}

async function fetchPage(input, redirects = 0) {
  if (redirects > 3) throw new Error('网页重定向次数过多');
  const { url, address } = await validateTarget(input);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET', timeout: 10000,
      lookup: (_name, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
      headers: { 'User-Agent': 'SVG-GIF-Studio/1.0', Accept: 'text/html,image/svg+xml,text/plain,application/xml', 'Accept-Encoding': 'identity' }
    }, (response) => {
      const code = response.statusCode || 0;
      if (code >= 300 && code < 400 && response.headers.location) {
        response.resume();
        resolve(fetchPage(new URL(response.headers.location, url).href, redirects + 1));
        return;
      }
      if (code < 200 || code >= 300) { response.resume(); reject(new Error(`目标网站返回 HTTP ${code}`)); return; }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (contentType && !/text\/html|image\/svg\+xml|text\/plain|application\/xml|text\/xml/.test(contentType)) {
        response.resume(); reject(new Error('目标不是 HTML 或 SVG 文档')); return;
      }
      const chunks = []; let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new Error('网页内容超过 3 MB')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), url: url.href, contentType }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('目标网站响应超时')));
    request.on('error', reject);
    request.end();
  });
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  let url;
  try { url = new URL(request.url, `http://${request.headers.host || 'localhost'}`); }
  catch (_) { response.writeHead(400).end(); return; }
  if (url.pathname === '/api/fetch') {
    try {
      const target = url.searchParams.get('url');
      if (!target) throw new Error('缺少网址');
      const result = await fetchPage(target);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  const entry = files.get(url.pathname);
  if (!entry) { response.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(join(root, entry[0]));
    response.writeHead(200, { 'Content-Type': entry[1], 'X-Content-Type-Options': 'nosniff' });
    response.end(body);
  } catch (_) { response.writeHead(500).end('Server error'); }
});

server.listen(port, host, () => console.log(`SVG GIF Studio: http://${host}:${port}/`));
