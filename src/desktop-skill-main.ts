import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.js';
import { Agentbase } from './service.js';

const args = process.argv.slice(2);
const home = args[args.indexOf('--home') + 1];
if (!home || !args.includes('--home')) throw new Error('AgentBase data folder is required.');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 20_000) throw new Error('Skill form is too long.');
}
const form = JSON.parse(input);
const title = String(form.title ?? '').trim().slice(0, 120);
const description = String(form.description ?? '').trim().slice(0, 1000);
const instructions = String(form.instructions ?? '').trim().slice(0, 10_000);
if (!title || !description || !instructions) throw new Error('Title, description, and instructions are required.');
const category = ['General', 'Coding', 'Research', 'Data', 'Planning', 'Writing'].includes(form.category) ? form.category : 'General';
const triggers = String(form.triggers ?? '').split(/\r?\n/u).map((line: string) => line.trim()).filter(Boolean).slice(0, 50);
const store = new Store(home);
let directory: string | undefined;
try {
  const project = store.project(String(form.project_id ?? ''));
  const root = String(project.root);
  const base = title.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 60) || 'custom-skill';
  const parent = join(root, '.agents', 'skills');
  await mkdir(parent, { recursive: true });
  for (let index = 1; index < 1000; index++) {
    const candidate = join(parent, index === 1 ? base : `${base}-${index}`);
    try { await mkdir(candidate); directory = candidate; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  if (!directory) throw new Error('Could not create a unique skill folder.');
  const file = join(directory, 'SKILL.md');
  const summary = description.replace(/\s+/gu, ' ');
  await writeFile(file, `---\nname: ${directory.split(/[\\/]/u).at(-1)}\ndescription: >-\n  ${summary}\n---\n\n${instructions}\n`);
  const result = await new Agentbase(store).call('skill_save', {
    project_id: project.id, actor: 'agentbase-desktop', request_id: randomUUID(), title, description,
    triggers, tags: [], applies_to: [], source: pathToFileURL(file).href, category, status: 'active',
  });
  console.log(JSON.stringify({ ok: true, id: result.id }));
} catch (error) {
  if (directory) await rm(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: false, error: (error as Error).message }));
  process.exitCode = 1;
} finally { store.close(); }
