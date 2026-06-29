import { h } from 'preact';
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

const host = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const day = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const ago = ts => {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const fmtBytes = kb => {
  if (kb < 1024) return `${kb} K`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} M`;
  return `${(kb / 1024 / 1024).toFixed(2)} G`;
};
const fmtDuration = s => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
};
const initials = name => (name || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
const colorFor = s => {
  let h = 0; for (const c of (s || '')) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(h) % 360}, 55%, 55%)`;
};
const fallback = d => html`<pre>${JSON.stringify(d, null, 2)}</pre>`;

// ---------- Sparkline (shared) ----------
function Sparkline({ values, width = 240, height = 50, color = '#ff6600', fill = true, max: maxOverride }) {
  if (!values || !values.length) return html`<svg width=${width} height=${height}></svg>`;
  const max = maxOverride ?? Math.max(...values, 1);
  const min = 0;
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 2) - 1).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  return html`
    <svg width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} preserveAspectRatio=none>
      ${fill && html`<polygon points=${area} fill=${color} opacity=0.15 />`}
      <polyline points=${line} fill=none stroke=${color} stroke-width=1.6 stroke-linejoin=round stroke-linecap=round />
    </svg>`;
}

function Metric({ label, value, unit, series, color, max }) {
  return html`
    <div class=metric>
      <div class=metric-head>
        <span class=metric-label>${label}</span>
        <span class=metric-value>${value}<span class=metric-unit>${unit || ''}</span></span>
      </div>
      <${Sparkline} values=${series} color=${color} width=320 height=56 max=${max} />
    </div>`;
}

// ---------- System (live) ----------
function SysLive({ data }) {
  if (!Array.isArray(data) || !data.length) return html`<p class=status>sampling system...</p>`;
  const latest = data[data.length - 1];
  const series = key => data.map(d => d[key] ?? 0).slice(-60);
  return html`
    <div>
      <div class=metric-bar>
        <div><strong>${latest.host}</strong> · ${latest.platform} · ${latest.cores} cores · up ${fmtDuration(latest.uptime)}</div>
        <div class=status>live · ${data.length}s of history</div>
      </div>
      <div class=metrics>
        <${Metric} label="CPU" value=${(latest.cpu ?? 0).toFixed(1)} unit="%" series=${series('cpu')} color="#ff6600" max=${100} />
        <${Metric} label="Memory" value=${`${latest.mem.toFixed(1)}`} unit=${`% (${latest.mem_gb.toFixed(1)} / ${latest.mem_total_gb.toFixed(1)} GB)`} series=${series('mem')} color="#0066ff" max=${100} />
        <${Metric} label="Load 1m" value=${latest.load.toFixed(2)} unit=${` · 5m ${latest.load5.toFixed(2)} · 15m ${latest.load15.toFixed(2)}`} series=${series('load')} color="#00aa55" />
      </div>
    </div>`;
}

function SysInfo({ data }) {
  if (!data || typeof data !== 'object') return fallback(data);
  return html`
    <div class=info>
      <div><strong>${data.host}</strong> · ${data.user}</div>
      <div class=card-meta>${data.platform} · ${data.cores} cores · up ${fmtDuration(data.uptime)}</div>
      <pre class=info-uname>${data.uname}</pre>
    </div>`;
}

