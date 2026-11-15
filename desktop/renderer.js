const byId = (id) => document.getElementById(id);
const state = { view: 'graph', project: 'agentbase:all', record: '', search: '', snapshot: null, loading: false, queued: false };

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

function heading(name, count) {
  const row = el('div', 'section-heading');
  row.append(el('h2', '', name), el('span', '', count));
  return row;
}

function empty(message) { return el('div', 'empty-state', message); }
function titleOf(record) { return record?.body?.title || record?.body?.name || record?.body?.summary || record?.body?.goal || record?.kind || 'Untitled'; }
function summaryOf(record) { return record?.body?.description || record?.body?.content || record?.body?.summary || ''; }

async function refresh() {
  if (state.loading) { state.queued = true; return; }
  state.loading = true;
  try {
    const snapshot = await window.agentbase.snapshot({ project: state.project, record: state.record, search: state.search });
    state.snapshot = snapshot;
    render();
  } catch (error) {
    byId('notice').textContent = `Could not open AgentBase: ${error.message}`;
  } finally {
    state.loading = false;
    if (state.queued) { state.queued = false; refresh(); }
  }
}

function renderProjects(snapshot) {
  const select = byId('project');
  const options = [{ id: 'agentbase:all', name: 'All projects' }, ...(snapshot.projects || [])];
  const value = options.some(p => p.id === state.project) ? state.project : 'agentbase:all';
  if (select.options.length !== options.length || [...select.options].some((option, i) => option.value !== options[i].id || option.textContent !== options[i].name)) {
    select.replaceChildren(...options.map(project => {
      const option = el('option', '', project.name);
      option.value = project.id;
      return option;
    }));
  }
  select.value = value;
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  renderProjects(snapshot);
  byId('notice').textContent = snapshot.status === 'error' ? snapshot.error : '';
  const metadata = {
    graph: ['Graph', 'Project knowledge and relationships'],
    tasks: ['Tasks', 'Current work across your projects'],
    records: ['Records', 'Saved memory, plans, analyses and handoffs'],
  }[state.view];
  byId('title').textContent = metadata[0];
  byId('subtitle').textContent = metadata[1];
  for (const button of document.querySelectorAll('.nav')) button.classList.toggle('active', button.dataset.view === state.view);
  const content = byId('content');
  if (snapshot.status === 'empty') content.replaceChildren(empty('No AgentBase data was found in this folder. Choose another data folder or connect an agent to create a project.'));
  else if (snapshot.status === 'error') content.replaceChildren(empty('The project store could not be read. See the message above.'));
  else if (state.view === 'tasks') renderTasks(content, snapshot);
  else if (state.view === 'records') renderRecords(content, snapshot);
  else renderGraph(content, snapshot);
  renderDetail(snapshot);
}

function selectRecord(id) { state.record = id; refresh(); }

function renderTasks(target, snapshot) {
  const records = (snapshot.records || []).filter(r => r.kind === 'task');
  const groups = [
    ['Ready', r => ['ready', 'todo', 'open', 'pending'].includes(r.body?.status)],
    ['In progress', r => ['in_progress', 'active', 'doing'].includes(r.body?.status)],
    ['Blocked', r => r.body?.status === 'blocked'],
    ['Done', r => ['done', 'cancelled'].includes(r.body?.status)],
  ];
  const board = el('div', 'board');
  for (const [label, predicate] of groups) {
    const tasks = records.filter(predicate);
    const column = el('div', 'column');
    const top = el('h3'); top.append(el('span', '', label), el('span', '', tasks.length)); column.append(top);
    for (const record of tasks) {
      const card = el('button', `card${record.id === state.record ? ' selected' : ''}`);
      card.append(el('strong', '', titleOf(record)), el('small', '', record.body?.priority ? `Priority ${record.body.priority}` : record.updated_at?.slice(0, 10) || ''));
      card.addEventListener('click', () => selectRecord(record.id));
      column.append(card);
    }
    board.append(column);
  }
  const other = records.filter(r => !groups.some(([, predicate]) => predicate(r)));
  if (other.length) {
    const column = el('div', 'column'); column.append(el('h3', '', `Other · ${other.length}`));
    for (const record of other) {
      const card = el('button', 'card', titleOf(record));
      card.addEventListener('click', () => selectRecord(record.id)); column.append(card);
    }
    board.append(column);
  }
  target.replaceChildren(heading('Task board', `${records.length} tasks`), records.length ? board : empty('No tasks in this project yet.'));
}

function renderRecords(target, snapshot) {
  if (state.project === 'agentbase:all') {
    target.replaceChildren(heading('Project records', 'Choose a project'), empty('Choose a project in the sidebar to browse its saved records.'));
    return;
  }
  const records = (snapshot.records || []).filter(r => r.kind !== 'task' && r.kind !== 'session' && r.kind !== 'checkpoint');
  const list = el('div', 'record-list');
  for (const record of records) {
    const card = el('button', `record${record.id === state.record ? ' selected' : ''}`);
    card.append(el('strong', '', titleOf(record)), el('small', '', `${record.kind} · ${record.updated_at?.slice(0, 10) || ''}`));
    card.addEventListener('click', () => selectRecord(record.id)); list.append(card);
  }
  target.replaceChildren(heading('Project records', `${records.length} shown`), records.length ? list : empty('No saved records in this project yet.'));
}

