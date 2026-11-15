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
  return null;
}
