import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultEndpoint, generalCriteria, judgeRequest, judgeResult, validateAIConfig } from './ai-judge.mjs';

export function createAIService({ app, safeStorage, runTool, fetchImpl = fetch }) {
  const file = join(app.getPath('userData'), 'ai-settings.json');
  const fallback = () => ({ provider: 'OpenAI-compatible', endpoint: defaultEndpoint('OpenAI-compatible'), model: '', keys: {} });
  const read = async () => {
    try { return { ...fallback(), ...JSON.parse(await readFile(file, 'utf8')) }; }
    catch (error) { if (error.code === 'ENOENT') return fallback(); throw error; }
  };
  const publicConfig = value => ({ provider: value.provider, endpoint: value.endpoint, model: value.model, hasKey: !!value.keys?.[value.provider] });
  const write = async value => {
    await mkdir(app.getPath('userData'), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
  };
  return {
    async status() { return { ok: true, ...publicConfig(await read()) }; },
    async save(input) {
      const config = validateAIConfig(input);
      if (!config) return { ok: false, error: 'Enter a model name and valid HTTPS API URL.' };
      const previous = await read();
      const keys = previous.keys || {};
      if (input.apiKey) {
        if (typeof input.apiKey !== 'string' || input.apiKey.length > 8000 || !(await safeStorage.isAsyncEncryptionAvailable())) return { ok: false, error: 'Secure system key storage is unavailable.' };
        keys[config.provider] = (await safeStorage.encryptStringAsync(input.apiKey)).toString('base64');
      }
      await write({ ...config, keys });
      return { ok: true, ...publicConfig({ ...config, keys }) };
    },
    async forget() { await rm(file, { force: true }); return { ok: true, ...publicConfig(fallback()) }; },
    async judge(input) {
      const saved = await read(), config = validateAIConfig(saved), body = judgeRequest(saved, input);
      if (!config || !body || !saved.keys?.[saved.provider]) return { ok: false, error: 'Save an API key and enter criteria and a submission first.' };
      const { result: key } = await safeStorage.decryptStringAsync(Buffer.from(saved.keys[saved.provider], 'base64'));
      const response = await fetchImpl(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      const replyText = await response.text();
      if (!response.ok) return { ok: false, error: `Provider returned HTTP ${response.status}: ${replyText.slice(0, 1200) || 'No details'}` };
      let reply;
      try { reply = JSON.parse(replyText); } catch { return { ok: false, error: 'Provider returned invalid JSON.' }; }
      try { return { ok: true, result: judgeResult(config, input.profile, reply) }; }
      catch (error) { return { ok: false, error: error.message }; }
    },
    async saveToTask(input) {
      if (!input || !/^project_[a-z0-9-]+$/iu.test(input.project_id) || !/^task_[a-z0-9-]+$/iu.test(input.task_id) || typeof input.task_title !== 'string' || !input.task_title.trim() || input.task_title.length > 500 || typeof input.result !== 'string' || !input.result.trim() || input.result.length > 30000) return { ok: false, error: 'Select a task and run Judge before saving.' };
      const saved = await read(), config = validateAIConfig(saved), body = judgeRequest(saved, input);
      if (!config || !body) return { ok: false, error: 'Assessment fields are invalid.' };
      const header = `AI judge assessment\nProvider: ${config.provider}\nModel: ${config.model}\nReview profile: ${input.profile}\nEvaluated: ${new Date().toISOString()}\n\nCriteria:\n${input.criteria || generalCriteria}`;
      let reference = input.reference || '', submission = input.submission, result = input.result;
      let referenceCut = false, submissionCut = false, resultCut = false;
      const compose = () => `${header}\n\nReference context:\n${reference || 'None supplied.'}${referenceCut ? '\n[Reference context excerpt truncated to fit AgentBase memory limit.]' : ''}\n\nSubmission:\n${submission}${submissionCut ? '\n[Submission excerpt truncated to fit AgentBase memory limit.]' : ''}\n\nResult:\n${result}${resultCut ? '\n[Result excerpt truncated to fit AgentBase memory limit.]' : ''}`;
      while (compose().length > 12000) {
        if (submission.length > 1000) { submission = submission.slice(0, Math.max(500, submission.length - 500)); submissionCut = true; }
        else if (reference.length > 1000) { reference = reference.slice(0, Math.max(500, reference.length - 500)); referenceCut = true; }
        else if (result.length > 1000) { result = result.slice(0, Math.max(500, result.length - 500)); resultCut = true; }
        else return { ok: false, error: 'Assessment and criteria exceed the AgentBase memory limit.' };
      }
      return runTool('memory_record', { actor: 'AgentBase Inspector', kind: 'lesson', title: `AI judge · ${input.task_title}`.slice(0, 500), content: compose(), source: `Provider: ${config.provider} · ${config.model}`, epistemic_status: 'inferred', scope: 'task', task_id: input.task_id, project_id: input.project_id, request_id: randomUUID() });
    },
  };
}
