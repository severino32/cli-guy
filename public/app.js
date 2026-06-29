// CLI GUY — schema-driven UI shell.
// On boot: fetch /api/manifest, open a WebSocket, render a tab per app.
// For each operation in the active app, render an <Op>. The Op renders
// a form from the operation's JSON schema, runs the op when clicked, and
// shows the result via a registered renderer (or a JSON dump if none).

import { h, render } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { connect } from '/client.js';
import { renderers } from '/renderers.js';

const html = htm.bind(h);
let rpc = null;

// -- Login -------------------------------------------------------------------
function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    const r = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (r.ok) onLogin(); else setError('wrong password');
  };
  return html`
    <h1>CLI GUY</h1>
    <p class=status>enter password</p>
    <div class=login>
      <input type=password value=${password} onInput=${e => setPassword(e.target.value)}
             onKeyDown=${e => e.key === 'Enter' && submit()} autofocus />
      <button onClick=${submit}>enter</button>
    </div>
    ${error && html`<p style="color:#c00">${error}</p>`}
  `;
}

// -- Schema-driven form field ------------------------------------------------
function Field({ name, spec, value, onInput }) {
  return html`
    <div class=field>
      <label>${spec.label || name}</label>
      <input type=${spec.type === 'number' ? 'number' : 'text'}
             value=${value ?? spec.default ?? ''}
             onInput=${e => onInput(e.target.value)} />
    </div>`;
}

// -- useOp -------------------------------------------------------------------
// Manages one operation: args + result state, run/stop/cancel-on-unmount,
// JSON parsing of streamed chunks, plus an `ops` handle exposed to renderers
// (subscribe to chunks, send input, call other ops, rerun with new args).
function useOp(app, opName, spec, extraArgs) {
  const [args, setArgs]       = useState({});
  const [data, setData]       = useState(null);
  const [output, setOutput]   = useState('');
  const [error, setError]     = useState('');
  const [running, setRunning] = useState(false);
  const idRef    = useRef(null);
  const extraRef = useRef(extraArgs); extraRef.current = extraArgs;

  // Renderer-facing API. Stable identity across renders.
  const ops = useMemo(() => {
    const subs = new Set();
    return {
      subscribe: fn => { subs.add(fn); return () => subs.delete(fn); },
      _notify: c => { for (const fn of subs) fn(c); },
      send: data => idRef.current && rpc.input(idRef.current, data),
      call: (a, o, args) => rpc.call(rid(), a, o, args),
      rerun: null   // wired below
    };
  }, []);

  async function run(override) {
    if (idRef.current) rpc.cancel(idRef.current);
    setOutput(''); setData(null); setError(''); setRunning(true);
    const id = rid();
    idRef.current = id;
    if (override) setArgs(prev => ({ ...prev, ...override }));
    const full = { ...extraRef.current, ...args, ...(override || {}) };
    const Renderer = spec.render && renderers[spec.render];
    const chunks = [];
    let buf = '';

    try {
      if (spec.streaming) {
        await rpc.stream(id, app, opName, full, raw => {
          if (idRef.current !== id) return;
          const parsed = tryJson(raw);
          if (Renderer) {
            ops._notify(parsed);
            chunks.push(parsed);
            if (chunks.length > 300) chunks.splice(0, chunks.length - 300);
            setData([...chunks]);
          } else {
            buf += (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)) + '\n';
            setOutput(buf);
          }
        });
      } else {
        const res = await rpc.call(id, app, opName, full);
        if (idRef.current !== id) return;
        setData(res);
        if (typeof res === 'string') setOutput(res);
      }
    } catch (e) {
      if (idRef.current === id && e.message !== 'cancelled') setError(e.message);
    } finally {
      if (idRef.current === id) { setRunning(false); idRef.current = null; }
    }
  }
  ops.rerun = run;

  function stop() {
    if (idRef.current) { rpc.cancel(idRef.current); idRef.current = null; setRunning(false); }
  }

  useEffect(() => {
    if (spec.autoRun) run();
    return () => { if (idRef.current) rpc.cancel(idRef.current); };
    // eslint-disable-next-line
  }, []);

  return { args, setArgs, data, output, error, running, run, stop, ops };
}

