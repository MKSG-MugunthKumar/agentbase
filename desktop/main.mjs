import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { allowedConnectionAction } from './connection-actions.mjs';
import { prepareMemoryAction } from './memory-actions.mjs';
import { createAIService } from './ai-service.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packaged = app.isPackaged;
const source = packaged ? join(process.resourcesPath, 'package') : resolve(here, '..');
const node = packaged ? join(source, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node') : (process.env.AGENTBASE_NODE || 'node');
let home = resolve(process.env.AGENTBASE_HOME || join(homedir(), '.local', 'share', 'agentbase'));

function snapshot(project, record, search, includeBackground, taskLimit) {
  const args = [join(source, 'dist', 'inspector-main.js'), '--home', home];
  if (project) args.push('--project', project);
  if (record) args.push('--record', record);
  if (search) args.push('--search', search);
  if (includeBackground) args.push('--include-background');
  args.push('--task-limit', String(taskLimit));
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

function connectionAction(host, action) {
  if (!allowedConnectionAction(host, action)) return Promise.resolve({ ok: false, error: 'Unsupported connection action.' });
  const args = [join(source, 'dist', 'connections-main.js'), action, '--source', source, '--node', node, '--host', host, '--home', home];
  return new Promise((finish) => {
    execFile(node, args, { cwd: source, windowsHide: true, timeout: action === 'status' ? 35000 : 90000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      try { finish(JSON.parse(stdout)); }
      catch { finish({ ok: false, error: error?.message || `Could not check ${host}.` }); }
    });
  });
}

function skillInstructions(project, skill) {
  if (typeof project !== 'string' || !/^project_[a-z0-9-]+$/iu.test(project) || typeof skill !== 'string' || !/^skill_[a-z0-9-]+$/iu.test(skill)) {
    return Promise.resolve({ ok: false, error: 'Choose a saved project skill.' });
  }
  const args = [join(source, 'dist', 'desktop-skill-source-main.js'), '--home', home, '--project', project, '--skill', skill];
  return new Promise((finish) => {
    execFile(node, args, { cwd: source, windowsHide: true, timeout: 15000, maxBuffer: 300000 }, (error, stdout) => {
      try { finish(JSON.parse(stdout)); }
      catch { finish({ ok: false, error: error?.message || 'Could not read skill instructions.' }); }
    });
  });
}

function callTool(tool, payload) {
  return new Promise((finish) => {
    const child = spawn(node, [join(source, 'bin', 'agentbase.mjs'), '--home', home, 'call', tool, '-'], { cwd: source, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const done = value => { if (settled) return; settled = true; clearTimeout(timer); finish(value); };
    const timer = setTimeout(() => { child.kill(); done({ ok: false, error: 'Memory action timed out.' }); }, 20000);
    child.stdout.setEncoding('utf8').on('data', data => { stdout += data; if (stdout.length > 200000) child.kill(); });
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data; if (stderr.length > 20000) child.kill(); });
    child.on('error', error => done({ ok: false, error: error.message }));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return done({ ok: false, error: (stderr || stdout).trim().slice(0, 2000) || 'Could not save memory.' });
      try { done({ ok: true, record: JSON.parse(stdout) }); }
      catch { done({ ok: false, error: 'AgentBase returned an invalid memory result.' }); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

function memoryAction(input) {
  const command = prepareMemoryAction(input);
  return command ? callTool(command.tool, command.payload) : Promise.resolve({ ok: false, error: 'Invalid memory action.' });
}

app.whenReady().then(() => {
  const ai = createAIService({ app, safeStorage, runTool: callTool });
  const aiResult = action => action.catch(error => ({ ok: false, error: error.message }));
  ipcMain.handle('snapshot', (_event, input = {}) => {
    const bounded = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
    const taskLimit = Number.isInteger(input.taskLimit) ? Math.min(1000, Math.max(200, input.taskLimit)) : 200;
    return snapshot(bounded(input.project, 128), bounded(input.record, 128), bounded(input.search, 200), input.includeBackground === true, taskLimit);
  });
  ipcMain.handle('choose-store', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: home, title: 'Choose AgentBase data folder' });
    if (!result.canceled && result.filePaths[0]) home = result.filePaths[0];
    return home;
  });
  ipcMain.handle('store-path', () => home);
  ipcMain.handle('save-skill', (_event, input) => saveSkill(input));
  ipcMain.handle('connection-status', () => Promise.all([connectionAction('codex', 'status'), connectionAction('claude', 'status')]).then(([codex, claude]) => ({ codex, claude })));
  ipcMain.handle('connection-action', (_event, input = {}) => connectionAction(input?.host, input?.action));
  ipcMain.handle('skill-instructions', (_event, input = {}) => skillInstructions(input?.project, input?.skill));
  ipcMain.handle('memory-action', (_event, input = {}) => memoryAction(input));
  ipcMain.handle('ai-status', () => aiResult(ai.status()));
  ipcMain.handle('ai-save', (_event, input = {}) => aiResult(ai.save(input)));
  ipcMain.handle('ai-forget', () => aiResult(ai.forget()));
  ipcMain.handle('ai-judge', (_event, input = {}) => aiResult(ai.judge(input)));
  ipcMain.handle('ai-save-to-task', (_event, input = {}) => aiResult(ai.saveToTask(input)));
  ipcMain.handle('skill-templates', async () => JSON.parse(await readFile(join(source, 'assets', 'skill-templates.json'), 'utf8')));
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
