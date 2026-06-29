import { spawn } from 'node:child_process';
import { run, childClosed } from './_lib.js';

const jsonLines = stdout =>
  stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

export default {
  name: 'docker',
  icon: '🐳',
  priority: 8,
  ops: {
    ps: {
      schema: { all: { type: 'string', default: 'n', label: 'Include stopped? (y/n)' } },
      render: 'docker_ps',
      run: async ({ all }, { signal }) => {
        const args = ['ps', '--format', '{{json .}}'];
        if (String(all).toLowerCase().startsWith('y')) args.push('-a');
        const { stdout } = await run('docker', args, { signal, maxBuffer: 8 * 1024 * 1024 });
        return jsonLines(stdout);
      }
    },
    images: {
      schema: {},
      render: 'docker_images',
      run: async (_, { signal }) => {
        const { stdout } = await run('docker', ['images', '--format', '{{json .}}'],
          { signal, maxBuffer: 8 * 1024 * 1024 });
        return jsonLines(stdout);
      }
    },
    logs: {
      schema: {
        container: { type: 'string', label: 'Container name or ID' },
        tail: { type: 'number', default: 100, label: 'Tail lines' }
      },
      stream: async ({ container, tail = 100 }, { send, signal }) => {
        if (!container) return send('(set container name first)\n');
        const child = spawn('docker',
          ['logs', '-f', '--tail', String(Number(tail)), String(container)], { signal });
        child.stdout.on('data', d => send(d.toString()));
        child.stderr.on('data', d => send(d.toString()));
        await childClosed(child);
      }
    }
  }
};
