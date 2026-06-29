// WebSocket RPC client.
// Three primitives: call (unary), stream (server-pushed chunks), input (client→server).
// Cancellation is in-band and locally resolved so callers unblock immediately.

export async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  const pending  = new Map();    // id → { resolve, reject } for `call`
  const streams  = new Map();    // id → { onChunk, resolve, reject } for `stream`
  const active   = new Set();
  const watchers = new Set();
  const tellWatchers = () => watchers.forEach(fn => fn(active.size));

  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    const s = streams.get(m.id);
    if (s) {
      if (m.type === 'chunk') return s.onChunk(m.data);
      if (m.type === 'end')   s.resolve();
      else if (m.type === 'error') s.reject(new Error(m.message));
      streams.delete(m.id); active.delete(m.id); tellWatchers();
      return;
    }
    const p = pending.get(m.id);
    if (p) {
      if (m.type === 'result') p.resolve(m.data);
      else if (m.type === 'error') p.reject(new Error(m.message));
      pending.delete(m.id); active.delete(m.id); tellWatchers();
    }
  };

  const send = msg => { try { ws.send(JSON.stringify(msg)); } catch {} };
  const finishLocal = (id, reason) => {
    const s = streams.get(id); if (s) { s.resolve(); streams.delete(id); }
    const p = pending.get(id); if (p) { p.reject(new Error(reason)); pending.delete(id); }
    if (active.delete(id)) tellWatchers();
  };

  return {
    call(id, app, op, args) {
      active.add(id); tellWatchers();
      send({ id, app, op, args });
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    stream(id, app, op, args, onChunk) {
      active.add(id); tellWatchers();
      send({ id, app, op, args });
      return new Promise((resolve, reject) => streams.set(id, { onChunk, resolve, reject }));
    },
    input(id, data) { send({ id, type: 'input', data }); },
    cancel(id)      { send({ id, type: 'cancel' }); finishLocal(id, 'cancelled'); },
    cancelAll()     { send({ type: 'cancel_all' }); for (const id of [...active]) finishLocal(id, 'cancelled'); },
    onActive(fn)    { watchers.add(fn); return () => watchers.delete(fn); }
  };
}
