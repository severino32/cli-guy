// Shared helpers for adapters.
// Files in this directory starting with "_" are skipped by the adapter loader.

import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

// sh(cmd, { signal, maxBuffer })           — shell string
// run(bin, args, { signal, maxBuffer })    — binary + args (safer; no shell)
export const sh = promisify(exec);
export const run = promisify(execFile);

// Resolves early if `signal` aborts. Pair with `cancelled()` in a loop.
export const sleep = (ms, signal) => new Promise(resolve => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// Expand "~" to $HOME at the start of a path.
export const home = p =>
  p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : (p || os.homedir());

// Wait for a child process to close, swallowing the error spawn() throws on signal-kill.
export const childClosed = child => new Promise(resolve => {
  child.on('error', () => {});
  child.on('close', resolve);
});
