// CLI GUY — one server, one port, one WebSocket, many "apps".
// The whole backend in three sections: HTTP, WebSocket, dispatch.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = import.meta.dirname;
const PORT = process.env.PORT || 7777;
const PASSWORD = process.env.PASSWORD || 'changeme';
const sessions = new Set();

// -- adapter loading ---------------------------------------------------------
// Drop a file in ./adapters and it becomes an app at boot.
async function loadAdapters(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f.startsWith('_')) continue;
    const mod = await import(pathToFileURL(path.join(dir, f)));
    out[mod.default.name] = mod.default;
  }
  return out;
}
const apps = await loadAdapters(path.join(ROOT, 'adapters'));

function manifest() {
  const sorted = Object.entries(apps)
    .sort(([, a], [, b]) => (a.priority ?? 100) - (b.priority ?? 100));
  return Object.fromEntries(sorted.map(([k, a]) => [k, {
    name: a.name,
    icon: a.icon,
    config: a.config || {},
    ops: Object.fromEntries(Object.entries(a.ops).map(([n, op]) => [n, {
      schema: op.schema || {},
      streaming: !!op.stream,
      render: op.render || null,
      autoRun: !!op.autoRun
    }]))
  }]));
}

// -- HTTP --------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const cookie = (req, name) => (req.headers.cookie || '').match(new RegExp(`${name}=([^;]+)`))?.[1];
const authed = req => { const t = cookie(req, 'session'); return !!t && sessions.has(t); };
const readBody = req => new Promise(res => { let b = ''; req.on('data', c => b += c); req.on('end', () => res(b)); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/login' && req.method === 'POST') return login(req, res);
  if (url.pathname === '/api/manifest')                   return apiManifest(req, res);
  return serveStatic(res, url.pathname);
});

async function login(req, res) {
  try {
    const { password } = JSON.parse(await readBody(req));
    if (password !== PASSWORD) return send(res, 401, { error: 'bad password' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    res.writeHead(200, {
      'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/`,
      'Content-Type': 'application/json'
    });
    res.end('{"ok":true}');
  } catch { send(res, 400); }
}

function apiManifest(req, res) {
  if (!authed(req)) return send(res, 401);
  send(res, 200, manifest());
}

function send(res, status, body) {
  res.writeHead(status, body ? { 'Content-Type': 'application/json' } : {});
  res.end(body ? JSON.stringify(body) : '');
}

function serveStatic(res, urlPath) {
  const file = path.join(ROOT, 'public', urlPath === '/' ? '/index.html' : urlPath);
  if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// -- WebSocket dispatch ------------------------------------------------------
// Protocol:
//   client → server:  {id, app, op, args}         start an op
//                     {id, type:'cancel'}         cancel one
//                     {type:'cancel_all'}         cancel everything
//                     {id, type:'input', data}    keystrokes / control to a running stream
//   server → client:  {id, type:'result', data}   one-shot reply
//                     {id, type:'chunk',  data}   streamed reply
//                     {id, type:'end'}            stream complete
//                     {id, type:'error', message}
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!authed(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', ws => {
  const conn = newConnection(ws);
  ws.on('close', conn.cancelAll);
  ws.on('error', conn.cancelAll);
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    conn.handle(msg);
  });
});

function newConnection(ws) {
  const inflight = new Map();  // id → { cancelled, abort }
  const inputs   = new Map();  // id → handler(data)
  const reply    = obj => { try { ws.send(JSON.stringify(obj)); } catch {} };

  const cancel = id => {
    const c = inflight.get(id);
    if (c) { c.cancelled = true; try { c.abort.abort(); } catch {} }
  };
  const cancelAll = () => {
    for (const id of inflight.keys()) cancel(id);
    inflight.clear(); inputs.clear();
  };

  async function dispatch({ id, app, op, args = {} }) {
    const fn = apps[app]?.ops?.[op];
    if (!fn) return reply({ id, type: 'error', message: 'unknown op' });

    const abort = new AbortController();
    const ctx = { cancelled: false, abort };
    inflight.set(id, ctx);
    const alive = () => !ctx.cancelled && !abort.signal.aborted;
    const apiCtx = {
      signal: abort.signal,
      cancelled: () => ctx.cancelled,
      onInput: handler => inputs.set(id, handler)
    };

    try {
      if (fn.stream) {
        await fn.stream(args, { ...apiCtx, send: data => alive() && reply({ id, type: 'chunk', data }) });
        if (alive()) reply({ id, type: 'end' });
      } else {
        const data = await fn.run(args, apiCtx);
        if (alive()) reply({ id, type: 'result', data });
      }
    } catch (e) {
      if (alive()) reply({ id, type: 'error', message: String(e?.message || e) });
    } finally {
      inflight.delete(id); inputs.delete(id);
    }
  }

  function handle(msg) {
    if (msg.type === 'cancel')     return cancel(msg.id);
    if (msg.type === 'cancel_all') return cancelAll();
    if (msg.type === 'input')      return inputs.get(msg.id)?.(msg.data);
    dispatch(msg);
  }

  return { handle, cancelAll };
}

server.listen(PORT, () => {
  console.log(`CLI GUY → http://localhost:${PORT}  password=${PASSWORD}`);
  console.log(`apps: ${Object.keys(apps).join(', ')}`);
});
