import { run, home } from './_lib.js';

const DEFAULT_REPO = '.';
const LOG_FMT = '%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%at';
const cwd = (repo, signal) => ({ cwd: home(repo), maxBuffer: 16 * 1024 * 1024, signal });

export default {
  name: 'git',
  icon: '🔀',
  priority: 4,
  config: {
    repo: { type: 'string', default: DEFAULT_REPO, label: 'Repo path' }
  },
  ops: {
    log: {
      schema: { limit: { type: 'number', default: 20, label: 'Limit' } },
      render: 'git_log',
      run: async ({ repo, limit = 20 }, { signal }) => {
        const { stdout } = await run('git',
          ['log', `--format=${LOG_FMT}`, '-n', String(Number(limit))], cwd(repo, signal));
        return stdout.trim().split('\n').filter(Boolean).map(line => {
          const [sha, short, subject, author, email, ts] = line.split('\x1f');
          return { sha, short, subject, author, email, ts: +ts };
        });
      }
    },
    status: {
      schema: {},
      render: 'git_status',
      run: async ({ repo }, { signal }) => {
        const { stdout } = await run('git', ['status', '--porcelain=v1', '-b'], cwd(repo, signal));
        const lines = stdout.split('\n').filter(Boolean);
        const branch = lines[0]?.startsWith('##') ? lines[0].slice(3) : '';
        return { branch, files: lines.slice(1).map(l => ({ status: l.slice(0, 2), path: l.slice(3) })) };
      }
    },
    branches: {
      schema: {},
      render: 'git_branches',
      run: async ({ repo }, { signal }) => {
        const { stdout } = await run('git', ['branch', '-vv', '--no-color'], cwd(repo, signal));
        return stdout.split('\n').filter(Boolean).map(l => {
          const current = l.startsWith('*');
          const [name, sha, ...desc] = l.replace(/^\*?\s*/, '').split(/\s+/);
          return { current, name, sha, desc: desc.join(' ') };
        });
      }
    },
    diff: {
      schema: { staged: { type: 'string', default: '', label: 'Staged? (y/n)' } },
      render: 'git_diff',
      run: async ({ repo, staged }, { signal }) => {
        const args = ['diff', '--no-color'];
        if (String(staged).toLowerCase().startsWith('y')) args.push('--cached');
        const { stdout } = await run('git', args, cwd(repo, signal));
        return stdout || '(no changes)';
      }
    }
  }
};