// ---------- Procs (live) ----------
function ProcsLive({ data, ops }) {
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  if (!Array.isArray(data) || !data.length) return html`<p class=status>loading processes...</p>`;
  const latest = data[data.length - 1];
  if (!latest.rows) return fallback(latest);

  const kill = async (pid, sig = 'TERM') => {
    if (!confirm(`Send SIG${sig} to PID ${pid}?`)) return;
    setBusy(pid); setErr('');
    try { await ops.call('procs', 'kill', { pid, sig }); }
    catch (e) { setErr(`PID ${pid}: ${e.message}`); }
    finally { setBusy(null); }
  };

  const rows = latest.rows.filter(r => !filter || r.cmd.toLowerCase().includes(filter.toLowerCase()) || r.user.toLowerCase().includes(filter.toLowerCase()));
  return html`
    <div>
      <input class=filter placeholder="filter by user or command..." value=${filter} onInput=${e => setFilter(e.target.value)} />
      ${err && html`<p style="color:#c00;margin:0.3rem 0">${err}</p>`}
      <table class=procs>
        <thead><tr><th>PID</th><th>USER</th><th>CPU %</th><th>MEM %</th><th>COMMAND</th><th></th></tr></thead>
        <tbody>
        ${rows.map(r => html`
          <tr>
            <td class=mono>${r.pid}</td>
            <td>${r.user}</td>
            <td><span class=cpu-cell><span class=cpu-bar style=${`width:${Math.min(r.cpu, 100)}%`}></span><span class=cpu-num>${r.cpu.toFixed(1)}</span></span></td>
            <td><span class=cpu-cell><span class=mem-bar style=${`width:${Math.min(r.mem, 100)}%`}></span><span class=cpu-num>${r.mem.toFixed(1)}</span></span></td>
            <td class=mono title=${r.cmd}>${r.cmd}</td>
            <td class=kill-cell>
              <button class=kill-btn disabled=${busy === r.pid} onClick=${() => kill(r.pid, 'TERM')} title="SIGTERM">⏹</button>
              <button class=kill-btn-hard disabled=${busy === r.pid} onClick=${() => kill(r.pid, 'KILL')} title="SIGKILL">✕</button>
            </td>
          </tr>`)}
        </tbody>
      </table>
    </div>`;
}

// ---------- Net (ping live) ----------
function NetPing({ data }) {
  if (!Array.isArray(data) || !data.length) return html`<p class=status>waiting for first reply...</p>`;
  const valid = data.filter(d => d.time_ms != null);
  if (!valid.length) return html`<p class=status>no responses yet (${data[0]?.host || ''})</p>`;
  const series = valid.map(d => d.time_ms).slice(-80);
  const latest = valid[valid.length - 1];
  const avg = series.reduce((a, b) => a + b, 0) / series.length;
  const min = Math.min(...series);
  const max = Math.max(...series);
  return html`
    <div>
      <div class=ping-head>
        <span><strong>${latest.host}</strong></span>
        <span class=ping-num>last <strong>${latest.time_ms.toFixed(1)}</strong> ms</span>
        <span>min ${min.toFixed(1)}</span>
        <span>avg ${avg.toFixed(1)}</span>
        <span>max ${max.toFixed(1)}</span>
        <span class=status>n=${valid.length}</span>
      </div>
      <${Sparkline} values=${series} width=700 height=90 color="#0066ff" />
    </div>`;
}

function NetDig({ data }) {
  if (!data?.records) return fallback(data);
  const entries = Object.entries(data.records);
  if (!entries.length) return html`<p class=status>no records for ${data.host}</p>`;
  return html`
    <div class=dns>
      <h4>${data.host}</h4>
      ${entries.map(([t, vals]) => html`
        <div class=dns-row>
          <span class=dns-type>${t}</span>
          <div class=dns-vals>${vals.map(v => html`<code>${v}</code>`)}</div>
        </div>`)}
    </div>`;
}

// ---------- Git ----------
function GitLog({ data }) {
  if (!Array.isArray(data)) return fallback(data);
  return html`
    <div class=commits>
      ${data.map(c => html`
        <div class=commit>
          <div class=avatar style=${`background:${colorFor(c.email)}`}>${initials(c.author)}</div>
          <div class=commit-body>
            <div class=commit-subj>${c.subject}</div>
            <div class=card-meta>
              <code>${c.short}</code> · <strong>${c.author}</strong> · ${ago(c.ts)}
            </div>
          </div>
        </div>`)}
    </div>`;
}

function GitStatus({ data }) {
  if (!data?.files) return fallback(data);
  if (!data.files.length) return html`<div class=user-card><strong>${data.branch || 'clean'}</strong><div class=card-meta>nothing to commit, working tree clean</div></div>`;
  return html`
    <div>
      <div class=branch-pill>${data.branch}</div>
      <div class=files>
        ${data.files.map(f => html`
          <div class=file-row>
            <span class=status-badge style=${`background:${statusColor(f.status)}`}>${f.status.trim() || '·'}</span>
            <code>${f.path}</code>
          </div>`)}
      </div>
    </div>`;
}
const statusColor = s => {
  const c = s.trim();
  if (c.includes('M')) return '#0066ff';
  if (c.includes('A')) return '#00aa55';
  if (c.includes('D')) return '#cc3333';
  if (c.includes('?')) return '#999';
  return '#888';
};

