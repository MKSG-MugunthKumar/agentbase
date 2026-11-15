import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

if (process.platform !== 'darwin') throw new Error('Build macOS releases on a Mac.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const releaseDir = join(root, 'build', 'release');
const app = join(releaseDir, 'AgentBase.app');
const bundledPackage = join(app, 'Contents', 'Resources', 'package');
const archivePath = join(releaseDir, `AgentBase-${manifest.version}-macos-${arch}.zip`);
const installerPath = join(releaseDir, `AgentBase-${manifest.version}-macos-${arch}.pkg`);
const scratch = await mkdtemp(join(tmpdir(), 'agentbase-release-'));

try {
  execFileSync('npm', ['run', 'build:mac', '--prefix', 'desktop'], { cwd: root, stdio: 'inherit' });
  await mkdir(releaseDir, { recursive: true });
  await rm(app, { recursive: true, force: true });
  execFileSync('ditto', [join(root, 'build', 'mac-shared', `mac-${arch}`, 'AgentBase.app'), app], { stdio: 'inherit' });
  await writeFile(join(app, 'Contents', 'Resources', 'Distribution.txt'),
    'AgentBase for macOS 14 or newer. The Windows and Mac apps use the same desktop renderer and AgentBase runtime. This local build is not Apple notarized.\n');

  const runtime = join(bundledPackage, 'runtime', 'node');
  execFileSync(runtime, ['--version'], { stdio: 'inherit' });
  const snapshot = JSON.parse(execFileSync(runtime,
    [join(bundledPackage, 'dist', 'inspector-main.js'), '--home', join(scratch, 'empty-store')],
    { encoding: 'utf8' }));
  if (snapshot.status !== 'empty') throw new Error('Bundled inspector did not open an empty store.');
  const tools = JSON.parse(execFileSync(runtime, [join(bundledPackage, 'bin', 'agentbase.mjs'), 'tools', 'project_list'], { cwd: bundledPackage, encoding: 'utf8' }));
  if (tools.name !== 'project_list') throw new Error('Bundled AgentBase tools are unavailable.');
  execFileSync(runtime, ['--input-type=module', '-e', "import('@duckdb/node-api')"], { cwd: bundledPackage, stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  await rm(archivePath, { force: true });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archivePath], { stdio: 'inherit' });
  const extracted = join(scratch, 'extracted');
  await mkdir(extracted);
  execFileSync('ditto', ['-x', '-k', archivePath, extracted], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', join(extracted, 'AgentBase.app')], { stdio: 'inherit' });

  const stage = join(scratch, 'installer-root', 'Applications');
  await mkdir(stage, { recursive: true });
  execFileSync('ditto', [app, join(stage, 'AgentBase.app')], { stdio: 'inherit' });
  await rm(installerPath, { force: true });
  execFileSync('pkgbuild', ['--root', join(scratch, 'installer-root'), '--identifier', 'dev.agentbase.inspector', '--version', manifest.version, '--install-location', '/', installerPath], { stdio: 'inherit' });
  const payload = execFileSync('pkgutil', ['--payload-files', installerPath], { encoding: 'utf8' });
  if (!payload.includes('Applications/AgentBase.app/Contents/MacOS/AgentBase')) throw new Error('Installer is missing the shared desktop app.');
  console.log(`Created ${archivePath}\nCreated ${installerPath}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
