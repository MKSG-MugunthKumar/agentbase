import { createPrivateKey, sign } from 'node:crypto';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const keyPath = process.env.AGENTBASE_ASC_KEY_PATH;
const keyID = process.env.AGENTBASE_ASC_KEY_ID;
const issuerID = process.env.AGENTBASE_ASC_ISSUER_ID;
const appID = process.env.AGENTBASE_ASC_APP_ID || '6835021452';
const packagePath = resolve(process.argv[2] || 'build/store/AgentBase-0.7.6-macos-store.pkg');
if (!keyPath || !keyID || !issuerID) throw new Error('Set AGENTBASE_ASC_KEY_PATH, AGENTBASE_ASC_KEY_ID, and AGENTBASE_ASC_ISSUER_ID.');
const version = process.env.AGENTBASE_ASC_VERSION || '0.7.6';
const build = process.env.AGENTBASE_ASC_BUILD || '1';
const key = createPrivateKey(await readFile(keyPath));
const now = Math.floor(Date.now() / 1000);
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${b64({ alg: 'ES256', kid: keyID, typ: 'JWT' })}.${b64({ iss: issuerID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
const token = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
const api = async (method, path, data) => {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(result.errors ?? result)}`);
  return result;
};
if (process.env.AGENTBASE_ASC_STATUS_UPLOAD_ID) {
  const result = await api('GET', `/v1/buildUploads/${process.env.AGENTBASE_ASC_STATUS_UPLOAD_ID}`);
  console.log(JSON.stringify({ id: result.data.id, ...result.data.attributes }));
  process.exit(0);
}
const { size } = await stat(packagePath);
const resumeUploadID = process.env.AGENTBASE_ASC_RESUME_UPLOAD_ID;
const resumeFileID = process.env.AGENTBASE_ASC_RESUME_FILE_ID;
if (Boolean(resumeUploadID) !== Boolean(resumeFileID)) throw new Error('Provide both resume IDs.');
const upload = resumeUploadID ? { data: { id: resumeUploadID } } : await api('POST', '/v1/buildUploads', { data: {
  type: 'buildUploads', attributes: { cfBundleShortVersionString: version, cfBundleVersion: build, platform: 'MAC_OS' },
  relationships: { app: { data: { type: 'apps', id: appID } } },
} });
const uploadID = upload.data.id;
console.log(`Reserved build upload ${uploadID}`);
const file = resumeFileID ? { data: { id: resumeFileID } } : await api('POST', '/v1/buildUploadFiles', { data: {
  type: 'buildUploadFiles', attributes: { assetType: 'ASSET', fileName: basename(packagePath), fileSize: size, uti: 'com.apple.pkg' },
  relationships: { buildUpload: { data: { type: 'buildUploads', id: uploadID } } },
} });
if (!resumeFileID) {
  const operations = file.data.attributes.uploadOperations;
  if (!Array.isArray(operations) || !operations.length) throw new Error('Apple supplied no build upload operations.');
  const handle = await open(packagePath, 'r');
  try {
    for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    const chunk = Buffer.alloc(operation.length);
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, operation.offset);
    if (bytesRead !== chunk.length) throw new Error(`Short read for upload operation ${index + 1}`);
    const headers = Object.fromEntries((operation.requestHeaders ?? []).map(header => [header.name, header.value]));
    const response = await fetch(operation.url, { method: operation.method, headers, body: chunk });
    if (!response.ok) throw new Error(`Build chunk ${index + 1}/${operations.length}: HTTP ${response.status} ${await response.text()}`);
    console.log(`Uploaded chunk ${index + 1}/${operations.length}`);
    }
  } finally { await handle.close(); }
}
await api('PATCH', `/v1/buildUploadFiles/${file.data.id}`, { data: {
  type: 'buildUploadFiles', id: file.data.id,
  attributes: { uploaded: true },
} });
const result = await api('GET', `/v1/buildUploads/${uploadID}`);
const summary = { appID, version, build, uploadID, fileID: file.data.id, state: result.data.attributes.state };
await writeFile(join(resolve('build/store'), 'upload-status.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