function GitBranches({ data }) {
  if (!Array.isArray(data)) return fallback(data);
  return html`
    <div class=branches>
      ${data.map(b => html`
        <div class=${`branch-row ${b.current ? 'current' : ''}`}>
          <span class=branch-marker>${b.current ? '●' : '○'}</span>
          <strong>${b.name}</strong>
          <code>${b.sha}</code>
          <span class=card-meta>${b.desc}</span>
        </div>`)}
    </div>`;
}

function GitDiff({ data }) {
  if (typeof data !== 'string') return fallback(data);
  if (data === '(no changes)') return html`<p class=status>${data}</p>`;
  return html`
    <div class=diff>
      ${data.split('\n').map(line => {
        let cls = 'diff-ctx';
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) cls = 'diff-file';
        else if (line.startsWith('@@')) cls = 'diff-hunk';
        else if (line.startsWith('+')) cls = 'diff-add';
        else if (line.startsWith('-')) cls = 'diff-remove';
        return html`<div class=${`diff-line ${cls}`}>${line || ' '}</div>`;
      })}
    </div>`;
}

// ---------- Disk ----------
function DiskUsage({ data }) {
  if (!data?.rows) return fallback(data);
  const max = Math.max(...data.rows.map(r => r.kb), 1);
  return html`
    <div>
      <div class=card-meta>${data.target}</div>
      <div class=disk-rows>
        ${data.rows.map(r => html`
          <div class=disk-row>
            <span class=disk-name title=${r.path}>${r.name}</span>
            <span class=disk-bar><span style=${`width:${(r.kb / max) * 100}%`}></span></span>
            <span class=disk-size>${fmtBytes(r.kb)}</span>
          </div>`)}
      </div>
    </div>`;
}

function DiskDf({ data }) {
  if (!Array.isArray(data)) return fallback(data);
  return html`
    <table class=procs>
      <thead><tr><th>Filesystem</th><th>Size</th><th>Used</th><th>Avail</th><th>Use%</th><th>Mounted on</th></tr></thead>
      <tbody>
      ${data.map(d => {
        const pct = parseInt(d.pct) || 0;
        return html`
          <tr>
            <td class=mono>${d.fs}</td>
            <td>${d.size}</td>
            <td>${d.used}</td>
            <td>${d.avail}</td>
            <td><span class=cpu-cell><span class=cpu-bar style=${`width:${pct}%;background:${pct > 85 ? '#cc3333aa' : '#ff660066'}`}></span><span class=cpu-num>${d.pct}</span></span></td>
            <td class=mono>${d.mount}</td>
          </tr>`;
      })}
      </tbody>
    </table>`;
}

// ---------- HN (kept from before) ----------
function HnTop({ data }) {
  if (!Array.isArray(data)) return fallback(data);
  return html`
    <div class=cards>
      ${data.map(s => html`
        <div class=card>
          <div class=card-rank>${s.score ?? 0}↑</div>
          <div class=card-body>
            <a class=card-title href=${s.url} target=_blank rel=noopener>${s.title}</a>
            <div class=card-meta>
              by ${s.by}
              ${' · '}<a href=${s.hn} target=_blank rel=noopener>${s.comments ?? 0} comments</a>
              ${s.url && host(s.url) ? html` · <span class=card-host>${host(s.url)}</span>` : null}
            </div>
          </div>
        </div>`)}
    </div>`;
}

