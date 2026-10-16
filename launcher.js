// Launcher: start the local server and open the panel in the default browser.
// Replaces desktop_app/multi-launcher.py (pywebview) — no native window in this build.
import { spawn } from 'node:child_process';

import './server.js';

const PORT = Number.parseInt(process.env.PORT || '8000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const URL = `http://${HOST}:${PORT}/`;

function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    console.log(`Open the panel manually at ${url}`);
  }
}

setTimeout(() => openBrowser(URL), 500);
