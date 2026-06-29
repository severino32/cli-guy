import fs from 'node:fs/promises';
import path from 'node:path';
import { home } from './_lib.js';

const IMG  = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const CODE = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.h', '.cpp', '.cs', '.swift', '.sh', '.zsh', '.bash',
  '.json', '.yaml', '.yml', '.toml', '.html', '.css', '.scss', '.md', '.sql', '.lua', '.php'
]);
const kindOf = ext => IMG.has(ext) ? 'image' : CODE.has(ext) ? 'code' : 'file';

async function statItem(parent, dirent) {
  const fullPath = path.join(parent, dirent.name);
  let size = 0, mtime = 0;
  try { const st = await fs.stat(fullPath); size = st.size; mtime = Math.floor(st.mtimeMs / 1000); } catch {}
  const ext = dirent.isDirectory() ? '' : path.extname(dirent.name).toLowerCase();
  const item = {
    name: dirent.name, path: fullPath, dir: dirent.isDirectory(),
    ext, kind: dirent.isDirectory() ? 'dir' : kindOf(ext), size, mtime
  };
  // Inline tiny image thumbnails for a snappy gallery view.
  if (item.kind === 'image' && size > 0 && size < 1_500_000) {
    try {
      const buf = await fs.readFile(fullPath);
      const mime = ext === '.svg' ? 'image/svg+xml'
                 : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
                 : `image/${ext.slice(1)}`;
      item.thumb = `data:${mime};base64,${buf.toString('base64')}`;
    } catch {}
  }
  return item;
}

export default {
  name: 'files',
  icon: '📁',
  priority: 12,
  ops: {
    browse: {
      schema: { path: { type: 'string', default: '~', label: 'Directory' } },
      render: 'file_browser',
      run: async ({ path: p }) => {
        const target = home(p);
        const entries = await fs.readdir(target, { withFileTypes: true });
        const items = await Promise.all(entries.map(e => statItem(target, e)));
        items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
        return { target, parent: path.dirname(target), items };
      }
    },
    open: {
      schema: { path: { type: 'string', label: 'File' } },
      render: 'code_editor',
      run: async ({ path: p }) => {
        const target = home(p);
        const st = await fs.stat(target);
        if (st.size > 5 * 1024 * 1024) throw new Error('file too large (>5MB)');
        return {
          path: target,
          content: await fs.readFile(target, 'utf8'),
          ext: path.extname(target).toLowerCase(),
          size: st.size
        };
      }
    },
    save: {
      schema: { path: { type: 'string', label: 'File' } },
      run: async ({ path: p, content = '' }) => {
        const target = home(p);
        await fs.writeFile(target, String(content));
        const st = await fs.stat(target);
        return { saved: true, path: target, size: st.size };
      }
    }
  }
};
