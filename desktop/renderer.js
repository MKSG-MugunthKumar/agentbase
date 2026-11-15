const $ = id => document.getElementById(id);
const state = { view: 'graph', project: 'agentbase:all', record: '', skill: '', skillEditing: false, search: '', skillSearch: '', skillCategory: 'All', statusFilter: 'All', includeBackground: false, snapshot: null, loading: false, queued: false, panel: '', zoom: 1, panX: 0, panY: 0 };

function el(tag, cls, value) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = String(value);
  return node;
}
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
function titleOf(record) { return record?.body?.title || record?.body?.name || record?.body?.summary || record?.kind || 'Untitled'; }
function projectName(project) { return project?.root?.split(/[\\/]/).filter(Boolean).at(-1) || project?.name || 'Project'; }
function short(value, limit = 110) { const text = String(value || '').trim(); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text; }
function empty(title, body = '') { const wrap = el('div', 'skills-empty'); const inner = el('div'); inner.append(el('h2', '', title), el('p', '', body)); wrap.append(inner); return wrap; }

async function refresh() {
  if (state.loading) { state.queued = true; return; }
  state.loading = true;
  try {
    state.snapshot = await window.agentbase.snapshot({ project: state.project, record: state.record, search: state.search, includeBackground: state.includeBackground });
    render();
  } catch (error) { $('notice').textContent = `Could not open AgentBase: ${error.message}`; }
  finally { state.loading = false; if (state.queued) { state.queued = false; refresh(); } }
}

function renderProjects(snapshot) {
  const projects = [{ id: 'agentbase:all', name: 'All Projects' }, ...(snapshot.projects || []).map(project => ({ id: project.id, name: projectName(project) }))];
  const select = $('project');
  if (select.options.length !== projects.length || [...select.options].some((option, i) => option.value !== projects[i].id || option.textContent !== projects[i].name)) {
    select.replaceChildren(...projects.map(project => { const option = el('option', '', project.name); option.value = project.id; return option; }));
  }
  select.value = state.project;
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  renderProjects(snapshot);
  document.body.dataset.view = state.view;
  $('notice').textContent = snapshot.status === 'error' ? snapshot.error : '';
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === state.view);
  $('task-filter').hidden = state.view !== 'tasks';
  $('search-wrap').hidden = state.view === 'skills';
  $('new-skill').hidden = state.view !== 'skills';
  $('new-skill').disabled = state.project === 'agentbase:all';
  $('more').hidden = state.view === 'skills';
  document.querySelector('.toolbar-icons').hidden = state.view === 'skills';
  $('graph-settings').hidden = state.view !== 'graph';
  $('fit').hidden = state.view !== 'graph';
  $('graph-count').textContent = state.view === 'graph' && snapshot.graph ? `${snapshot.graph.total_nodes ?? snapshot.graph.nodes?.length ?? 0} nodes · ${snapshot.graph.edges?.length ?? 0} links` : '';
  $('search').placeholder = state.view === 'tasks' ? 'Search tasks' : state.project === 'agentbase:all' ? 'Search all projects' : 'Search project';
  if (snapshot.status === 'error') $('content').replaceChildren(empty('Could not open store', snapshot.error));
  else if (snapshot.status === 'empty') $('content').replaceChildren(empty('No projects yet', 'Choose another data folder or connect an agent to create a project.'));
  else if (state.view === 'tasks') renderTasks(snapshot);
  else if (state.view === 'skills') renderSkills(snapshot);
  else renderGraph(snapshot);
  renderPanel(snapshot);
}

