import os from 'node:os';

// Bidirectional PTY: keystrokes flow in via onInput, shell output flows out via send.
// onInput accepts either a string (keystrokes) or { resize, cols, rows } for live resize.

export default {
  name: 'terminal',
  icon: '⌨️',
  priority: 0,
  ops: {
    shell: {
      schema: {
        cmd:  { type: 'string', default: process.env.SHELL || '/bin/zsh', label: 'Shell' },
        cols: { type: 'number', default: 100, label: 'Cols' },
        rows: { type: 'number', default: 30,  label: 'Rows' }
      },
      render: 'pty_terminal',
      stream: async ({ cmd, cols = 100, rows = 30 }, { send, signal, onInput }) => {
        let pty;
        try { pty = (await import('@homebridge/node-pty-prebuilt-multiarch')).default; }
        catch (e) {
          send(`\r\nPTY module not available: ${e.message}\r\n`);
          send(`run: npm install @homebridge/node-pty-prebuilt-multiarch\r\n`);
          return;
        }
        const term = pty.spawn(String(cmd), [], {
          name: 'xterm-256color',
          cols: Math.max(20, Number(cols) || 100),
          rows: Math.max(5,  Number(rows) || 30),
          cwd: os.homedir(),
          env: { ...process.env, TERM: 'xterm-256color' }
        });
        onInput(data => {
          if (typeof data === 'string') term.write(data);
          else if (data?.resize) { try { term.resize(Number(data.cols), Number(data.rows)); } catch {} }
        });
        term.onData(d => send(d));
        signal.addEventListener('abort', () => { try { term.kill(); } catch {} }, { once: true });
        await new Promise(resolve => term.onExit(resolve));
      }
    }
  }
};
