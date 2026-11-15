import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/store.js';
import { Agentbase } from '../dist/service.js';
import { inspectorSnapshot } from '../dist/inspector.js';

test('desktop skill creation writes a project skill and exposes it to the Inspector', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentbase-desktop-skill-'));
  const root = join(temp, 'project'), home = join(temp, 'data');
  let store;
  try {
    await mkdir(root);
    store = new Store(home);
    const project = await new Agentbase(store).call('project_open', { root, name: 'Desktop test' });
    store.close(); store = undefined;
    const output = execFileSync(process.execPath, ['dist/desktop-skill-main.js', '--home', home], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8',
      input: JSON.stringify({ project_id: project.id, title: 'Review evidence', description: 'Review project evidence.', instructions: '# Steps\n\nCheck the source.', triggers: 'review evidence', category: 'Research' }),
    });
    const created = JSON.parse(output);
    assert.equal(created.ok, true);
    const file = join(root, '.agents', 'skills', 'review-evidence', 'SKILL.md');
    assert.match(await readFile(file, 'utf8'), /Check the source/u);
    const snapshot = inspectorSnapshot(home, project.id);
    assert.equal(snapshot.status, 'connected');
    assert.equal(snapshot.records.find(record => record.id === created.id)?.body.category, 'Research');
  } finally { store?.close(); await rm(temp, { recursive: true, force: true }); }
});
