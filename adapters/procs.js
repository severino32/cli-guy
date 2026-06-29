import { sh, sleep } from './_lib.js';

const PS_LINE = /^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/;

export default {
  name: 'procs',
  icon: '⚙️',
  priority: 2,
  ops: {
    kill: {
      schema: {
        pid: { type: 'number', label: 'PID' },
        sig: { type: 'string', default: 'TERM', label: 'Signal (TERM/KILL/INT/HUP)' }
      },
      run: async ({ pid, sig = 'TERM' }) => {
        const name = `SIG${String(sig).toUpperCase().replace(/^SIG/, '')}`;
        process.kill(Number(pid), name);
        return { killed: Number(pid), sig: name };
      }
    },
    live: {
      schema: { limit: { type: 'number', default: 20, label: 'Top N' } },
      render: 'procs_live',
      stream: async ({ limit = 20 }, { send, cancelled, signal }) => {
        while (!cancelled()) {
          try {
            const { stdout } = await sh(
              `ps axo pid,user,pcpu,pmem,comm -r 2>/dev/null | head -${Number(limit) + 1}`,
              { signal });
            const rows = stdout.trim().split('\n').slice(1).map(l => {
              const m = l.trim().match(PS_LINE);
              return m ? { pid: +m[1], user: m[2], cpu: +m[3], mem: +m[4], cmd: m[5] } : null;
            }).filter(Boolean);
            send(JSON.stringify({ rows, t: Date.now() }));
          } catch (e) {
            if (cancelled()) return;
            send(JSON.stringify({ error: String(e?.message || e) }));
          }
          await sleep(1500, signal);
        }
      }
    }
  }
};