function HnItem({ data }) {
  const it = data;
  if (!it || !it.id) return fallback(data);
  return html`
    <div class=item>
      <h3 class=item-title>${it.title || `(${it.type})`}</h3>
      <div class=card-meta>
        ${it.score != null ? html`<span class=score>${it.score}↑</span> · ` : null}
        by <strong>${it.by}</strong>
        ${it.descendants != null ? ` · ${it.descendants} comments` : ''}
        ${it.time ? ` · ${day(it.time)}` : ''}
      </div>
      ${it.url && html`<p><a href=${it.url} target=_blank rel=noopener>${it.url}</a></p>`}
      ${it.text && html`<div class=item-text dangerouslySetInnerHTML=${{ __html: it.text }} />`}
      <p><a href=${`https://news.ycombinator.com/item?id=${it.id}`} target=_blank rel=noopener>open on HN ›</a></p>
    </div>`;
}

function HnUser({ data }) {
  const u = data;
  if (!u || !u.id) return fallback(data);
  return html`
    <div class=user-card>
      <h3 class=user-name>${u.id}</h3>
      <div class=card-meta>
        <strong>${u.karma}</strong> karma
        ${u.created ? ` · joined ${day(u.created)}` : ''}
        ${u.submitted ? ` · ${u.submitted.length} submissions` : ''}
      </div>
      ${u.about && html`<div class=item-text dangerouslySetInnerHTML=${{ __html: u.about }} />`}
    </div>`;
}

function HnPulse({ data }) {
  const buckets = data?.buckets || data?.results?.buckets || data?.days || [];
  if (!Array.isArray(buckets) || !buckets.length) return fallback(data);
  const hitsKey = 'hits' in buckets[0] ? 'hits' : 'count';
  const max = Math.max(...buckets.map(b => b[hitsKey] || 0), 1);
  return html`
    <div class=pulse>
      ${buckets.map(b => html`
        <div class=pulse-row>
          <span class=pulse-day>${b.day || b.date}</span>
          <span class=pulse-bar style=${`width:${(b[hitsKey] / max) * 60}%`}></span>
          <span class=pulse-val>
            ${b[hitsKey] || 0} hits
            ${b.avg_score != null ? html` · avg ${Math.round(b.avg_score)}↑` : null}
          </span>
        </div>`)}
    </div>`;
}

// ---------- PTY Terminal (bidirectional) ----------
let xtermPromise = null;
function loadXterm() {
  if (xtermPromise) return xtermPromise;
  if (!document.querySelector('link[data-xterm]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://esm.sh/@xterm/xterm@5.5.0/css/xterm.css';
    link.setAttribute('data-xterm', '1');
    document.head.appendChild(link);
  }
  xtermPromise = Promise.all([
    import('https://esm.sh/@xterm/xterm@5.5.0'),
    import('https://esm.sh/@xterm/addon-fit@0.10.0?deps=@xterm/xterm@5.5.0'),
    import('https://esm.sh/@xterm/addon-web-links@0.11.0?deps=@xterm/xterm@5.5.0')
  ]);
  return xtermPromise;
}

function PTYTerminal({ ops }) {
  const elRef = useRef(null);
  const termRef = useRef(null);
  useEffect(() => {
    let term, fit, unsub, ro;
    let cancelled = false;
    (async () => {
      const [xtermMod, fitMod, linksMod] = await loadXterm();
      if (cancelled) return;
      term = new xtermMod.Terminal({
        cols: 100, rows: 30, fontSize: 13,
        fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
        cursorBlink: true,
        macOptionIsMeta: true,           // Option = Meta: enables Option+B/F word motion, Option+Backspace, etc.
        macOptionClickForcesSelection: true,
        scrollback: 10000,
        rightClickSelectsWord: true,
        allowProposedApi: true,
        theme: { background: '#1a1a1a', foreground: '#e6e6e6', cursor: '#ff6600',
                 black: '#1a1a1a', brightBlack: '#666',
                 selectionBackground: '#ff660055' }
      });
      termRef.current = term;
      fit = new fitMod.FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new linksMod.WebLinksAddon((e, uri) => window.open(uri, '_blank', 'noopener')));

      // Intercept browser shortcuts that would otherwise eat keys we want.
      // Cmd+C copies selection (xterm default); Cmd+V paste; everything else goes through.
      term.attachCustomKeyEventHandler(ev => {
        if (ev.type !== 'keydown') return true;
        // Cmd+K / Ctrl+L → let shell handle it (don't block).
        // Browser's Cmd+W / Cmd+T / Cmd+R: leave to browser.
        return true;
      });

      term.open(elRef.current);
      try { fit.fit(); } catch {}
      term.focus();
      term.onData(d => ops.send(d));
      unsub = ops.subscribe(chunk => {
        if (typeof chunk === 'string') term.write(chunk);
      });
      ro = new ResizeObserver(() => {
        try { fit.fit(); ops.send({ resize: true, cols: term.cols, rows: term.rows }); } catch {}
      });
      ro.observe(elRef.current);
    })();
    return () => { cancelled = true; unsub?.(); ro?.disconnect(); term?.dispose(); };
  }, []);

  // Click anywhere in the wrapper refocuses the terminal so keystrokes go to it.
  const refocus = () => termRef.current?.focus();
  return html`<div ref=${elRef} class=terminal-wrapper onMouseDown=${refocus} onClick=${refocus} tabIndex=0></div>`;
}

// ---------- Disk treemap (squarified) ----------
function squarify(items, w, h) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return [];
  const out = [];
  function worst(row, len) {
    const s = row.reduce((a, b) => a + b.value, 0);
    const max = Math.max(...row.map(r => r.value));
    const min = Math.min(...row.map(r => r.value));
    return Math.max((len * len * max) / (s * s), (s * s) / (len * len * min));
  }
  function layout(row, x, y, w, h, horizontal) {
    const sum = row.reduce((a, b) => a + b.value, 0);
    if (horizontal) {
      const rowH = sum / w;
      let cx = x;
      for (const r of row) {
        const rw = r.value / rowH;
        out.push({ ...r, x: cx, y, w: rw, h: rowH });
        cx += rw;
      }
      return { x, y: y + rowH, w, h: h - rowH };
    } else {
      const rowW = sum / h;
      let cy = y;
      for (const r of row) {
        const rh = r.value / rowW;
        out.push({ ...r, x, y: cy, w: rowW, h: rh });
        cy += rh;
      }
      return { x: x + rowW, y, w: w - rowW, h };
    }
  }
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const scale = (w * h) / total;
  const scaled = sorted.map(i => ({ ...i, value: i.value * scale }));
  let rect = { x: 0, y: 0, w, h };
  let row = [];
  let i = 0;
  while (i < scaled.length) {
    const horizontal = rect.w >= rect.h;
    const len = horizontal ? rect.w : rect.h;
    const next = scaled[i];
    if (row.length === 0 || worst([...row, next], len) <= worst(row, len)) {
      row.push(next);
      i++;
    } else {
      rect = layout(row, rect.x, rect.y, rect.w, rect.h, horizontal);
      row = [];
    }
  }
  if (row.length) layout(row, rect.x, rect.y, rect.w, rect.h, rect.w >= rect.h);
  return out;
}

function DiskTreemap({ data, ops }) {
  if (!data?.items) return fallback(data);
  const W = 900, H = 480;
  const rects = useMemo(() => squarify(data.items, W, H), [data]);
  const parts = data.target.split('/').filter(Boolean);
  const crumbs = parts.map((seg, i) => ({ name: seg, path: '/' + parts.slice(0, i + 1).join('/') }));
  const goTo = (p) => ops.rerun?.({ path: p });
  return html`
    <div>
      <div class=breadcrumbs>
        <span class=crumb onClick=${() => goTo('/')}>/</span>
        ${crumbs.map((c, i) => html`
          <span class=crumb-sep>/</span>
          <span class=${`crumb ${i === crumbs.length - 1 ? 'crumb-last' : ''}`} onClick=${() => goTo(c.path)}>${c.name}</span>
        `)}
        ${parts.length > 0 && html`<button class=secondary style="margin-left:auto" onClick=${() => goTo('/' + parts.slice(0, -1).join('/'))}>↑ up</button>`}
      </div>
      <svg width=${W} height=${H} class=treemap viewBox=${`0 0 ${W} ${H}`}>
        ${rects.map(r => {
          const showLabel = r.w > 60 && r.h > 22;
          const showSize = r.w > 80 && r.h > 38;
          return html`
            <g class=tm-cell onClick=${() => goTo(r.path)}>
              <title>${r.path}\n${fmtBytes(r.value)}\n(click to drill in)</title>
              <rect x=${r.x + 1} y=${r.y + 1} width=${Math.max(0, r.w - 2)} height=${Math.max(0, r.h - 2)}
                    fill=${colorFor(r.name)} opacity=0.85 rx=3 />
              ${showLabel && html`<text x=${r.x + 6} y=${r.y + 16} class=tm-label>${r.name}</text>`}
              ${showSize && html`<text x=${r.x + 6} y=${r.y + 32} class=tm-size>${fmtBytes(r.value)}</text>`}
            </g>`;
        })}
      </svg>
    </div>`;
}

// ---------- Docker ----------
function DockerPs({ data }) {
  if (!Array.isArray(data)) return fallback(data);
  if (!data.length) return html`<p class=status>no running containers</p>`;
  return html`
    <table class=procs>
      <thead><tr><th>Name</th><th>Image</th><th>Status</th><th>Ports</th><th>ID</th></tr></thead>
      <tbody>
      ${data.map(c => {
        const up = (c.Status || c.State || '').toLowerCase().startsWith('up');
        return html`
          <tr>
            <td><strong>${c.Names || c.Name}</strong></td>
            <td class=mono>${c.Image}</td>
            <td><span class=status-badge style=${`background:${up ? '#00aa55' : '#999'}`}>${up ? 'UP' : 'DOWN'}</span> <span class=card-meta>${c.Status || c.State}</span></td>
            <td class=mono>${c.Ports || ''}</td>
            <td class=mono>${(c.ID || c.Id || '').slice(0, 12)}</td>
          </tr>`;
      })}
      </tbody>
    </table>`;
}

function DockerImages({ data }) {
  if (!Array.isArray(data)) return fallback(data);
  return html`
    <table class=procs>
      <thead><tr><th>Repository</th><th>Tag</th><th>Size</th><th>Created</th><th>ID</th></tr></thead>
      <tbody>
      ${data.map(i => html`
        <tr>
          <td><strong>${i.Repository}</strong></td>
          <td class=mono>${i.Tag}</td>
          <td>${i.Size}</td>
          <td class=card-meta>${i.CreatedSince}</td>
          <td class=mono>${(i.ID || '').slice(0, 12)}</td>
        </tr>`)}
      </tbody>
    </table>`;
}

// ---------- HTTP inspector ----------
function HttpResponse({ data }) {
  if (!data?.status) return fallback(data);
  const ok = data.ok;
  const codeColor = ok ? '#00aa55' : data.status >= 500 ? '#cc3333' : '#ff8800';
  return html`
    <div class=http-result>
      <div class=http-status>
        <span class=http-code style=${`background:${codeColor}`}>${data.status}</span>
        <span>${data.statusText}</span>
        <span class=card-meta>${data.url}</span>
        <span class=http-timing>${data.total_ms} ms · ${(data.size / 1024).toFixed(1)} KB</span>
      </div>
      <details class=http-headers open>
        <summary>headers (${Object.keys(data.headers).length})</summary>
        <table class=procs>
          <tbody>
          ${Object.entries(data.headers).map(([k, v]) => html`
            <tr><td class=mono style="color:#666;width:200px">${k}</td><td class=mono>${v}</td></tr>
          `)}
          </tbody>
        </table>
      </details>
      <details class=http-body open>
        <summary>body (${data.bodyKind})</summary>
        ${data.bodyKind === 'image' ? html`<img src=${data.body} class=http-img />` :
          data.bodyKind === 'html' ? html`<pre class=http-pre>${data.body}</pre>` :
          html`<pre class=http-pre>${data.body}</pre>`}
      </details>
    </div>`;
}

// ---------- File browser + code editor ----------
function kindIcon(item) {
  if (item.dir) return '📁';
  switch (item.kind) {
    case 'image': return '🖼️';
    case 'code': return '📄';
    default: return '📄';
  }
}

function FileBrowser({ data, ops }) {
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  if (!data?.items) return fallback(data);

  const goTo = (p) => { setSelected(null); setContent(null); ops.rerun?.({ path: p }); };
  const openFile = async (item) => {
    setSelected(item);
    if (item.kind === 'image') { setContent({ kind: 'image', src: item.thumb || null, path: item.path }); return; }
    setLoading(true); setErr(''); setContent(null);
    try {
      const res = await ops.call('files', 'open', { path: item.path });
      setContent({ kind: 'code', ...res });
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const parts = data.target.split('/').filter(Boolean);
  const crumbs = parts.map((seg, i) => ({ name: seg, path: '/' + parts.slice(0, i + 1).join('/') }));

  return html`
    <div class=fb>
      <div class=breadcrumbs>
        <span class=crumb onClick=${() => goTo('/')}>/</span>
        ${crumbs.map((c, i) => html`
          <span class=crumb-sep>/</span>
          <span class=${`crumb ${i === crumbs.length - 1 ? 'crumb-last' : ''}`} onClick=${() => goTo(c.path)}>${c.name}</span>
        `)}
        ${parts.length > 0 && html`<button class=secondary style="margin-left:auto" onClick=${() => goTo(data.parent)}>↑ up</button>`}
      </div>
      <div class=fb-grid>
        ${data.items.map(item => html`
          <div class=${`fb-cell ${selected?.path === item.path ? 'fb-sel' : ''}`}
               onDblClick=${() => item.dir ? goTo(item.path) : openFile(item)}
               onClick=${() => item.dir ? null : openFile(item)}
               title=${item.path}>
            ${item.thumb
              ? html`<div class=fb-thumb><img src=${item.thumb} loading=lazy /></div>`
              : html`<div class=fb-thumb fb-icon>${kindIcon(item)}</div>`}
            <div class=fb-name>${item.name}</div>
            <div class=fb-meta>${item.dir ? '—' : fmtBytes(Math.ceil(item.size / 1024))}</div>
          </div>
        `)}
      </div>
      ${loading && html`<p class=status>loading...</p>`}
      ${err && html`<p style="color:#c00">${err}</p>`}
      ${content?.kind === 'image' && html`
        <div class=fb-preview>
          <div class=card-meta>${content.path}</div>
          ${content.src
            ? html`<img class=fb-preview-img src=${content.src} />`
            : html`<p class=status>(image too large for inline thumb — open externally)</p>`}
        </div>`}
      ${content?.kind === 'code' && html`<${InlineEditor} doc=${content} ops=${ops} onSaved=${() => goTo(data.target)} />`}
    </div>`;
}

let cmPromise = null;
function loadCM() {
  if (cmPromise) return cmPromise;
  const base = 'https://esm.sh/codemirror@6.0.1';
  const lang = (n, v = '6') => `https://esm.sh/@codemirror/lang-${n}@${v}`;
  cmPromise = Promise.all([
    import(base),
    import('https://esm.sh/@codemirror/state@6'),
    import('https://esm.sh/@codemirror/view@6'),
    import('https://esm.sh/@codemirror/theme-one-dark@6')
  ]);
  return cmPromise;
}
const langLoaders = {
  '.js': () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript()),
  '.mjs': () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript()),
  '.cjs': () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript()),
  '.ts': () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript({ typescript: true })),
  '.tsx': () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript({ typescript: true, jsx: true })),
  '.jsx': () => import('https://esm.sh/@codemirror/lang-javascript@6').then(m => m.javascript({ jsx: true })),
  '.json': () => import('https://esm.sh/@codemirror/lang-json@6').then(m => m.json()),
  '.py': () => import('https://esm.sh/@codemirror/lang-python@6').then(m => m.python()),
  '.html': () => import('https://esm.sh/@codemirror/lang-html@6').then(m => m.html()),
  '.css': () => import('https://esm.sh/@codemirror/lang-css@6').then(m => m.css()),
  '.md': () => import('https://esm.sh/@codemirror/lang-markdown@6').then(m => m.markdown()),
  '.sql': () => import('https://esm.sh/@codemirror/lang-sql@6').then(m => m.sql()),
  '.rs': () => import('https://esm.sh/@codemirror/lang-rust@6').then(m => m.rust())
};