function selectRecord(id) { state.record = id; state.panel = 'record'; refresh(); }
function badge(status) {
  const label = status?.replaceAll('_', ' ') || 'open';
  const cls = status === 'blocked' ? 'blocked' : status === 'done' ? 'done' : ['active', 'in_progress'].includes(status) ? 'active' : '';
  return el('span', `status-badge ${cls}`, label);
}
function taskGroup(status) {
  if (['done', 'cancelled'].includes(status)) return 'Done';
  if (status === 'blocked') return 'Needs attention';
  if (['active', 'in_progress', 'doing'].includes(status)) return 'Active';
  return 'Queue';
}
function renderTasks(snapshot) {
  const projects = new Map((snapshot.projects || []).map(project => [project.id, projectName(project)]));
  const phrase = state.search.toLocaleLowerCase();
  const tasks = (snapshot.records || []).filter(record => record.kind === 'task' && (!phrase || `${titleOf(record)} ${record.body?.description || ''}`.toLocaleLowerCase().includes(phrase)));
  const filter = state.statusFilter;
  const names = filter === 'Done' ? ['Done'] : filter === 'Needs attention' ? ['Needs attention'] : filter === 'Open' ? ['Queue', 'Active', 'Needs attention'] : ['Queue', 'Active', 'Needs attention', 'Done'];
  const board = el('div', 'board');
  board.style.gridTemplateColumns = `repeat(${names.length},minmax(0,1fr))`;
  for (const name of names) {
    const matches = tasks.filter(record => taskGroup(record.body?.status) === name);
    const column = el('section', 'board-column');
    const heading = el('div', `board-heading ${name === 'Done' ? 'done' : ''}`);
    heading.append(el('span', 'dot'), el('span', '', name), el('span', 'count', matches.length));
    column.append(heading);
    if (!matches.length) column.append(el('p', 'board-empty', 'No tasks'));
    for (const record of matches) {
      const card = el('button', `task-card${record.id === state.record && state.panel === 'record' ? ' selected' : ''}`);
      card.append(el('span', 'task-project', projects.get(record.project_id) || 'Project'), el('div', 'task-title', titleOf(record)), badge(record.body?.status));
      if (record.body?.description) card.append(el('p', 'task-description', short(record.body.description, 155)));
      if (record.body?.reason && name === 'Needs attention') card.append(el('p', 'task-reason', `◉  ${short(record.body.reason, 120)}`));
      card.addEventListener('click', () => selectRecord(record.id));
      column.append(card);
    }
    board.append(column);
  }
  $('content').replaceChildren(board);
}

