import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = join(root, 'desktop', 'build-resources');
const stage = join(stageRoot, 'package');
const scratch = await mkdtemp(join(tmpdir(), 'agentbase-desktop-stage-'));
const target = process.env.AGENTBASE_DESKTOP_TARGET || process.platform;
try {
  if (!['win32', 'darwin'].includes(target)) throw new Error('Desktop packaging requires Windows or macOS.');
  if (target === 'darwin' && process.platform !== 'darwin') throw new Error('macOS packaging requires macOS.');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  const packed = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', scratch, '--silent'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr || packed.error?.message || packed.status}`);
  const archive = packed.stdout.trim().split(/\r?\n/u).at(-1);
  if (!archive?.endsWith('.tgz')) throw new Error('npm pack did not produce an archive.');
  execFileSync('tar', ['-xzf', join(scratch, archive), '-C', stageRoot], { stdio: 'inherit' });
  await mkdir(join(stage, 'runtime'), { recursive: true });
  const runtimeName = target === 'win32' ? 'node.exe' : 'node';
  if (target === process.platform) await cp(process.execPath, join(stage, 'runtime', runtimeName));
  else {
    const runtime = await fetch(`https://nodejs.org/dist/v${process.versions.node}/win-x64/node.exe`);
    if (!runtime.ok || !runtime.body) throw new Error(`Could not retrieve Windows Node.js: HTTP ${runtime.status}`);
    await pipeline(Readable.fromWeb(runtime.body), createWriteStream(join(stage, 'runtime', runtimeName)));
  }
  const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`);
  if (!license.ok) throw new Error(`Could not retrieve Node.js license: HTTP ${license.status}`);
  await writeFile(join(stage, 'runtime', 'NODE-LICENSE'), await license.text());
  await mkdir(join(stage, '.agents', 'plugins'), { recursive: true });
  await cp(join(root, '.agents', 'plugins', 'marketplace.json'), join(stage, '.agents', 'plugins', 'marketplace.json'));
  const mcp = JSON.parse(await readFile(join(stage, 'mcp.json'), 'utf8'));
  mcp.mcpServers.agentbase.command = `./runtime/${runtimeName}`;
  mcp.mcpServers.agentbase.args = ['./bin/agentbase.mjs', 'serve'];
  await writeFile(join(stage, 'mcp.json'), JSON.stringify(mcp, null, 2) + '\n');
  const manifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'));
  const desktop = JSON.parse(await readFile(join(root, 'desktop', 'package.json'), 'utf8'));
  if (manifest.version !== desktop.version) throw new Error('Desktop and AgentBase package versions differ.');
  const plugin = JSON.parse(await readFile(join(stage, 'plugin.json'), 'utf8'));
  if (plugin.version !== desktop.version) throw new Error('Plugin and desktop package versions differ.');
  console.log(`Staged AgentBase ${manifest.version} and Node ${process.versions.node} for ${target}.`);
} finally { await rm(scratch, { recursive: true, force: true }); }
