import { run } from './_lib.js';

// All CLI calls go through this. --agent expands to: --json --compact --no-input --no-color --yes
const CLI  = process.env.HN_CLI || 'hackernews-pp-cli';
const OPTS = { maxBuffer: 32 * 1024 * 1024 };

async function hn(args, signal) {
  const { stdout } = await run(CLI, [...args, '--agent'], { ...OPTS, signal });
  const env = JSON.parse(stdout);
  return env.results ?? env;
}

export default {
  name: 'hackernews',
  icon: '📰',
  priority: 13,
  ops: {
    top: {
      schema: { limit: { type: 'number', default: 10, label: 'How many' } },
      render: 'hn_top',
      run: async ({ limit = 10 }, { signal }) => {
        const ids = await hn(['stories', 'top'], signal);
        const items = await Promise.all((ids || []).slice(0, Number(limit)).map(id =>
          hn(['items', String(id)], signal).catch(e => ({ id, error: String(e.message || e) }))
        ));
        return items.map(it => ({
          id: it.id, title: it.title, by: it.by,
          score: it.score, comments: it.descendants ?? 0,
          url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
          hn:  `https://news.ycombinator.com/item?id=${it.id}`
        }));
      }
    },

    top_stream: {
      schema: { limit: { type: 'number', default: 10, label: 'How many' } },
      stream: async ({ limit = 10 }, { send, cancelled, signal }) => {
        const ids = await hn(['stories', 'top'], signal);
        for (const id of (ids || []).slice(0, Number(limit))) {
          if (cancelled()) return;
          try {
            const it = await hn(['items', String(id)], signal);
            send(`[${String(it.score ?? 0).padStart(3)}↑ ${String(it.descendants ?? 0).padStart(3)}💬] ` +
                 `${it.title}  —  ${it.by}\n  ${it.url || 'https://news.ycombinator.com/item?id=' + it.id}`);
          } catch (e) { send(`[err] ${id}: ${e.message}`); }
        }
      }
    },

    item:    { schema: { id: { type: 'number', label: 'Item ID' } },
               render: 'hn_item',
               run: async ({ id }, { signal }) => hn(['items', String(Number(id))], signal) },

    search:  { schema: { query: { type: 'string', label: 'Query' },
                         limit: { type: 'number', default: 10, label: 'Limit' } },
               run: async ({ query, limit = 10 }, { signal }) =>
                 hn(['search', String(query), '--limit', String(Number(limit))], signal) },

    pulse:   { schema: { topic: { type: 'string', label: 'Topic' },
                         days:  { type: 'number', default: 7, label: 'Days' } },
               render: 'hn_pulse',
               run: async ({ topic, days = 7 }, { signal }) =>
                 hn(['pulse', String(topic), '--days', String(Number(days))], signal) },

    user:    { schema: { id: { type: 'string', label: 'Username' } },
               render: 'hn_user',
               run: async ({ id }, { signal }) => hn(['users', String(id)], signal) },

    controversial: { schema: { window: { type: 'string', default: '7d', label: 'Window' } },
                     run: async ({ window = '7d' }, { signal }) =>
                       hn(['controversial', '--window', String(window)], signal) }
  }
};