function renderGraph(target, snapshot) {
  if (state.search) {
    const found = snapshot.graph_search?.nodes || [];
    const list = el('div', 'record-list');
    for (const node of found) {
      const card = el('button', 'record');
      card.append(el('strong', '', node.title), el('small', '', `${node.kind} · ${node.summary || ''}`));
      card.addEventListener('click', () => selectRecord(node.id)); list.append(card);
    }
    target.replaceChildren(heading('Search results', `${found.length} shown`), found.length ? list : empty('No matching project records.'));
    return;
  }
  const graph = snapshot.graph || { nodes: [], edges: [] };
  const nodes = [...graph.nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, 55);
  if (!nodes.length) { target.replaceChildren(heading('Knowledge graph', '0 nodes'), empty('No project graph is available yet.')); return; }
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '0 0 1000 600'); svg.setAttribute('class', 'graph'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Interactive project graph');
  const points = new Map();
  nodes.forEach((node, index) => {
    const angle = index * 2.3999632297;
    const radius = index === 0 ? 0 : Math.sqrt(index / nodes.length) * 265;
    points.set(node.id, { x: 500 + Math.cos(angle) * radius * 1.6, y: 300 + Math.sin(angle) * radius });
  });
  for (const edge of graph.edges || []) {
    const a = points.get(edge.source), b = points.get(edge.target);
    if (!a || !b) continue;
    const line = document.createElementNS(svgNS, 'line'); line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y); line.setAttribute('class', 'edge'); svg.append(line);
  }
  for (const node of nodes) {
    const p = points.get(node.id);
    const group = document.createElementNS(svgNS, 'g'); group.setAttribute('class', 'node-group'); group.setAttribute('tabindex', '0');
    const circle = document.createElementNS(svgNS, 'circle'); circle.setAttribute('cx', p.x); circle.setAttribute('cy', p.y); circle.setAttribute('r', node.id === state.record ? '13' : '10'); circle.setAttribute('class', `node-circle ${node.kind}`);
    const label = document.createElementNS(svgNS, 'text'); label.setAttribute('x', p.x + 15); label.setAttribute('y', p.y + 4); label.setAttribute('class', 'node-label'); label.textContent = node.title?.slice(0, 28) || node.kind;
    const tip = document.createElementNS(svgNS, 'title'); tip.textContent = `${node.kind}: ${node.title}`;
    group.append(circle, label, tip); group.addEventListener('click', () => selectRecord(node.id)); group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') selectRecord(node.id); }); svg.append(group);
  }
  target.replaceChildren(heading('Knowledge graph', `${graph.total_nodes ?? graph.nodes.length} nodes · ${graph.edges?.length || 0} links`), svg);
}

function renderDetail(snapshot) {
  const target = byId('detail');
  const record = (snapshot.records || []).find(r => r.id === state.record);
  const node = (snapshot.graph?.nodes || []).find(n => n.id === state.record);
  if (!record && !node) { target.replaceChildren(el('div', 'empty-detail', 'Select an item to inspect it.')); return; }
  const kind = record?.kind || node.kind;
  const title = record ? titleOf(record) : node.title;
  const contents = [el('div', 'detail-kind', kind), el('h2', 'detail-title', title)];
  if (record?.body?.status) contents.push(el('span', 'pill', record.body.status.replaceAll('_', ' ')));
  if (record) {
    contents.push(el('div', 'detail-meta', `Updated ${record.updated_at?.slice(0, 10) || 'unknown'} · Version ${record.version ?? '—'}`));
    const summary = summaryOf(record);
    if (summary) contents.push(el('div', 'detail-body', summary));
    if (record.body?.acceptance?.length) {
      const section = el('div', 'detail-section'); section.append(el('h3', '', 'Acceptance'), el('p', '', record.body.acceptance.join('\n• '))); contents.push(section);
    }
    if (record.body?.reason) {
      const section = el('div', 'detail-section'); section.append(el('h3', '', 'Reason'), el('p', '', record.body.reason)); contents.push(section);
    }
  } else contents.push(el('div', 'detail-body', node.summary || ''));
  target.replaceChildren(...contents);
}

document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
byId('project').addEventListener('change', event => { state.project = event.target.value; state.record = ''; refresh(); });
byId('refresh').addEventListener('click', refresh);
byId('search').addEventListener('input', event => { state.search = event.target.value; clearTimeout(window.searchTimer); window.searchTimer = setTimeout(refresh, 250); });
byId('choose-store').addEventListener('click', async () => { byId('store-path').textContent = await window.agentbase.chooseStore(); state.project = 'agentbase:all'; state.record = ''; refresh(); });
window.agentbase.storePath().then(path => { byId('store-path').textContent = path; });
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
