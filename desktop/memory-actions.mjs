import { randomUUID } from 'node:crypto';

const projectId = /^project_[a-z0-9-]+$/iu;
const text = (value, max) => typeof value === 'string' && value.length <= max ? value.trim() : null;

export function prepareMemoryAction(input) {
  if (!input || typeof input !== 'object' || !projectId.test(input.project_id) || !/^(memory|decision)_[a-z0-9-]+$/iu.test(input.id) || !Number.isSafeInteger(input.expected_version) || input.expected_version < 1) return null;
  const action = input.action;
  const reason = text(input.reason, 4000);
  if (reason === null) return null;
  const payload = { project_id: input.project_id, id: input.id, expected_version: input.expected_version, actor: 'inspector', request_id: randomUUID() };
  if (action === 'approve') return { tool: 'memory_review', payload: { ...payload, action } };
  if (action === 'reject') return reason ? { tool: 'memory_review', payload: { ...payload, action, reason } } : null;
  if (['stale', 'disputed', 'forgotten'].includes(action)) return reason ? { tool: 'memory_update', payload: { ...payload, status: action, reason } } : null;
  if (action === 'edit') {
    const title = text(input.title, 500), content = text(input.content, 200000), source = text(input.source, 20000);
    const validFrom = text(input.valid_from, 10), validUntil = text(input.valid_until, 10);
    if (!title || !content || !source || validFrom === null || validUntil === null) return null;
    return { tool: 'memory_review', payload: { ...payload, action, title, content, source, valid_from: validFrom || null, valid_until: validUntil || null, reason: reason || 'Corrected in inspector.' } };
  }
  if (action === 'supersede') {
    const title = text(input.title, 500), content = text(input.content, 200000), source = text(input.source, 20000);
    const validFrom = text(input.valid_from, 10), validUntil = text(input.valid_until, 10);
    const kind = input.kind === 'decision' ? 'decision' : input.kind;
    if (!title || !content || !source || validFrom === null || validUntil === null || !['fact', 'lesson', 'constraint', 'decision'].includes(kind) || !['observed', 'user_stated', 'inferred'].includes(input.epistemic_status) || !['project', 'task'].includes(input.scope)) return null;
    const next = { project_id: input.project_id, actor: 'inspector', request_id: randomUUID(), kind, title, content, source, epistemic_status: input.epistemic_status, scope: input.scope, supersedes: input.id };
    if (input.scope === 'task') {
      if (typeof input.task_id !== 'string' || !/^task_[a-z0-9-]+$/iu.test(input.task_id)) return null;
      next.task_id = input.task_id;
    }
    if (validFrom) next.valid_from = validFrom;
    if (validUntil) next.valid_until = validUntil;
    return { tool: 'memory_record', payload: next };
  }
  return null;
}
