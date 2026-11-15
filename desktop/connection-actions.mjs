const actions = {
  codex: ['status', 'install', 'enable', 'disable', 'check'],
  claude: ['status', 'install', 'remove', 'check'],
};

export function allowedConnectionAction(host, action) {
  return typeof host === 'string' && typeof action === 'string' && actions[host]?.includes(action) === true;
}
