// HTTP inspector. The whole adapter is one fetch + a tiny content-type sniff.

const decodeBody = async (resp, ct) => {
  if (ct.includes('application/json')) {
    try { return { body: JSON.stringify(await resp.json(), null, 2), bodyKind: 'json' }; }
    catch { return { body: await resp.text(), bodyKind: 'text' }; }
  }
  if (ct.startsWith('image/')) {
    const buf = Buffer.from(await resp.arrayBuffer());
    return { body: `data:${ct};base64,${buf.toString('base64')}`, bodyKind: 'image' };
  }
  const text = (await resp.text()).slice(0, 200_000);
  return { body: text, bodyKind: ct.includes('html') ? 'html' : 'text' };
};

export default {
  name: 'http',
  icon: '🔗',
  priority: 9,
  ops: {
    fetch: {
      schema: {
        url: { type: 'string', default: 'https://api.github.com/repos/openai/openai-python', label: 'URL' },
        method: { type: 'string', default: 'GET', label: 'Method' }
      },
      render: 'http_response',
      run: async ({ url, method = 'GET' }, { signal }) => {
        const t0 = performance.now();
        const r = await fetch(String(url), { method: String(method).toUpperCase(), signal, redirect: 'follow' });
        const ttfb = performance.now() - t0;
        const headers = Object.fromEntries(r.headers.entries());
        const { body, bodyKind } = await decodeBody(r, headers['content-type'] || '');
        return {
          status: r.status, statusText: r.statusText, ok: r.ok, url: r.url,
          ttfb_ms: Math.round(ttfb), total_ms: Math.round(performance.now() - t0),
          size: body.length, headers, body, bodyKind
        };
      }
    }
  }
};