function graphPositions(nodes, edges) {
  const points = new Map();
  const byId = new Map(nodes.map(node => [node.id, node]));
  const neighbours = new Map(nodes.map(node => [node.id, []]));
  const links = [];
  const seen = new Set();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) continue;
    const key = [edge.source, edge.target].sort().join('\0');
    if (!seen.has(key)) { links.push(edge); seen.add(key); }
    neighbours.get(edge.source).push(edge.target);
    neighbours.get(edge.target).push(edge.source);
  }
  const golden = 2.399963;
  const roots = nodes.filter(node => node.kind === 'project');
  roots.forEach((node, index) => {
    const angle = index * Math.PI * 2 / Math.max(roots.length, 1);
    points.set(node.id, { x: roots.length === 1 ? 0 : Math.cos(angle) * 280, y: roots.length === 1 ? 0 : Math.sin(angle) * 220 });
  });
  const pending = nodes.filter(node => !points.has(node.id));
  while (pending.length) {
    const index = pending.findIndex(node => neighbours.get(node.id).some(id => points.has(id)));
    const node = pending.splice(index < 0 ? 0 : index, 1)[0];
    const connected = neighbours.get(node.id).map(id => points.get(id)).filter(Boolean);
    const anchor = connected.length ? { x: connected.reduce((sum, point) => sum + point.x, 0) / connected.length, y: connected.reduce((sum, point) => sum + point.y, 0) / connected.length } : { x: 0, y: 0 };
    const number = nodes.indexOf(node) + 1, angle = number * golden;
    points.set(node.id, { x: anchor.x + Math.cos(angle) * 185, y: anchor.y + Math.sin(angle) * 130 });
  }
  const velocity = new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));
  for (let step = 0; step < 160; step++) {
    const force = new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = points.get(nodes[i].id), b = points.get(nodes[j].id);
      const dx = a.x - b.x || .01, dy = a.y - b.y || .01;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const repulsion = Math.min(6, 19000 / (distance * distance));
      const overlapX = Math.max(0, 192 - Math.abs(dx));
      const overlapY = Math.max(0, 50 - Math.abs(dy));
      const collision = overlapX && overlapY ? Math.min(7, Math.min(overlapX / 22, overlapY / 7)) : 0;
      const x = dx / distance * repulsion + Math.sign(dx) * collision;
      const y = dy / distance * repulsion + Math.sign(dy) * collision;
      force.get(nodes[i].id).x += x; force.get(nodes[i].id).y += y;
      force.get(nodes[j].id).x -= x; force.get(nodes[j].id).y -= y;
    }
    for (const edge of links) {
      const a = points.get(edge.source), b = points.get(edge.target);
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const strength = edge.relation === 'child' ? .025 : .018;
      const pull = (distance - 140) * strength;
      force.get(edge.source).x += dx / distance * pull;
      force.get(edge.source).y += dy / distance * pull;
      force.get(edge.target).x -= dx / distance * pull;
      force.get(edge.target).y -= dy / distance * pull;
    }
    for (const node of nodes) {
      const point = points.get(node.id), speed = velocity.get(node.id), effect = force.get(node.id);
      speed.x = (speed.x + effect.x - point.x * .001) * .78;
      speed.y = (speed.y + effect.y - point.y * .001) * .78;
      point.x += Math.max(-12, Math.min(12, speed.x));
      point.y += Math.max(-12, Math.min(12, speed.y));
    }
  }
  const xs = [...points.values()].map(point => point.x), ys = [...points.values()].map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(1, 840 / Math.max(1, maxX - minX), 475 / Math.max(1, maxY - minY));
  for (const point of points.values()) { point.x = 55 + (point.x - minX) * scale; point.y = 125 + (point.y - minY) * scale; }
  // Labels occupy much more space than their dots. Settle their rectangles after fitting.
  for (let step = 0; step < 100; step++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = points.get(nodes[i].id), b = points.get(nodes[j].id);
      const dx = a.x - b.x, dy = a.y - b.y;
      const overlapX = 185 - Math.abs(dx), overlapY = 52 - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX / 185 < overlapY / 52) {
        const amount = Math.min(4, overlapX / 2), sign = Math.sign(dx) || (i % 2 ? 1 : -1);
        a.x += amount * sign; b.x -= amount * sign;
      } else {
        const amount = Math.min(3, overlapY / 2), sign = Math.sign(dy) || (i % 2 ? 1 : -1);
        a.y += amount * sign; b.y -= amount * sign;
      }
    }
    for (const point of points.values()) { point.x = Math.max(50, Math.min(930, point.x)); point.y = Math.max(120, Math.min(635, point.y)); }
  }
  return points;
}
function graphLabel(group, node, point) {
  const words = String(node.title || node.kind).split(/\s+/u);
  const lines = []; let line = '';
  for (const word of words) {
    if ((line + ' ' + word).length > 27 && line) { lines.push(line); line = word; }
    else line += `${line ? ' ' : ''}${word}`;
  }
  if (line) lines.push(line);
  const text = svgEl('text', { x: point.x + 15, y: point.y - Math.min(lines.length - 1, 1) * 7, class: 'graph-label' });
  lines.slice(0, 2).forEach((value, index) => {
    const span = svgEl('tspan', { x: point.x + 15, dy: index ? 16 : 0 });
    span.textContent = index === 1 && lines.length > 2 ? short(value, 22) : value;
    text.append(span);
  });
  group.append(text);
}
function renderGraph(snapshot) {
  const graph = snapshot.graph || { nodes: [], edges: [] };
  const shell = el('div', 'graph-view');
  if (!graph.nodes?.length) { shell.append(empty('No nodes yet', 'This graph grows as AgentBase records your project work.')); $('content').replaceChildren(shell); return; }
  const nodes = [...graph.nodes].sort((a, b) => (b.kind === 'project') - (a.kind === 'project') || (b.degree || 0) - (a.degree || 0)).slice(0, 35);
  const ids = new Set(nodes.map(node => node.id));
  const edges = (graph.edges || []).filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const points = graphPositions(nodes, edges);
  const svg = svgEl('svg', { viewBox: '0 0 1100 720', role: 'img', 'aria-label': `Knowledge graph: ${nodes.length} nodes and ${edges.length} links` });
  const viewport = svgEl('g');
  const transform = () => viewport.setAttribute('transform', `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
  transform();
  for (const edge of edges) {
    const a = points.get(edge.source), b = points.get(edge.target);
    viewport.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'graph-edge' }));
  }
  for (const node of nodes) {
    const point = points.get(node.id), group = svgEl('g', { class: 'graph-hit', tabindex: '0' });
    group.append(svgEl('circle', { cx: point.x, cy: point.y, r: node.kind === 'project' ? 8 : 6, class: `graph-node${node.id === state.record ? ' selected' : ''}` }));
    graphLabel(group, node, point);
    const tip = svgEl('title'); tip.textContent = node.title; group.append(tip);
    group.addEventListener('click', event => { event.stopPropagation(); selectRecord(node.id); });
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') selectRecord(node.id); });
    viewport.append(group);
  }
  svg.append(viewport); shell.append(svg);
  let drag;
  svg.addEventListener('pointerdown', event => { if (event.target.closest('.graph-hit')) return; drag = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY }; svg.setPointerCapture(event.pointerId); svg.classList.add('dragging'); });
  svg.addEventListener('pointermove', event => { if (!drag) return; const scale = 1100 / svg.clientWidth; state.panX = drag.panX + (event.clientX - drag.x) * scale; state.panY = drag.panY + (event.clientY - drag.y) * scale; transform(); });
  svg.addEventListener('pointerup', () => { drag = null; svg.classList.remove('dragging'); });
  svg.addEventListener('wheel', event => { event.preventDefault(); state.zoom = Math.max(.35, Math.min(2.5, state.zoom * (event.deltaY < 0 ? 1.1 : .9))); transform(); }, { passive: false });
  $('content').replaceChildren(shell);
}

function renderSkills(snapshot) {
  if (state.project === 'agentbase:all') { $('content').replaceChildren(empty('Choose a project', 'Skills belong to a project. Select one to browse skills.')); return; }
  const all = (snapshot.records || []).filter(record => record.kind === 'skill').sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  const categories = ['All', ...new Set(all.map(record => record.body?.category || 'General'))];
  if (!categories.includes(state.skillCategory)) state.skillCategory = 'All';
  const skills = all.filter(record => (state.skillCategory === 'All' || (record.body?.category || 'General') === state.skillCategory) && (!state.skillSearch || `${titleOf(record)} ${record.body?.description || ''} ${(record.body?.tags || []).join(' ')}`.toLocaleLowerCase().includes(state.skillSearch.toLocaleLowerCase())));
  if (!skills.some(record => record.id === state.skill)) state.skill = skills[0]?.id || '';
  const view = el('div', 'skills-view'), list = el('div', 'skill-list'), detail = el('div', 'skill-detail');
  const search = el('input', 'skill-search'); search.placeholder = 'Search skills'; search.value = state.skillSearch;
  search.addEventListener('input', event => { state.skillSearch = event.target.value; renderSkills(snapshot); const field = document.querySelector('.skill-search'); field.focus(); field.setSelectionRange(field.value.length, field.value.length); });
  const controls = el('div', 'skill-controls'); controls.append(el('label', '', 'Category'));
  const category = el('select');
  for (const name of categories) { const option = el('option', '', name === 'All' ? 'All categories' : name); option.value = name; category.append(option); }
  category.value = state.skillCategory;
  category.addEventListener('change', event => { state.skillCategory = event.target.value; renderSkills(snapshot); });
  controls.append(category, el('span', '', `${skills.length}`));
  list.append(search, controls);
  for (const record of skills) {
    const card = el('button', `skill-card${record.id === state.skill ? ' selected' : ''}`);
    card.append(el('strong', '', titleOf(record)), el('small', '', record.body?.description || ''));
    card.addEventListener('click', () => { state.skill = record.id; renderSkills(snapshot); }); list.append(card);
  }
  if (!skills.length) list.append(el('p', 'board-empty', 'No skills'));
  const selected = skills.find(record => record.id === state.skill);
  if (state.skillEditing) renderSkillEditor(detail);
  else if (selected) {
    detail.append(el('h1', '', titleOf(selected)), el('p', '', selected.body?.description || ''));
    if (selected.body?.triggers?.length) { detail.append(el('h2', '', 'Use when')); for (const trigger of selected.body.triggers) detail.append(el('div', 'trigger', trigger)); }
    if (selected.body?.source) { const section = el('details'); section.append(el('summary', '', 'Details'), el('p', '', selected.body.source)); detail.append(section); }
    if (selected.body?.tags?.length) { const section = el('details'); section.append(el('summary', '', 'Tags'), el('p', '', selected.body.tags.join(', '))); detail.append(section); }
  } else detail.append(empty('Select a skill', 'Browse the project catalog.'));
  view.append(list, detail); $('content').replaceChildren(view);
}

function renderSkillEditor(target) {
  const form = el('form', 'skill-editor');
  form.append(el('h1', '', 'New skill'));
  const field = (label, tag = 'input') => {
    const wrap = el('label', 'editor-field'); wrap.append(el('span', '', label));
    const input = el(tag); input.name = label.toLowerCase().replaceAll(' ', '_'); input.required = ['Title', 'Description', 'Instructions'].includes(label);
    wrap.append(input); form.append(wrap); return input;
  };
  field('Title'); field('Description');
  const category = el('select'); category.name = 'category';
  for (const name of ['General', 'Coding', 'Research', 'Data', 'Planning', 'Writing']) category.append(el('option', '', name));
  const categoryWrap = el('label', 'editor-field'); categoryWrap.append(el('span', '', 'Category'), category); form.append(categoryWrap);
  field('Use when', 'textarea'); field('Instructions', 'textarea');
  const message = el('p', 'editor-message');
  const actions = el('div', 'editor-actions');
  const cancel = el('button', '', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => { state.skillEditing = false; renderSkills(state.snapshot); });
  const save = el('button', 'save-button', 'Create skill'); save.type = 'submit'; actions.append(cancel, save); form.append(message, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; message.textContent = 'Saving…';
    const values = new FormData(form);
    const result = await window.agentbase.saveSkill({ project_id: state.project, title: values.get('title'), description: values.get('description'), category: values.get('category'), triggers: values.get('use_when'), instructions: values.get('instructions') });
    if (result.ok) { state.skillEditing = false; state.skill = result.id; await refresh(); }
    else { message.textContent = result.error || 'Could not save skill.'; save.disabled = false; }
  });
  target.append(form);
}

function renderPanel(snapshot) {
  const panel = $('detail');
  if (!state.panel) { panel.hidden = true; return; }
  panel.hidden = false;
  const header = el('div', 'detail-header'); header.append(el('span', '', state.panel === 'record' ? 'Record' : state.panel === 'history' ? 'Recent changes' : 'Connections'));
  const close = el('button', '', '×'); close.setAttribute('aria-label', 'Close details'); close.addEventListener('click', () => { state.panel = ''; renderPanel(snapshot); }); header.append(close);
  const body = el('div');
  if (state.panel === 'record') {
    const record = (snapshot.records || []).find(item => item.id === state.record);
    const node = (snapshot.graph?.nodes || []).find(item => item.id === state.record);
    if (record || node) {
      body.append(el('h2', 'detail-title', record ? titleOf(record) : node.title));
      if (record?.body?.status) {
        const line = el('div', 'detail-line'); line.append(badge(record.body.status), el('span', 'detail-meta', `Updated ${new Date(record.updated_at).toLocaleDateString('en-AU')}`)); body.append(line);
      }
      body.append(el('div', 'detail-body', record?.body?.description || record?.body?.content || node?.summary || ''));
      if (record?.body?.acceptance?.length) {
        const section = el('div', 'detail-section'); section.append(el('h3', '', 'Acceptance criteria'));
        const list = el('ul'); for (const criterion of record.body.acceptance) list.append(el('li', '', criterion)); section.append(list); body.append(section);
      }
      if (record?.body?.reason) { const section = el('div', 'detail-section'); section.append(el('h3', '', 'Reason'), el('p', '', record.body.reason)); body.append(section); }
      if (record) { const section = el('details', 'detail-section'); section.append(el('summary', '', 'Full record'), el('pre', '', JSON.stringify(record.body, null, 2))); body.append(section); }
    } else body.append(el('p', 'detail-body', 'This item is outside the current project.'));
  } else if (state.panel === 'history') {
    const events = (snapshot.events || []).slice(0, 30);
    if (!events.length) body.append(el('p', 'detail-body', 'No recent changes.'));
    for (const event of events) { const section = el('div', 'detail-section'); section.append(el('h3', '', event.record_title || event.kind || 'Change'), el('p', '', `${event.action || event.type || 'Updated'} · ${event.at ? new Date(event.at).toLocaleString('en-AU') : ''}`)); body.append(section); }
  } else {
    body.append(el('h2', 'detail-title', 'Connections'), el('p', 'detail-body', 'AgentBase reads the local project store used by your coding agents. Choose the same data folder that your Codex or Claude Code connection uses.'));
    window.agentbase.storePath().then(path => { if (state.panel === 'connections') { const label = el('p', 'detail-body', `Data folder: ${path}`); body.append(label); } });
    const choose = el('button', 'task-card', 'Choose data folder…'); choose.addEventListener('click', async () => { await window.agentbase.chooseStore(); state.project = 'agentbase:all'; state.record = ''; state.panel = ''; refresh(); }); body.append(choose);
  }
  panel.replaceChildren(header, body);
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; state.panel = ''; state.record = ''; state.skillEditing = false; state.search = ''; $('search').value = ''; refresh(); }));
$('project').addEventListener('change', event => { state.project = event.target.value; state.record = ''; state.skill = ''; state.skillEditing = false; state.skillCategory = 'All'; state.panel = ''; state.zoom = 1; state.panX = 0; state.panY = 0; refresh(); });
$('status').addEventListener('change', event => { state.statusFilter = event.target.value; render(); });
$('search').addEventListener('input', event => { state.search = event.target.value; clearTimeout(window.searchTimer); window.searchTimer = setTimeout(refresh, 250); });
$('refresh').addEventListener('click', refresh);
$('history').addEventListener('click', () => { state.panel = 'history'; renderPanel(state.snapshot); });
$('connections').addEventListener('click', () => { state.panel = 'connections'; renderPanel(state.snapshot); });
$('fit').addEventListener('click', () => { state.zoom = 1; state.panX = 0; state.panY = 0; render(); });
$('graph-settings').addEventListener('click', () => { state.includeBackground = !state.includeBackground; $('graph-settings').title = state.includeBackground ? 'Show content only' : 'Show background records'; refresh(); });
$('new-skill').addEventListener('click', () => { if (state.project === 'agentbase:all') return; state.skillEditing = true; renderSkills(state.snapshot); });
$('more').addEventListener('click', () => {
  const menu = $('menu'); menu.hidden = !menu.hidden;
  if (menu.hidden) return;
  const choose = el('button', '', 'Choose data folder…'); choose.addEventListener('click', async () => { menu.hidden = true; await window.agentbase.chooseStore(); state.project = 'agentbase:all'; state.record = ''; state.panel = ''; refresh(); });
  const reload = el('button', '', 'Refresh'); reload.addEventListener('click', () => { menu.hidden = true; refresh(); });
  menu.replaceChildren(reload, choose);
});
refresh();
setInterval(() => { if (!document.hidden && !state.skillEditing) refresh(); }, 8000);
