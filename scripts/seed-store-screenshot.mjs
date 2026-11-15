import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Agentbase } from '../dist/service.js';
import { Store } from '../dist/store.js';

const home = resolve(process.argv[2]);
if (!home) throw new Error('Pass a disposable store path.');
const root = join(home, 'AgentBase Demo');
await mkdir(root, { recursive: true });
const store = new Store(home);
try {
  const agentbase = new Agentbase(store);
  const project = await agentbase.call('project_open', { root, name: 'AgentBase Demo', goal: 'Ship an open-source desktop release.' });
  const write = (name, input) => agentbase.call(name, { project_id: project.id, actor: 'screenshot-demo', request_id: randomUUID(), ...input });
  const decision = await write('memory_record', { kind: 'decision', title: 'Keep project data local', content: 'Use a local store for tasks, decisions and imported data.', source: 'Demo release plan', epistemic_status: 'observed' });
  const release = await write('knowledge_save', { node_type: 'concept', title: 'Desktop release', content: 'Package the Inspector for Mac and Windows.', source: 'Demo release plan', epistemic_status: 'observed' });
  const tasks = [
    ['Review desktop UI', 'Compare graph and task board on both platforms.', 'active'],
    ['Prepare release bundles', 'Package the Windows and macOS desktop apps.', 'active'],
    ['Check store metadata', 'Review screenshots, descriptions and privacy labels.', 'open'],
    ['Write contributor guide', 'Document setup and local checks for contributors.', 'open'],
  ];
  for (const [title, description, status] of tasks) {
    let task = await write('task_create', { title, description, acceptance: ['Review the result.'], related_ids: [release.id] });
    if (status === 'active') task = await write('task_claim', { id: task.id, expected_version: task.version });
  }
} finally { store.close(); }
