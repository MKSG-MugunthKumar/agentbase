import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = join(root, 'desktop', 'build-resources');
const stage = join(stageRoot, 'package');
const scratch = await mkdtemp(join(tmpdir(), 'agentbase-win-stage-'));
try {
  if (process.platform !== 'win32') throw new Error('Stage the Windows package on Windows so native dependencies and node.exe match the target.');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  const packed = spawnSync('npm.cmd', ['pack', '--pack-destination', scratch, '--silent'], { cwd: root, encoding: 'utf8', shell: true });
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr || packed.error?.message || packed.status}`);
  const archive = packed.stdout.trim().split(/\r?\n/u).at(-1);
  if (!archive?.endsWith('.tgz')) throw new Error('npm pack did not produce an archive.');
  execFileSync('tar', ['-xzf', join(scratch, archive), '-C', stageRoot], { stdio: 'inherit' });
  await mkdir(join(stage, 'runtime'), { recursive: true });
  await cp(process.execPath, join(stage, 'runtime', 'node.exe'));
  const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`);
  if (!license.ok) throw new Error(`Could not retrieve Node.js license: HTTP ${license.status}`);
  await writeFile(join(stage, 'runtime', 'NODE-LICENSE'), await license.text());
  await mkdir(join(stage, '.agents', 'plugins'), { recursive: true });
  await cp(join(root, '.agents', 'plugins', 'marketplace.json'), join(stage, '.agents', 'plugins', 'marketplace.json'));
  const mcp = JSON.parse(await readFile(join(stage, 'mcp.json'), 'utf8'));
  mcp.mcpServers.agentbase.command = './runtime/node.exe';
  mcp.mcpServers.agentbase.args = ['./bin/agentbase.mjs', 'serve'];
  await writeFile(join(stage, 'mcp.json'), JSON.stringify(mcp, null, 2) + '\n');
  const manifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'));
  const desktop = JSON.parse(await readFile(join(root, 'desktop', 'package.json'), 'utf8'));
  if (manifest.version !== desktop.version) throw new Error('Desktop and AgentBase package versions differ.');
  console.log(`Staged AgentBase ${manifest.version} and Node ${process.versions.node} for Windows.`);
} finally { await rm(scratch, { recursive: true, force: true }); }
