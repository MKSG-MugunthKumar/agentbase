import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMemoryAction } from '../desktop/memory-actions.mjs';

const base = { project_id: 'project_abc', id: 'memory_def', expected_version: 2, reason: '' };

test('desktop memory bridge allows only scoped versioned review actions', () => {
  const approved = prepareMemoryAction({ ...base, action: 'approve' });
  assert.equal(approved.tool, 'memory_review');
  assert.equal(approved.payload.action, 'approve');
  assert.equal(approved.payload.actor, 'inspector');
  assert.equal(prepareMemoryAction({ ...base, action: 'approve', id: 'task_def' }), null);
  assert.equal(prepareMemoryAction({ ...base, action: 'approve', expected_version: 0 }), null);
  assert.equal(prepareMemoryAction({ ...base, action: 'arbitrary' }), null);
  assert.equal(prepareMemoryAction({ ...base, action: 'forgotten' }), null);
  assert.equal(prepareMemoryAction({ ...base, action: 'forgotten', reason: 'Incorrect' }).payload.status, 'forgotten');
  const edit = prepareMemoryAction({ ...base, action: 'edit', title: 'Correct', content: 'Evidence', source: 'Conversation', valid_from: '', valid_until: '' });
  assert.equal(edit.tool, 'memory_review');
  assert.equal(edit.payload.valid_from, null);
  assert.equal(edit.payload.reason, 'Corrected in inspector.');
  const supersede = prepareMemoryAction({ ...base, action: 'supersede', kind: 'fact', title: 'New', content: 'Revised evidence', source: 'Review', epistemic_status: 'observed', scope: 'project', valid_from: '', valid_until: '' });
  assert.equal(supersede.tool, 'memory_record');
  assert.equal(supersede.payload.supersedes, base.id);
  assert.equal('expected_version' in supersede.payload, false);
});
