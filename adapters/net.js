import { spawn } from 'node:child_process';
import { sh, childClosed } from './_lib.js';

const PING_LINE = /icmp_seq=(\d+).*?time=([\d.]+)/;

export default {
  name: 'net',
  icon: '🌐',
  priority: 3,
  ops: {
    ping: {
      schema: { host: { type: 'string', default: '1.1.1.1', label: 'Host' } },
      render: 'net_ping',
      stream: async ({ host = '1.1.1.1' }, { send, signal }) => {
        const child = spawn('ping', [String(host)], { signal });
        child.stdout.on('data', d => {
          for (const line of d.toString().split('\n')) {
            const m = line.match(PING_LINE);
            if (m) send(JSON.stringify({ seq: +m[1], time_ms: parseFloat(m[2]), host }));
          }
        });
        await childClosed(child);
      }
    },
    dig: {
      schema: { host: { type: 'string', default: 'github.com', label: 'Hostname' } },
      render: 'net_dig',
      run: async ({ host }, { signal, cancelled }) => {
        const types = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
        const records = {};
        for (const t of types) {
          if (cancelled()) break;
          try {
            const { stdout } = await sh(`dig +short ${t} ${String(host)}`, { signal });
            const lines = stdout.trim().split('\n').filter(Boolean);
            if (lines.length) records[t] = lines;
          } catch {}
        }
        return { host, records };
      }
    },
    publicip: {
      schema: {},
      run: async (_, { signal }) => {
        const { stdout } = await sh('curl -s --max-time 5 https://api.ipify.org', { signal });
        return { ip: stdout.trim() || '(unavailable)' };
      }
    }
  }
};
