import pathLib from 'node:path';
import { sh, home } from './_lib.js';

export default {
  name: 'disk',
  icon: '💾',
  priority: 5,
  ops: {
    usage: {
      schema: { path: { type: 'string', default: '~', label: 'Directory' } },
      render: 'disk_usage',
      run: async ({ path: p }, { signal }) => {
        const target = home(p);
        const { stdout } = await sh(
          `du -sk ${JSON.stringify(target)}/* 2>/dev/null | sort -rn | head -25`,
          { signal });
        const rows = stdout.trim().split('\n').filter(Boolean).map(line => {
          const [size, file] = line.split('\t');
          return { kb: +size, path: file, name: pathLib.basename(file || '') };
        });
        return { target, rows };
      }
    },
    treemap: {
      schema: { path: { type: 'string', default: '~', label: 'Directory' } },
      render: 'disk_treemap',
      run: async ({ path: p }, { signal }) => {
        const target = home(p);
        const { stdout } = await sh(
          `du -sk ${JSON.stringify(target)}/* 2>/dev/null | sort -rn | head -40`,
          { signal });
        const items = stdout.trim().split('\n').filter(Boolean).map(line => {
          const [size, file] = line.split('\t');
          return { name: pathLib.basename(file || ''), value: +size, path: file };
        }).filter(i => i.value > 0);
        return { target, items };
      }
    },
    df: {
      schema: {},
      render: 'disk_df',
      run: async (_, { signal }) => {
        const { stdout } = await sh(`df -h | grep -Ev "^map|^devfs"`, { signal });
        return stdout.trim().split('\n').slice(1).map(l => {
          const p = l.split(/\s+/);
          return {
            fs: p[0], size: p[1], used: p[2], avail: p[3],
            pct: p[4], mount: p.slice(8).join(' ') || p[5]
          };
        });
      }
    }
  }
};
