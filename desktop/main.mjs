import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const packaged = app.isPackaged;
const source = packaged ? join(process.resourcesPath, 'package') : resolve(here, '..');
const node = packaged ? join(source, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node') : (process.env.AGENTBASE_NODE || 'node');
let home = resolve(process.env.AGENTBASE_HOME || join(homedir(), '.local', 'share', 'agentbase'));

function snapshot(project, record, search, includeBackground) {
  const args = [join(source, 'dist', 'inspector-main.js'), '--home', home];
  if (project) args.push('--project', project);
  if (record) args.push('--record', record);
  if (search) args.push('--search', search);
  if (includeBackground) args.push('--include-background');
  return new Promise((finish) => {
    execFile(node, args, { cwd: source, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) return finish({ status: 'error', error: error.message, projects: [], records: [] });
      try { finish(JSON.parse(stdout)); }
      catch { finish({ status: 'error', error: 'AgentBase returned an invalid snapshot.', projects: [], records: [] }); }
    });
  });
}

function saveSkill(input) {
  return new Promise((finish) => {
    const child = spawn(node, [join(source, 'dist', 'desktop-skill-main.js'), '--home', home], { cwd: source, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 20000);
    child.stdout.setEncoding('utf8').on('data', data => { stdout += data; if (stdout.length > 10000) child.kill(); });
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data; if (stderr.length > 10000) child.kill(); });
    child.on('error', error => { clearTimeout(timer); finish({ ok: false, error: error.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      try { finish(JSON.parse(stdout)); }
      catch { finish({ ok: false, error: stderr.trim() || 'Could not save skill.' }); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

app.whenReady().then(() => {
  ipcMain.handle('snapshot', (_event, input = {}) => {
    const bounded = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
    return snapshot(bounded(input.project, 128), bounded(input.record, 128), bounded(input.search, 200), input.includeBackground === true);
  });
  ipcMain.handle('choose-store', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: home, title: 'Choose AgentBase data folder' });
    if (!result.canceled && result.filePaths[0]) home = result.filePaths[0];
    return home;
  });
  ipcMain.handle('store-path', () => home);
  ipcMain.handle('save-skill', (_event, input) => saveSkill(input));
  const window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 620,
    title: 'AgentBase', backgroundColor: '#0e0f11',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#0e0f11', symbolColor: '#e8e8e8', height: 30 } : false,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(join(here, 'index.html'));
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
