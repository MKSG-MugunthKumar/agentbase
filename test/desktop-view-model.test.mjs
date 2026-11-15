import test from 'node:test';
import assert from 'node:assert/strict';
import { taskGroup, taskSummary, visibleGraph, memoryComparisons } from '../desktop/view-model.mjs';

test('shared desktop board follows native task placement and summary rules', () => {
  const task = (status, extra = {}) => ({ body: { status, ...extra }, dependencies: [], lease_active: true });
  assert.equal(taskGroup(task('ready')), 'Queue');
  assert.equal(taskGroup(task('in_progress')), 'Active');
  assert.equal(taskGroup(task('review')), 'Needs attention');
  assert.equal(taskGroup(task('blocked')), 'Needs attention');
  assert.equal(taskGroup({ ...task('ready'), dependencies: [{ status: 'in_progress' }] }), 'Needs attention');
  assert.equal(taskGroup({ ...task('in_progress', { owner: 'agent' }), lease_active: false }), 'Needs attention');
  assert.equal(taskGroup(task('done')), 'Done');
  assert.equal(taskSummary(task('done', { completion: { summary: 'Verified' }, progress: 'Old progress' })), 'Verified');
  assert.equal(taskSummary(task('ready', { progress: 'Working', description: 'Details' })), 'Working');
});

test('shared graph filters node types, orphans and local depth', () => {
  const graph = {
    nodes: ['project', 'task', 'memory', 'skill', 'orphan'].map(id => ({ id, kind: id === 'orphan' ? 'memory' : id })),
    edges: [{ source: 'project', target: 'task' }, { source: 'task', target: 'memory' }, { source: 'memory', target: 'skill' }],
  };
  assert.deepEqual(visibleGraph(graph, { localGraph: true, localDepth: 1, focus: 'task' }).nodes.map(node => node.id), ['project', 'task', 'memory']);
  assert.deepEqual(visibleGraph(graph, { localGraph: true, localDepth: 2, focus: 'task' }).nodes.map(node => node.id), ['project', 'task', 'memory', 'skill']);
  assert.deepEqual(visibleGraph(graph, { hiddenKinds: new Set(['memory']), orphans: false }).nodes.map(node => node.id), ['project', 'task']);
  assert.deepEqual(visibleGraph(graph, { localGraph: true, focus: 'missing' }).nodes, []);
});

test('shared memory detail finds same-content and disputed-title comparisons', () => {
  const current = { id: 'one', kind: 'memory', body: { title: 'Saved fact', content: 'The value is 1' } };
  const records = [current,
    { id: 'two', kind: 'memory', body: { title: 'Another', content: '  the  value IS 1 ' } },
    { id: 'three', kind: 'decision', body: { title: 'saved fact', content: 'The value is 2' } },
    { id: 'four', kind: 'memory', body: { title: 'Saved fact', content: 'The value is 3', status: 'forgotten' } }];
  assert.deepEqual(memoryComparisons(current, records).map(match => [match.entry.id, match.label]), [['two', 'Same content'], ['three', 'Same title, different content']]);
});
