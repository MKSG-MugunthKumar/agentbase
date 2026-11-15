import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Build the Mac App Store package on macOS.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const source = join(root, 'build', 'release', 'AgentBase.app');
const storeDir = join(root, 'build', 'store');
const app = join(storeDir, 'AgentBase.app');
const pkg = join(storeDir, `AgentBase-${version}-macos-store.pkg`);
const appIdentity = process.env.AGENTBASE_APP_STORE_SIGN_IDENTITY || '-';
const installerIdentity = process.env.AGENTBASE_INSTALLER_SIGN_IDENTITY;
const profile = process.env.AGENTBASE_APP_STORE_PROFILE;
const sign = (target, entitlements) => {
  const args = ['--force', '--sign', appIdentity];
  if (appIdentity === '-') args.push('--timestamp=none');
  if (entitlements) args.push('--entitlements', join(root, 'scripts', entitlements));
  args.push(target);
  execFileSync('codesign', args, { stdio: 'inherit' });
};

await mkdir(storeDir, { recursive: true });
await rm(app, { recursive: true, force: true });
execFileSync('ditto', [source, app], { stdio: 'inherit' });
const resources = join(app, 'Contents', 'Resources');
const packageDir = join(resources, 'package');
const binaryDir = join(packageDir, 'node_modules', '@duckdb', 'node-bindings-darwin-arm64');
await rm(join(resources, 'Distribution.txt'), { force: true });
if (profile) await cp(profile, join(app, 'Contents', 'embedded.provisionprofile'));
for (const binary of [join(binaryDir, 'libduckdb.dylib'), join(binaryDir, 'duckdb.node')]) sign(binary);
sign(join(packageDir, 'runtime', 'node'), 'mac-store-helper.entitlements');
sign(app, 'mac-store-app.entitlements');
execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
await rm(pkg, { force: true });
if (installerIdentity) {
  execFileSync('productbuild', ['--component', app, '/Applications', '--sign', installerIdentity, pkg], { stdio: 'inherit' });
} else {
  execFileSync('productbuild', ['--component', app, '/Applications', pkg], { stdio: 'inherit' });
}
console.log(`Created ${pkg}${installerIdentity ? ' (signed)' : ' (unsigned installer; do not upload)'}`);