function InlineEditor({ doc, ops, onSaved }) {
  const elRef = useRef(null);
  const viewRef = useRef(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    let view, cancelled = false;
    (async () => {
      const [, stateMod, viewMod, themeMod] = await loadCM();
      const { basicSetup } = await import('https://esm.sh/codemirror@6.0.1');
      const lang = langLoaders[doc.ext] ? await langLoaders[doc.ext]() : [];
      if (cancelled) return;
      const updateListener = viewMod.EditorView.updateListener.of(u => {
        if (u.docChanged) setDirty(true);
      });
      view = new viewMod.EditorView({
        doc: doc.content,
        extensions: [basicSetup, themeMod.oneDark, lang, updateListener,
          viewMod.EditorView.theme({ '&': { fontSize: '13px', maxHeight: '500px' }, '.cm-scroller': { fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' } })],
        parent: elRef.current
      });
      viewRef.current = view;
    })();
    return () => { cancelled = true; view?.destroy(); };
  }, [doc.path]);

  const save = async () => {
    if (!viewRef.current) return;
    setSaving(true); setSaved('');
    try {
      const content = viewRef.current.state.doc.toString();
      const r = await ops.call('files', 'save', { path: doc.path, content });
      setDirty(false); setSaved(`saved ✓ ${fmtBytes(Math.ceil(r.size / 1024))} at ${new Date().toLocaleTimeString()}`);
    } catch (e) { setSaved(`error: ${e.message}`); }
    finally { setSaving(false); }
  };

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && elRef.current?.contains(document.activeElement)) {
        e.preventDefault(); save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return html`
    <div class=editor>
      <div class=editor-bar>
        <code>${doc.path}</code>
        <span class=status>${doc.ext || 'plain'} · ${fmtBytes(Math.ceil(doc.size / 1024))}</span>
        <span class=status>${dirty ? '• unsaved' : ''}</span>
        <span class=status style="margin-left:auto">${saved}</span>
        <button onClick=${save} disabled=${saving || !dirty}>${saving ? 'saving...' : 'save (⌘S)'}</button>
      </div>
      <div ref=${elRef} class=editor-host></div>
    </div>`;
}

// ---------- SQLite ----------
function SqliteTables({ data, ops }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(null);
  const [err, setErr] = useState('');
  if (!data?.tables) return fallback(data);
  if (!data.tables.length) return html`<p class=status>no tables in ${data.db}</p>`;

  const peek = async (t) => {
    setLoading(t); setErr(''); setPreview(null);
    try {
      const res = await ops.call('sqlite', 'query', {
        db: data.db,
        sql: `SELECT * FROM "${t}"`,
        limit: 50
      });
      setPreview({ table: t, ...res });
    } catch (e) { setErr(e.message); }
    finally { setLoading(null); }
  };

  return html`
    <div>
      <div class=card-meta>${data.db}</div>
      <div class=chips>
        ${data.tables.map(t => html`
          <button class=${`chip ${preview?.table === t ? 'chip-active' : ''}`} onClick=${() => peek(t)} disabled=${loading === t}>
            <strong>${t}</strong>
            ${data.counts[t] != null && html`<span class=chip-count>${data.counts[t]} rows</span>`}
          </button>`)}
      </div>
      ${loading && html`<p class=status>loading preview of ${loading}...</p>`}
      ${err && html`<p style="color:#c00">${err}</p>`}
      ${preview && html`<div class=sql-preview><div class=card-meta>preview of <strong>${preview.table}</strong> (max 50)</div><${SqliteQuery} data=${preview} /></div>`}
    </div>`;
}

function SqliteSchema({ data }) {
  if (!data?.ddl) return fallback(data);
  return html`
    <div>
      <div class=card-meta>${data.table}</div>
      <pre class=sql-ddl>${data.ddl}</pre>
    </div>`;
}

function SqliteQuery({ data }) {
  if (!data) return fallback(data);
  if (data.raw) return html`<div><div class=card-meta>${data.ms}ms</div><pre>${data.raw}</pre></div>`;
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const rows = useMemo(() => {
    if (!sortCol) return data.rows;
    return [...data.rows].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av === bv) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      return (av < bv ? -1 : 1) * sortDir;
    });
  }, [data.rows, sortCol, sortDir]);
  if (!rows.length) return html`<p class=status>0 rows · ${data.ms}ms</p>`;
  const sortBy = (c) => { if (sortCol === c) setSortDir(-sortDir); else { setSortCol(c); setSortDir(1); } };
  return html`
    <div>
      <div class=card-meta>${rows.length} rows · ${data.ms}ms</div>
      <div class=sql-scroll>
        <table class=procs>
          <thead><tr>${data.cols.map(c => html`
            <th class=sortable onClick=${() => sortBy(c)}>${c}${sortCol === c ? (sortDir === 1 ? ' ▴' : ' ▾') : ''}</th>`)}
          </tr></thead>
          <tbody>
          ${rows.map(r => html`
            <tr>${data.cols.map(c => {
              const v = r[c];
              const str = v == null ? html`<span class=sql-null>NULL</span>` :
                          typeof v === 'object' ? JSON.stringify(v) : String(v);
              return html`<td class=mono>${str}</td>`;
            })}</tr>`)}
          </tbody>
        </table>
      </div>
    </div>`;
}

export const renderers = {
  sys_live: SysLive,
  sys_info: SysInfo,
  procs_live: ProcsLive,
  net_ping: NetPing,
  net_dig: NetDig,
  git_log: GitLog,
  git_status: GitStatus,
  git_branches: GitBranches,
  git_diff: GitDiff,
  disk_usage: DiskUsage,
  disk_treemap: DiskTreemap,
  disk_df: DiskDf,
  file_browser: FileBrowser,
  code_editor: ({ data, ops }) => h(InlineEditor, { doc: data, ops, onSaved: () => {} }),
  sqlite_tables: SqliteTables,
  sqlite_schema: SqliteSchema,
  sqlite_query: SqliteQuery,
  pty_terminal: PTYTerminal,
  docker_ps: DockerPs,
  docker_images: DockerImages,
  http_response: HttpResponse,
  hn_top: HnTop,
  hn_item: HnItem,
  hn_user: HnUser,
  hn_pulse: HnPulse
};
