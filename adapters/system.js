import os from 'node:os';
import { sh, sleep } from './_lib.js';

// CPU% requires two samples. Keep state across snapshots.
let last = null;
function cpuPercent() {
  const cpus = os.cpus();
  if (!last || last.length !== cpus.length) { last = cpus; return null; }
  let idle = 0, total = 0;
  for (let i = 0; i < cpus.length; i++) {
    const a = last[i].times, b = cpus[i].times;
    idle  += b.idle - a.idle;
    total += (b.user + b.nice + b.sys + b.idle + b.irq) - (a.user + a.nice + a.sys + a.idle + a.irq);
  }
  last = cpus;
  return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
}

function snapshot() {
  const total = os.totalmem(), free = os.freemem();
  return {
    t: Date.now(),
    cpu: cpuPercent(),
    mem: ((total - free) / total) * 100,
    mem_gb: (total - free) / 1e9,
    mem_total_gb: total / 1e9,
    load: os.loadavg()[0], load5: os.loadavg()[1], load15: os.loadavg()[2],
    uptime: os.uptime(),
    cores: os.cpus().length,
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()}`
  };
}

export default {
  name: 'system',
  icon: '🖥️',
  priority: 1,
  ops: {
    live: {
      schema: {},
      render: 'sys_live',
      autoRun: true,
      stream: async (_, { send, cancelled, signal }) => {
        cpuPercent();                       // prime
        await sleep(300, signal);
        while (!cancelled()) {
          send(JSON.stringify(snapshot()));
          await sleep(1000, signal);
        }
      }
    },
    info: {
      schema: {},
      render: 'sys_info',
      run: async (_, { signal }) => {
        const [uname, user] = await Promise.all([
          sh('uname -a', { signal }).then(r => r.stdout.trim()).catch(() => ''),
          sh('whoami',   { signal }).then(r => r.stdout.trim()).catch(() => '')
        ]);
        return { ...snapshot(), uname, user };
      }
    }
  }
};
