import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectorSnapshot } from './inspector.js';

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
try {
  const home = option('--home'), projectId = option('--project'), skillId = option('--skill');
  if (!home || !projectId || !skillId) throw new Error('Skill location is required.');
  const snapshot = inspectorSnapshot(home, projectId, skillId);
  if (snapshot.status !== 'connected') throw new Error('Skill store is unavailable.');
  const record = snapshot.records.find((entry: any) => entry.id === skillId && entry.kind === 'skill');
  if (!record) throw new Error('Skill is not available in this project.');
  const source = String(record.body.source ?? '');
  const file = source.startsWith('file://') ? fileURLToPath(source) : source.startsWith('/') ? source : undefined;
  if (!file) throw new Error('This reference is not a local file.');
  if ((await stat(file)).size > 256_000) throw new Error('The skill file is too large to preview.');
  const content = await readFile(file, 'utf8');
  const lines = content.split(/\r?\n/u);
  const first = lines[0]?.trim();
  const end = first === '---' ? lines.findIndex((line, index) => index > 0 && line.trim() === '---') : -1;
  const instructions = (end > 0 ? lines.slice(end + 1).join('\n') : content).trim();
  console.log(JSON.stringify({ ok: true, instructions, source }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: (error as Error).message }));
  process.exitCode = 1;
}