const rid = () => Math.random().toString(36).slice(2);
const tryJson = s => { try { return JSON.parse(s); } catch { return s; } };

// -- Op (one operation card) -------------------------------------------------
function Op({ app, opName, spec, extraArgs = {} }) {
  const op = useOp(app, opName, spec, extraArgs);
  const Renderer = spec.render && renderers[spec.render];
  const setArg = (k, v) => op.setArgs({ ...op.args, [k]: v });

  return html`
    <div class=op>
      <h3>
        ${app}.${opName}
        ${spec.streaming ? html`<span class=status>· stream</span>` : ''}
        ${Renderer ? html`<span class=status>· custom view</span>` : ''}
        ${op.running ? html`<span class=running-dot title="running"></span>` : ''}
      </h3>
      ${Object.entries(spec.schema).map(([n, s]) => html`
        <${Field} name=${n} spec=${s} value=${op.args[n]} onInput=${v => setArg(n, v)} />
      `)}
      <div class=op-actions>
        <button onClick=${() => op.run()} disabled=${op.running}>${op.running ? 'running...' : 'run'}</button>
        ${op.running && html`<button class=secondary onClick=${op.stop}>⏹ stop</button>`}
      </div>
      ${op.error && html`<p class=op-error>error: ${op.error}</p>`}
      ${Renderer && op.data
        ? html`<div class=render><${Renderer} data=${op.data} ops=${op.ops} /></div>`
        : op.output
          ? html`<pre>${op.output}</pre>`
          : op.data
            ? html`<pre>${JSON.stringify(op.data, null, 2)}</pre>`
            : null}
    </div>`;
}

// -- Shell (app tabs + shared config + op list) ------------------------------
function initialConfigs(manifest) {
  const out = {};
  for (const [k, a] of Object.entries(manifest)) {
    out[k] = {};
    for (const [ck, cs] of Object.entries(a.config || {})) {
      if (cs.default !== undefined) out[k][ck] = cs.default;
    }
  }
  return out;
}

function Shell({ manifest }) {
  const [active, setActive] = useState(Object.keys(manifest)[0]);
  const [configs, setConfigs] = useState(() => initialConfigs(manifest));
  const [activeCount, setActiveCount] = useState(0);
  useEffect(() => rpc.onActive(setActiveCount), []);

  const cur = manifest[active];
  const cfg = configs[active] || {};
  const setCfg = (k, v) => setConfigs(prev => ({ ...prev, [active]: { ...prev[active], [k]: v } }));

  return html`
    <div class=header>
      <h1>CLI GUY</h1>
      <div class=header-right>
        <span class=status>${activeCount} active</span>
        <button class=secondary onClick=${() => rpc.cancelAll()} disabled=${activeCount === 0}>⏹ stop all</button>
      </div>
    </div>
    <div class=apps>
      ${Object.entries(manifest).map(([k, a]) => html`
        <button class="app-btn ${active === k ? 'active' : ''}" onClick=${() => setActive(k)}>
          ${a.icon} ${a.name}
        </button>`)}
    </div>
    ${Object.keys(cur.config || {}).length > 0 && html`
      <div class=app-config>
        <span class=config-label>shared</span>
        ${Object.entries(cur.config).map(([n, s]) => html`
          <${Field} name=${n} spec=${s} value=${cfg[n]} onInput=${v => setCfg(n, v)} />
        `)}
      </div>
    `}
    ${Object.entries(cur.ops).map(([opName, spec]) => html`
      <${Op} key=${`${active}.${opName}`} app=${active} opName=${opName} spec=${spec} extraArgs=${cfg} />
    `)}
  `;
}

// -- App (boot) --------------------------------------------------------------
function App() {
  const [manifest, setManifest] = useState(null);
  const [checked, setChecked] = useState(false);

  const boot = async () => {
    const r = await fetch('/api/manifest');
    if (!r.ok) { setChecked(true); return; }
    const m = await r.json();
    rpc = await connect(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`);
    setManifest(m); setChecked(true);
  };
  useEffect(() => { boot(); }, []);

  if (!checked) return html`<p class=status>loading...</p>`;
  if (!manifest) return html`<${Login} onLogin=${boot} />`;
  return html`<${Shell} manifest=${manifest} />`;
}

render(html`<${App}/>`, document.getElementById('root'));
