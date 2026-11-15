import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedConnectionAction } from '../desktop/connection-actions.mjs';

test('desktop connection bridge accepts only supported host actions', () => {
  for (const action of ['status', 'install', 'enable', 'disable', 'check']) assert.equal(allowedConnectionAction('codex', action), true);
  for (const action of ['status', 'install', 'remove', 'check']) assert.equal(allowedConnectionAction('claude', action), true);
  for (const [host, action] of [['codex', 'remove'], ['claude', 'disable'], ['other', 'install'], ['codex', 'delete'], [null, 'check'], ['codex', null]]) {
    assert.equal(allowedConnectionAction(host, action), false);
  }
});
