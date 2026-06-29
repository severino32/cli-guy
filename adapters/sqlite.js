import { run, home } from './_lib.js';

const sqlite = (db, args, signal) =>
  run('sqlite3', [home(db), ...args], { signal, maxBuffer: 64 * 1024 * 1024 });

export default {
  name: 'sqlite',
  icon: '🗃️',
  priority: 11,
  config: {
    db: { type: 'string', default: '', label: 'Database (.db / .sqlite)' }
  },
  ops: {
    tables: {
      schema: {},
      render: 'sqlite_tables',
      run: async ({ db }, { signal }) => {
        if (!db) throw new Error('set the database file path in the shared config first');
        const { stdout } = await sqlite(db, ['.tables'], signal);
        const tables = stdout.trim().split(/\s+/).filter(Boolean);
        const counts = {};
        for (const t of tables) {
          try {
            const r = await sqlite(db, ['-cmd', '.mode list', `SELECT COUNT(*) FROM "${t}"`], signal);
            counts[t] = +r.stdout.trim() || 0;
          } catch {}
        }
        return { db: home(db), tables, counts };
      }
    },
    schema: {
      schema: { table: { type: 'string', label: 'Table name (empty = all)' } },
      render: 'sqlite_schema',
      run: async ({ db, table = '' }, { signal }) => {
        const { stdout } = await sqlite(db, [`.schema ${table}`], signal);
        return { table: table || '*', ddl: stdout.trim() };
      }
    },
    query: {
      schema: {
        sql: { type: 'string', default: 'SELECT 1+1 AS hello', label: 'SQL' },
        limit: { type: 'number', default: 200, label: 'Row cap' }
      },
      render: 'sqlite_query',
      run: async ({ db, sql, limit = 200 }, { signal }) => {
        if (!sql?.trim()) return { sql, rows: [], cols: [] };
        const t0 = performance.now();
        const { stdout } = await sqlite(db,
          ['-cmd', '.mode json', `${sql.trim().replace(/;$/, '')} LIMIT ${Number(limit)}`],
          signal);
        const ms = Math.round(performance.now() - t0);
        const trimmed = stdout.trim();
        if (!trimmed) return { sql, rows: [], cols: [], ms };
        try {
          const rows = JSON.parse(trimmed);
          const cols = rows.length ? Object.keys(rows[0]) : [];
          return { sql, rows, cols, ms };
        } catch {
          return { sql, raw: trimmed, ms };
        }
      }
    }
  }
};
