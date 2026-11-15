import { taskGroup, taskSummary, visibleGraph, memoryComparisons } from './view-model.mjs';
import { analysisData, analysisDefaultAxes, analysisPoints } from './analysis-view.mjs';
import { attentionCriteria, defaultEndpoint, generalCriteria, taskJudgeContext } from './ai-judge.mjs';

const $ = id => document.getElementById(id);
const state = { view: 'graph', project: 'agentbase:all', record: '', recordHistory: [], historyIndex: -1, detailExpanded: false, skill: '', skillEditing: false, editingSkill: '', newTemplate: null, skillTemplates: [], templateCategory: 'General', taskLimit: 200, search: '', skillSearch: '', skillCategory: 'All', statusFilter: 'All', paused: false, memoryDraft: null, memoryBusy: false, memoryMessage: '', includeBackground: false, hiddenKinds: new Set(['session']), orphans: true, localGraph: false, localDepth: 1, colorMode: 'none', labels: true, arrows: false, nodeSize: 1, linkWidth: 1, centerForce: .12, repelForce: 2200, linkForce: .015, linkDistance: 1, snapshot: null, loading: false, queued: false, panel: '', connectionStatus: null, connectionLoading: false, connectionActionBusy: false, connectionMessage: '', connectionRequest: 0, zoom: 1, panX: 0, panY: 0 };
const aiState = { provider: 'OpenAI-compatible', endpoint: defaultEndpoint('OpenAI-compatible'), model: '', apiKey: '', hasKey: false, profile: 'General', criteria: generalCriteria, reference: '', submission: '', result: '', message: '', busy: false, loaded: false };

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
function titleOf(record) { return record?.body?.title || record?.title || record?.body?.name || record?.body?.summary || record?.kind || 'Untitled'; }
function projectName(project) { return project?.root?.split(/[\\/]/).filter(Boolean).at(-1) || project?.name || 'Project'; }
function short(value, limit = 110) { const text = String(value || '').trim(); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text; }
function empty(title, body = '') { const wrap = el('div', 'skills-empty'); const inner = el('div'); inner.append(el('h2', '', title), el('p', '', body)); wrap.append(inner); return wrap; }

async function refresh() {
  if (state.loading) { state.queued = true; return; }
  state.loading = true;
  try {
    state.snapshot = await window.agentbase.snapshot({ project: state.project, record: state.record, search: state.search, includeBackground: state.includeBackground, taskLimit: state.taskLimit });
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
  $('project').disabled = state.skillEditing;
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
  $('load-more').hidden = true;
  $('search').placeholder = state.view === 'tasks' ? 'Search tasks' : state.project === 'agentbase:all' ? 'Search all projects' : 'Search project';
  if (snapshot.status === 'error') $('content').replaceChildren(empty('Could not open store', snapshot.error));
  else if (snapshot.status === 'empty') $('content').replaceChildren(empty('No projects yet', 'Choose another data folder or connect an agent to create a project.'));
  else if (state.view === 'tasks') renderTasks(snapshot);
  else if (state.view === 'skills') renderSkills(snapshot);
  else renderGraph(snapshot);
  renderGraphSettings(snapshot);
  renderSearchResults(snapshot);
  renderPanel(snapshot);
}

function settingToggle(label, value, change) {
  const row = el('label', 'setting-row');
  const input = el('input'); input.type = 'checkbox'; input.checked = value;
  input.addEventListener('change', () => change(input.checked));
  row.append(el('span', '', label), input);
  return row;
}
function settingRange(label, value, min, max, step, change) {
  const row = el('label', 'setting-range'); row.append(el('span', '', label));
  const input = el('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
  input.addEventListener('input', () => change(Number(input.value)));
  row.append(input); return row;
}
function renderGraphSettings(snapshot) {
  const panel = $('settings-panel');
  if (panel.hidden || state.view !== 'graph' || !snapshot) { panel.hidden = true; return; }
  panel.replaceChildren(el('h2', '', 'Graph settings'), el('h3', '', 'Filters'));
  panel.append(settingToggle('Orphans', state.orphans, checked => { state.orphans = checked; renderGraph(snapshot); }));
  panel.append(settingToggle('Background records', state.includeBackground, checked => { state.includeBackground = checked; refresh(); }));
  panel.append(settingToggle('Local graph', state.localGraph, checked => { state.localGraph = checked; renderGraphSettings(snapshot); renderGraph(snapshot); }));
  if (state.localGraph) {
    const depth = settingRange(`Depth: ${state.localDepth}`, state.localDepth, 1, 4, 1, value => { state.localDepth = value; depth.querySelector('span').textContent = `Depth: ${value}`; renderGraph(snapshot); });
    panel.append(depth);
  }
  const kinds = [...new Set((snapshot.graph?.nodes || []).map(node => node.kind))].sort();
  for (const kind of kinds) panel.append(settingToggle(kind[0].toUpperCase() + kind.slice(1), !state.hiddenKinds.has(kind), checked => { if (checked) state.hiddenKinds.delete(kind); else state.hiddenKinds.add(kind); renderGraph(snapshot); }));
  panel.append(el('h3', '', 'Groups'));
  const colors = el('label', 'setting-row'); colors.append(el('span', '', 'Color by'));
  const select = el('select');
  for (const [value, label] of [['none', 'None'], ['project', 'Project'], ['type', 'Node type']]) { const option = el('option', '', label); option.value = value; select.append(option); }
  select.value = state.colorMode;
  select.addEventListener('change', () => { state.colorMode = select.value; renderGraph(snapshot); });
  colors.append(select); panel.append(colors, el('h3', '', 'Display'));
  panel.append(settingToggle('Labels', state.labels, checked => { state.labels = checked; renderGraph(snapshot); }));
  panel.append(settingToggle('Arrows', state.arrows, checked => { state.arrows = checked; renderGraph(snapshot); }));
  panel.append(settingRange('Node size', state.nodeSize, .4, 2.5, .1, value => { state.nodeSize = value; renderGraph(snapshot); }));
  panel.append(settingRange('Link thickness', state.linkWidth, .3, 3, .1, value => { state.linkWidth = value; renderGraph(snapshot); }));
  panel.append(el('h3', '', 'Forces'));
  panel.append(settingRange('Center force', state.centerForce, 0, .6, .01, value => { state.centerForce = value; renderGraph(snapshot); }));
  panel.append(settingRange('Repel force', state.repelForce, 0, 8000, 100, value => { state.repelForce = value; renderGraph(snapshot); }));
  panel.append(settingRange('Link force', state.linkForce, 0, .06, .001, value => { state.linkForce = value; renderGraph(snapshot); }));
  panel.append(settingRange('Link distance', state.linkDistance, .4, 2.5, .1, value => { state.linkDistance = value; renderGraph(snapshot); }));
  const reset = el('button', 'setting-reset', 'Restore defaults');
  reset.addEventListener('click', () => { state.hiddenKinds = new Set(['session']); state.orphans = true; state.localGraph = false; state.localDepth = 1; state.colorMode = 'none'; state.labels = true; state.arrows = false; state.nodeSize = 1; state.linkWidth = 1; state.centerForce = .12; state.repelForce = 2200; state.linkForce = .015; state.linkDistance = 1; state.includeBackground = false; refresh(); });
  panel.append(reset);
}
function renderSearchResults(snapshot) {
  const results = $('search-results');
  const search = snapshot.graph_search;
  if (state.view !== 'graph' || !state.search.trim() || !search || search.query !== state.search.trim()) { results.hidden = true; return; }
  results.hidden = false; results.replaceChildren();
  if (!search.nodes?.length) { results.append(el('p', '', 'No matching records')); return; }
  for (const node of search.nodes.slice(0, 12)) {
    const button = el('button', 'search-result');
    button.append(el('strong', '', node.title), el('small', '', node.kind + (node.summary ? ` · ${short(node.summary, 85)}` : '')));
    button.addEventListener('click', () => { state.search = ''; $('search').value = ''; results.hidden = true; selectRecord(node.id); });
    results.append(button);
  }
  if (search.omitted_matches) results.append(el('p', 'search-omitted', `${search.omitted_matches} more matches`));
}

function selectRecord(id) {
  if (state.record !== id) { state.memoryDraft = null; state.memoryMessage = ''; }
  if (state.recordHistory[state.historyIndex] !== id) {
    state.recordHistory = state.recordHistory.slice(0, state.historyIndex + 1);
    state.recordHistory.push(id); state.historyIndex = state.recordHistory.length - 1;
  }
  state.record = id; state.panel = 'record'; refresh();
}

function renderMemoryActions(body, record) {
  if (['forgotten', 'superseded', 'rejected'].includes(record.body?.status)) return;
  if (state.memoryDraft?.id !== record.id || state.memoryDraft.version !== record.version) {
    state.memoryDraft = { id: record.id, version: record.version, title: titleOf(record), content: record.body?.content || '', source: record.body?.source || '', valid_from: record.body?.valid_from || '', valid_until: record.body?.valid_until || '', reason: '' };
  }
  const draft = state.memoryDraft;
  const section = el('div', 'detail-section memory-actions');
  section.append(el('h3', '', 'Review and correct'));
  const field = (label, key, multi = false) => {
    const wrap = el('label', 'memory-field'); wrap.append(el('span', '', label));
    const input = el(multi ? 'textarea' : 'input'); input.value = draft[key]; input.disabled = state.memoryBusy;
    input.addEventListener('input', () => { draft[key] = input.value; });
    wrap.append(input); section.append(wrap);
  };
  const run = async action => {
    if (state.memoryBusy) return;
    state.memoryBusy = true; state.memoryMessage = '';
    section.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const result = await window.agentbase.memoryAction({ project_id: record.project_id, id: record.id, expected_version: record.version, action, kind: record.body?.type || (record.kind === 'decision' ? 'decision' : 'fact'), epistemic_status: record.body?.epistemic_status, scope: record.body?.scope || 'project', task_id: record.body?.task_id, ...draft });
      if (!result.ok) { state.memoryMessage = result.error || 'Could not save memory.'; return; }
      state.memoryMessage = 'Saved.';
      if (action === 'forgotten' || action === 'reject') { state.panel = ''; state.record = ''; }
      if (action === 'supersede' && result.record?.id) { state.record = result.record.id; state.memoryDraft = null; }
      await refresh();
    } catch (error) { state.memoryMessage = error.message; }
    finally { state.memoryBusy = false; if (state.snapshot) renderPanel(state.snapshot); }
  };
  const action = (label, name, disabled = false) => {
    const button = el('button', 'memory-action', label); button.disabled = state.memoryBusy || disabled;
    button.addEventListener('click', () => run(name)); return button;
  };
  section.append(action('Approve memory', 'approve'));
  field('Title', 'title'); field('Content', 'content', true); field('Source', 'source');
  field('Valid from · YYYY-MM-DD', 'valid_from'); field('Valid until · YYYY-MM-DD', 'valid_until');
  const correction = el('div', 'memory-action-row'); correction.append(action('Save correction', 'edit'), action('Supersede', 'supersede')); section.append(correction);
  field('Reason for rejection, stale, disputed, or forgetting', 'reason');
  const row = el('div', 'memory-action-row');
  for (const [label, name] of [['Reject', 'reject'], ['Mark stale', 'stale'], ['Dispute', 'disputed'], ['Forget', 'forgotten']]) row.append(action(label, name));
  section.append(row, el('p', 'detail-meta', 'Forgetting removes the stored content. The audit event keeps the action, actor, time, and version.'));
  if (state.memoryMessage) section.append(el('p', 'editor-message', state.memoryMessage));
  body.append(section);
}
function moveRecordHistory(offset) {
  const index = state.historyIndex + offset;
  if (index < 0 || index >= state.recordHistory.length) return;
  state.historyIndex = index; state.record = state.recordHistory[index]; state.panel = 'record'; refresh();
}
function badge(status) {
  const label = status?.replaceAll('_', ' ') || 'open';
  const cls = status === 'blocked' ? 'blocked' : status === 'done' ? 'done' : ['active', 'in_progress'].includes(status) ? 'active' : '';
  return el('span', `status-badge ${cls}`, label);
}
function renderTasks(snapshot) {
  const projects = new Map((snapshot.projects || []).map(project => [project.id, projectName(project)]));
  const phrase = state.search.toLocaleLowerCase();
  const tasks = (snapshot.records || []).filter(record => record.kind === 'task' && (!phrase || `${titleOf(record)} ${record.body?.description || ''} ${record.body?.owner || ''}`.toLocaleLowerCase().includes(phrase)));
  const filter = state.statusFilter;
  const names = filter === 'Done' ? ['Done'] : filter === 'Needs attention' ? ['Needs attention'] : filter === 'Open' ? ['Queue', 'Active', 'Needs attention'] : ['Queue', 'Active', 'Needs attention', 'Done'];
  const shown = tasks.filter(record => names.includes(taskGroup(record))).length;
  const loaded = (snapshot.records || []).filter(record => record.kind === 'task').length;
  const older = Math.max(0, (snapshot.counts?.task || 0) - loaded);
  $('graph-count').textContent = `${shown} of ${loaded} tasks` + (older ? ` · ${older} older tasks not loaded` : '') + (older && state.taskLimit >= 1000 ? ' · 1,000-task display limit' : '');
  $('load-more').hidden = !older || state.taskLimit >= 1000;
  $('load-more').disabled = state.paused;
  $('load-more').title = state.paused ? 'Resume updates to load more tasks' : 'Load older saved tasks (up to 1,000)';
  const workspace = el('div', 'board-workspace');
  if (filter !== 'All' || state.search) {
    const banner = el('div', 'board-filter-banner');
    let explanation = `Showing ${shown} of ${loaded} tasks`;
    if (!shown) {
      if (state.search) explanation = 'No tasks match this search.';
      else if (filter === 'Open') explanation = older ? 'No open tasks in the loaded records.' : loaded ? `All ${loaded} saved tasks are completed or cancelled.` : 'No open tasks recorded for this project.';
      else if (filter === 'Needs attention') explanation = 'No loaded tasks need attention.';
      else if (filter === 'Done') explanation = 'No completed or cancelled tasks in the loaded records.';
    }
    banner.append(el('strong', '', explanation), el('small', '', `Filter: ${filter}${state.search ? ` · Search: ${state.search}` : ''}`));
    workspace.append(banner);
  }
  const board = el('div', 'board');
  for (const name of names) {
    const matches = tasks.filter(record => taskGroup(record) === name);
    const column = el('section', 'board-column');
    const heading = el('div', `board-heading ${name === 'Done' ? 'done' : ''}`);
    heading.append(el('span', 'dot'), el('span', '', name), el('span', 'count', matches.length));
    column.append(heading);
    if (!matches.length) column.append(el('p', 'board-empty', filter === 'All' && !state.search ? 'No tasks' : 'No matches'));
    for (const record of matches) {
      const card = el('button', `task-card${record.id === state.record && state.panel === 'record' ? ' selected' : ''}`);
      card.append(el('span', 'task-project', projects.get(record.project_id) || 'Project'), el('div', 'task-title', titleOf(record)), badge(record.body?.status));
      if (record.body?.parent_task_id) {
        const parent = snapshot.records?.find(item => item.id === record.body.parent_task_id);
        card.append(el('p', 'task-parent', `↳ Subtask of ${parent ? titleOf(parent) : 'parent task'}`));
      }
      const summary = taskSummary(record);
      if (summary) card.append(el('p', 'task-description', short(summary, 155)));
      if (record.body?.reason && name === 'Needs attention') card.append(el('p', 'task-reason', `◉  ${short(record.body.reason, 120)}`));
      const blockers = (record.dependencies || []).filter(task => task.status !== 'done');
      if (blockers.length) card.append(el('p', 'task-reason', `↗  Waiting for ${blockers.length} task${blockers.length === 1 ? '' : 's'}`));
      if (record.body?.owner) card.append(el('p', 'task-owner', record.body.owner + (record.lease_active === false && ['in_progress', 'review'].includes(record.body.status) ? ' · Lease expired' : '')));
      card.addEventListener('click', () => selectRecord(record.id));
      column.append(card);
    }
    board.append(column);
  }
  workspace.append(board); $('content').replaceChildren(workspace);
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
      const repulsion = Math.min(6, 19000 * state.repelForce / 2200 / (distance * distance));
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
      const strength = (edge.relation === 'child' ? .025 : .018) * state.linkForce / .015;
      const pull = (distance - 140 * state.linkDistance) * strength;
      force.get(edge.source).x += dx / distance * pull;
      force.get(edge.source).y += dy / distance * pull;
      force.get(edge.target).x -= dx / distance * pull;
      force.get(edge.target).y -= dy / distance * pull;
    }
    for (const node of nodes) {
      const point = points.get(node.id), speed = velocity.get(node.id), effect = force.get(node.id);
      speed.x = (speed.x + effect.x - point.x * .001 * state.centerForce / .12) * .78;
      speed.y = (speed.y + effect.y - point.y * .001 * state.centerForce / .12) * .78;
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
const graphColors = {
  project: '#e0e5ef', concept: '#a399f7', task: '#52ccb3', resource: '#e8b361',
  dataset: '#e8b361', analysis: '#f17ba7', memory: '#6db2f5', decision: '#6db2f5', plan: '#ff9f28',
};
const projectColors = ['#52ccb3', '#a399f7', '#e8b361', '#6db2f5', '#f17ba7', '#ff9f28'];
let cachedGraphLayout = { key: '', points: null };
function renderGraph(snapshot) {
  const graph = snapshot.graph || { nodes: [], edges: [] };
  const shell = el('div', 'graph-view');
  if (!graph.nodes?.length) { shell.append(empty('No nodes yet', 'This graph grows as AgentBase records your project work.')); $('content').replaceChildren(shell); return; }
  const filtered = visibleGraph(graph, { hiddenKinds: state.hiddenKinds, orphans: state.orphans, localGraph: state.localGraph, localDepth: state.localDepth, focus: state.record });
  const nodes = filtered.nodes.sort((a, b) => (b.id === state.record) - (a.id === state.record) || (b.kind === 'project') - (a.kind === 'project') || (b.degree || 0) - (a.degree || 0)).slice(0, 80);
  if (!nodes.length) { shell.append(empty(state.localGraph && !state.record ? 'Select a node' : 'No visible nodes', state.localGraph && !state.record ? 'Select a graph node, then enable Local graph to focus its connections.' : 'Choose node types in Graph settings.')); $('content').replaceChildren(shell); return; }
  const ids = new Set(nodes.map(node => node.id));
  const edges = filtered.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const layoutKey = JSON.stringify([nodes.map(node => [node.id, node.degree]), edges.map(edge => [edge.source, edge.target, edge.relation]), state.centerForce, state.repelForce, state.linkForce, state.linkDistance]);
  if (cachedGraphLayout.key !== layoutKey) cachedGraphLayout = { key: layoutKey, points: graphPositions(nodes, edges) };
  const points = cachedGraphLayout.points;
  const svg = svgEl('svg', { viewBox: '0 0 1100 720', role: 'img', 'aria-label': `Knowledge graph: ${nodes.length} nodes and ${edges.length} links` });
  const owners = new Map();
  for (const node of nodes.filter(node => node.kind === 'project')) owners.set(node.id, node.id);
  for (const edge of edges.filter(edge => edge.relation === 'contains')) {
    if (owners.has(edge.source)) owners.set(edge.target, owners.get(edge.source));
    if (owners.has(edge.target)) owners.set(edge.source, owners.get(edge.target));
  }
  const palette = new Map(nodes.filter(node => node.kind === 'project').map((node, index) => [node.id, projectColors[index % projectColors.length]]));
  const viewport = svgEl('g');
  const transform = () => viewport.setAttribute('transform', `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
  transform();
  const neighbors = new Set([state.record]);
  for (const edge of edges) {
    if (edge.source === state.record) neighbors.add(edge.target);
    if (edge.target === state.record) neighbors.add(edge.source);
  }
  for (const edge of edges) {
    const a = points.get(edge.source), b = points.get(edge.target);
    const line = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `graph-edge${state.record && (edge.source === state.record || edge.target === state.record) ? ' active' : ''}${state.record && !neighbors.has(edge.source) && !neighbors.has(edge.target) ? ' dimmed' : ''}` });
    line.style.strokeWidth = `${state.linkWidth * (state.record && (edge.source === state.record || edge.target === state.record) ? 1.2 : .7)}px`;
    viewport.append(line);
    if (state.arrows) {
      const angle = Math.atan2(b.y - a.y, b.x - a.x), tipX = b.x - Math.cos(angle) * 12, tipY = b.y - Math.sin(angle) * 12;
      viewport.append(svgEl('polyline', { points: `${tipX - Math.cos(angle - .45) * 5},${tipY - Math.sin(angle - .45) * 5} ${tipX},${tipY} ${tipX - Math.cos(angle + .45) * 5},${tipY - Math.sin(angle + .45) * 5}`, class: 'graph-arrow' }));
    }
  }
  for (const node of nodes) {
    const point = points.get(node.id), group = svgEl('g', { class: 'graph-hit', tabindex: '0' });
    if (state.record && !neighbors.has(node.id)) group.classList.add('dimmed');
    const circle = svgEl('circle', { cx: point.x, cy: point.y, r: Math.min(13, 3 + Math.sqrt(Math.max(0, node.degree || 0)) * 1.1) * state.nodeSize, class: `graph-node${node.id === state.record ? ' selected' : ''}` });
    circle.style.setProperty('--node-color', state.colorMode === 'type' ? graphColors[node.kind] || '#aaa' : state.colorMode === 'project' ? palette.get(owners.get(node.id)) || '#aaa' : '#aaa');
    group.append(circle);
    if (state.labels) graphLabel(group, node, point);
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

async function showSkillInstructions(section, skill) {
  const content = el('pre', 'skill-instructions', 'Loading…');
  section.append(content, el('code', 'skill-source', skill.body?.source || 'No source'));
  let result;
  try { result = await window.agentbase.skillInstructions({ project: skill.project_id, skill: skill.id }); }
  catch (error) { result = { ok: false, error: error.message }; }
  if (!section.isConnected) return;
  content.textContent = result.ok ? result.instructions || 'No instructions in this file.' : result.error || 'Instructions unavailable.';
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
    if (record.body?.status === 'disabled') card.append(el('small', 'skill-disabled', 'Disabled'));
    card.addEventListener('click', () => { state.skill = record.id; renderSkills(snapshot); }); list.append(card);
  }
  if (!skills.length) list.append(el('p', 'board-empty', 'No skills'));
  const selected = skills.find(record => record.id === state.skill);
  if (state.skillEditing) renderSkillEditor(detail, all.find(record => record.id === state.editingSkill));
  else if (selected) {
    const heading = el('div', 'skill-detail-heading'); heading.append(el('h1', '', titleOf(selected)));
    const edit = el('button', '', 'Edit'); edit.addEventListener('click', () => { state.editingSkill = selected.id; state.skillEditing = true; renderSkills(snapshot); }); heading.append(edit);
    detail.append(heading, el('p', '', selected.body?.description || ''));
    if (selected.body?.status === 'disabled') detail.append(el('p', 'skill-disabled', 'Disabled'));
    if (selected.body?.triggers?.length) { detail.append(el('h2', '', 'Use when')); for (const trigger of selected.body.triggers) detail.append(el('div', 'trigger', trigger)); }
    if (selected.body?.source) {
      const section = el('details'); section.append(el('summary', '', 'Instructions'));
      section.addEventListener('toggle', () => { if (section.open && !section.querySelector('.skill-instructions')) showSkillInstructions(section, selected); });
      detail.append(section);
    }
    const section = el('details'); section.append(el('summary', '', 'Details'), el('p', '', `Category: ${selected.body?.category || 'General'}`));
    if (selected.body?.tags?.length) section.append(el('p', '', `Tags: ${selected.body.tags.join(', ')}`));
    if (selected.body?.applies_to?.length) section.append(el('p', '', `Applies to: ${selected.body.applies_to.join(', ')}`));
    detail.append(section);
  } else detail.append(empty('Select a skill', 'Browse the project catalog.'));
  view.append(list, detail); $('content').replaceChildren(view);
}

function renderSkillEditor(target, selected) {
  const template = selected ? null : state.newTemplate;
  const form = el('form', 'skill-editor');
  form.append(el('h1', '', selected ? 'Edit skill' : 'New skill'));
  const field = (label, tag = 'input', value = '') => {
    const wrap = el('label', 'editor-field'); wrap.append(el('span', '', label));
    const input = el(tag); input.name = label.toLowerCase().replaceAll(' ', '_'); input.required = ['Title', 'Description', 'Instructions'].includes(label);
    input.value = value;
    wrap.append(input); form.append(wrap); return input;
  };
  field('Title', 'input', selected?.body?.title || (template?.id === 'blank' ? '' : template?.title) || ''); field('Description', 'textarea', selected?.body?.description || (template?.id === 'blank' ? '' : template?.description) || '');
  const category = el('select'); category.name = 'category';
  for (const name of ['General', 'Coding', 'Research', 'Data', 'Planning', 'Writing']) category.append(el('option', '', name));
  category.value = selected?.body?.category || template?.category || 'General';
  const categoryWrap = el('label', 'editor-field'); categoryWrap.append(el('span', '', 'Category'), category); form.append(categoryWrap);
  const status = el('select'); status.name = 'status';
  for (const name of ['active', 'disabled']) { const option = el('option', '', name === 'active' ? 'Active' : 'Disabled'); option.value = name; status.append(option); }
  status.value = selected?.body?.status || 'active';
  const statusWrap = el('label', 'editor-field'); statusWrap.append(el('span', '', 'Status'), status); form.append(statusWrap);
  field('Use when', 'textarea', (selected?.body?.triggers || template?.triggers || []).join('\n'));
  field('Tags', 'textarea', (selected?.body?.tags || template?.tags || []).join('\n'));
  field('Applies to', 'textarea', (selected?.body?.applies_to || template?.appliesTo || []).join('\n'));
  if (selected) { const source = field('Source reference', 'input', selected.body?.source || ''); source.required = true; }
  else field('Instructions', 'textarea', template?.instructions || '');
  const message = el('p', 'editor-message');
  const actions = el('div', 'editor-actions');
  const cancel = el('button', '', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => { state.skillEditing = false; state.newTemplate = null; renderSkills(state.snapshot); });
  const save = el('button', 'save-button', selected ? 'Save skill' : 'Create skill'); save.type = 'submit'; actions.append(cancel, save); form.append(message, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; message.textContent = 'Saving…';
    const values = new FormData(form);
    const result = await window.agentbase.saveSkill({ project_id: state.project, id: selected?.id, expected_version: selected?.version, title: values.get('title'), description: values.get('description'), category: values.get('category'), status: values.get('status'), triggers: values.get('use_when'), tags: values.get('tags'), applies_to: values.get('applies_to'), source: values.get('source_reference'), instructions: values.get('instructions') });
    if (result.ok) { state.skillEditing = false; state.editingSkill = ''; state.newTemplate = null; state.skill = result.id; await refresh(); }
    else { message.textContent = result.error || 'Could not save skill.'; save.disabled = false; }
  });
  target.append(form);
}

function renderTemplatePicker() {
  const overlay = $('template-picker'); overlay.hidden = false;
  const dialog = el('div', 'template-dialog');
  const top = el('div', 'template-header'); top.append(el('h2', '', 'New skill'));
  const close = el('button', '', 'Cancel'); close.addEventListener('click', () => { overlay.hidden = true; }); top.append(close);
  const layout = el('div', 'template-layout'), categories = el('div', 'template-categories'), choices = el('div', 'template-choices');
  for (const name of [...new Set(state.skillTemplates.map(item => item.category))]) {
    const button = el('button', name === state.templateCategory ? 'selected' : '', name);
    button.addEventListener('click', () => { state.templateCategory = name; renderTemplatePicker(); }); categories.append(button);
  }
  for (const template of state.skillTemplates.filter(item => item.category === state.templateCategory)) {
    const button = el('button', 'template-choice');
    button.append(el('strong', '', template.title), el('span', '', template.summary));
    button.addEventListener('click', () => { overlay.hidden = true; state.newTemplate = template; state.editingSkill = ''; state.skillEditing = true; renderSkills(state.snapshot); }); choices.append(button);
  }
  if (!choices.childNodes.length) choices.append(el('p', '', 'Templates are unavailable. Rebuild the desktop app.'));
  layout.append(categories, choices); dialog.append(top, layout, el('p', 'template-note', 'Creates a SKILL.md in this project.')); overlay.replaceChildren(dialog);
}

let analysisSelection = null;
function renderAnalysisWorkspace(target, record) {
  const data = analysisData(record);
  const schema = JSON.stringify(data.columns.map(column => [column.name, column.type]));
  if (analysisSelection?.id !== record.id || analysisSelection.schema !== schema) analysisSelection = { id: record.id, schema, mode: 'Chart', ...analysisDefaultAxes(data) };
  const selection = analysisSelection;
  target.replaceChildren();
  const modes = el('div', 'analysis-segmented');
  for (const mode of ['Chart', 'Table']) {
    const button = el('button', selection.mode === mode ? 'active' : '', mode);
    button.addEventListener('click', () => { selection.mode = mode; renderAnalysisWorkspace(target, record); }); modes.append(button);
  }
  target.append(modes);
  const points = analysisPoints(data, selection.x, selection.y);
  if (selection.mode === 'Table') {
    const scroll = el('div', 'analysis-table-scroll'), table = el('table', 'result-preview');
    const head = el('tr'); data.columns.forEach(column => head.append(el('th', '', column.name))); table.append(head);
    for (const row of data.rows) {
      const line = el('tr'); data.columns.forEach(column => {
        const value = Array.isArray(row) ? row[column.id] : undefined;
        line.append(el('td', '', value == null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : value));
      }); table.append(line);
    }
    scroll.append(table); target.append(scroll);
    if (!data.rows.length) target.append(el('p', 'analysis-note', 'No saved rows.'));
  } else if (!data.columns.some(column => column.numeric)) {
    target.append(empty('No numeric columns', 'Use Table to inspect these saved results.'));
  } else {
    const axes = el('div', 'analysis-axes');
    const axis = (label, values, selected, update) => {
      const wrap = el('label'); wrap.append(el('span', '', label));
      const select = el('select'); values.forEach(value => { const option = el('option', '', value.name); option.value = value.id; select.append(option); });
      select.value = String(selected); select.addEventListener('change', () => { update(Number(select.value)); renderAnalysisWorkspace(target, record); });
      wrap.append(select); axes.append(wrap);
    };
    axis('X', [{ id: -1, name: 'Row' }, ...data.columns], selection.x, value => { selection.x = value; if (data.columns[value]?.temporal && selection.style === 'Bar') selection.style = 'Line'; });
    axis('Y', data.columns.filter(column => column.numeric), selection.y, value => { selection.y = value; });
    target.append(axes);
    const styles = el('div', 'analysis-segmented');
    for (const style of ['Bar', 'Line', 'Scatter']) {
      const button = el('button', selection.style === style ? 'active' : '', style);
      button.addEventListener('click', () => { selection.style = style; renderAnalysisWorkspace(target, record); }); styles.append(button);
    }
    target.append(styles);
    const xColumn = data.columns[selection.x], continuous = selection.x < 0 || xColumn?.numeric || xColumn?.temporal;
    if (!points.length) target.append(el('p', 'analysis-note', 'No plottable rows for these columns.'));
    else if (selection.style === 'Bar' && new Set(points.map(point => point.label)).size !== points.length) target.append(el('p', 'analysis-note', 'Repeated X values. Choose a distinct column, use Scatter, or group the result in SQL before drawing bars.'));
    else if (selection.style !== 'Bar' && !continuous) target.append(el('p', 'analysis-note', 'Choose a numeric or date X column for Line or Scatter.'));
    else {
      const width = 520, height = state.detailExpanded ? 430 : 260, left = 49, right = 12, top = 14, bottom = 45;
      const plotWidth = width - left - right, plotHeight = height - top - bottom;
      const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
      const values = points.map(point => point.y), minY = Math.min(selection.style === 'Bar' ? 0 : Infinity, ...values), maxY = Math.max(selection.style === 'Bar' ? 0 : -Infinity, ...values);
      const yLow = minY === maxY ? minY - 1 : minY, yHigh = minY === maxY ? maxY + 1 : maxY;
      const yPos = value => top + plotHeight * (1 - (value - yLow) / (yHigh - yLow));
      const xPos = (point, index) => selection.style === 'Bar' ? left + plotWidth * (index + .5) / points.length : left + plotWidth * (point.x - minX) / (maxX - minX || 1);
      const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${selection.style} chart of ${data.columns[selection.y]?.name || 'Value'} by ${xColumn?.name || 'Row'}, ${points.length} saved rows` });
      for (let i = 0; i <= 4; i++) {
        const value = yLow + (yHigh - yLow) * i / 4, y = yPos(value);
        svg.append(svgEl('line', { x1: left, y1: y, x2: width - right, y2: y, class: 'analysis-grid' }));
        const label = svgEl('text', { x: left - 7, y: y + 4, 'text-anchor': 'end', class: 'analysis-axis-label' }); label.textContent = Number(value.toPrecision(3)).toString(); svg.append(label);
      }
      const ordered = selection.style === 'Bar' ? points : [...points].sort((a, b) => a.x - b.x);
      if (selection.style === 'Line') svg.append(svgEl('polyline', { points: ordered.map((point, index) => `${xPos(point, index)},${yPos(point.y)}`).join(' '), class: 'analysis-line' }));
      ordered.forEach((point, index) => {
        const x = xPos(point, index), y = yPos(point.y);
        const mark = selection.style === 'Bar' ? svgEl('rect', { x: x - Math.max(1, Math.min(15, plotWidth / points.length * .35)), y: Math.min(y, yPos(0)), width: Math.max(2, Math.min(30, plotWidth / points.length * .7)), height: Math.max(1, Math.abs(y - yPos(0))), class: 'analysis-mark' }) : svgEl('circle', { cx: x, cy: y, r: 3, class: 'analysis-mark' });
        const title = svgEl('title'); title.textContent = `${xColumn?.name || 'Row'}: ${point.label} · ${data.columns[selection.y]?.name || 'Value'}: ${point.valueText}`; mark.append(title); svg.append(mark);
      });
      for (const [x, label] of [[left, ordered[0]?.label], [width - right, ordered.at(-1)?.label]]) {
        const text = svgEl('text', { x, y: height - 21, 'text-anchor': x === left ? 'start' : 'end', class: 'analysis-axis-label' }); text.textContent = short(label, 18); svg.append(text);
      }
      target.append(svg);
    }
    if (points.length < data.rows.length) target.append(el('p', 'analysis-note', `${data.rows.length - points.length} rows have missing or unsupported axis values and are not plotted.`));
  }
  target.append(el('p', data.truncated || data.omitted ? 'analysis-note warning' : 'analysis-note', `${data.rows.length} saved rows loaded${data.omitted ? ` · ${data.omitted} more saved rows outside this view` : ''}${data.truncated ? ' · Query result was truncated when saved' : ''}`));
}

async function loadAIStatus() {
  try {
    const result = await window.agentbase.aiStatus();
    if (result.ok) Object.assign(aiState, { provider: result.provider, endpoint: result.endpoint, model: result.model, hasKey: result.hasKey, loaded: true });
    else aiState.message = result.error || 'AI settings unavailable.';
  } catch (error) { aiState.message = error.message; }
  if (state.panel === 'connections' && state.snapshot) renderPanel(state.snapshot);
}

function renderAIDialog() {
  const overlay = $('ai-dialog'); overlay.hidden = false;
  const selectedTask = state.snapshot?.records?.find(record => record.id === state.record && record.kind === 'task');
  const dialog = el('div', 'ai-dialog-content');
  const head = el('div', 'ai-dialog-head'); head.append(el('h2', '', 'Your AI'));
  const close = el('button', '', '×'); close.setAttribute('aria-label', 'Close AI setup'); close.addEventListener('click', () => { overlay.hidden = true; }); head.append(close); dialog.append(head);
  const field = (label, key, tag = 'input', attrs = {}) => {
    const wrap = el('label', `ai-field${key === 'submission' ? ' ai-submission' : ''}`); wrap.append(el('span', '', label));
    const input = el(tag); input.value = aiState[key];
    if (attrs.type) input.type = attrs.type;
    if (attrs.maxLength) input.maxLength = attrs.maxLength;
    input.disabled = aiState.busy || attrs.disabled;
    input.addEventListener('input', () => { aiState[key] = input.value; });
    wrap.append(input); dialog.append(wrap); return input;
  };
  const provider = el('label', 'ai-field'); provider.append(el('span', '', 'Provider'));
  const providerSelect = el('select');
  for (const name of ['OpenAI-compatible', 'Jev']) { const option = el('option', '', name === 'Jev' ? 'Jev · TypeSafe' : name); option.value = name; providerSelect.append(option); }
  providerSelect.value = aiState.provider; providerSelect.disabled = aiState.busy;
  providerSelect.addEventListener('change', () => { aiState.provider = providerSelect.value; aiState.endpoint = defaultEndpoint(aiState.provider); aiState.model = aiState.provider === 'Jev' ? 'jev-latest' : ''; aiState.hasKey = false; aiState.result = ''; renderAIDialog(); });
  provider.append(providerSelect); dialog.append(provider);
  field(aiState.provider === 'Jev' ? 'System One API URL' : 'Chat completions URL', 'endpoint', 'input', { disabled: aiState.provider === 'Jev' });
  field('Model', 'model', 'input', { maxLength: 150 });
  field('API key (saved securely on this computer)', 'apiKey', 'input', { type: 'password', maxLength: 8000 });
  const actions = el('div', 'ai-actions');
  const save = el('button', '', 'Save setup'); save.disabled = aiState.busy;
  save.addEventListener('click', async () => {
    aiState.busy = true; aiState.message = 'Saving…'; renderAIDialog();
    try {
      const result = await window.agentbase.aiSave({ provider: aiState.provider, endpoint: aiState.endpoint, model: aiState.model, apiKey: aiState.apiKey });
      aiState.message = result.ok ? 'Setup saved.' : result.error || 'Could not save setup.';
      if (result.ok) { aiState.hasKey = result.hasKey; aiState.apiKey = ''; }
    } catch (error) { aiState.message = error.message; }
    finally { aiState.busy = false; renderAIDialog(); if (state.panel === 'connections') renderPanel(state.snapshot); }
  }); actions.append(save);
  const forget = el('button', '', 'Forget setup'); forget.disabled = aiState.busy || !aiState.hasKey;
  forget.addEventListener('click', async () => { aiState.busy = true; renderAIDialog(); try { const result = await window.agentbase.aiForget(); if (result.ok) Object.assign(aiState, { provider: result.provider, endpoint: result.endpoint, model: '', apiKey: '', hasKey: false, result: '' }); aiState.message = result.ok ? 'Setup removed.' : result.error; } catch (error) { aiState.message = error.message; } finally { aiState.busy = false; renderAIDialog(); } }); actions.append(forget);
  dialog.append(actions);
  const section = el('div', 'ai-separator'); dialog.append(section);
  if (selectedTask) {
    const row = el('div', 'ai-task-row'); row.append(el('span', '', `Task · ${titleOf(selectedTask)}`));
    const load = el('button', '', 'Load task context'); load.disabled = aiState.busy;
    load.addEventListener('click', () => { Object.assign(aiState, taskJudgeContext(selectedTask, taskGroup(selectedTask) === 'Needs attention'), { result: '', message: '' }); renderAIDialog(); }); row.append(load); dialog.append(row);
  }
  const profile = el('label', 'ai-field'); profile.append(el('span', '', 'Review profile'));
  const profileSelect = el('select');
  for (const name of ['General', 'Needs attention']) { const option = el('option', '', name); option.value = name; profileSelect.append(option); }
  profileSelect.value = aiState.profile; profileSelect.disabled = aiState.busy;
  profileSelect.addEventListener('change', () => { aiState.profile = profileSelect.value; aiState.criteria = aiState.profile === 'Needs attention' ? attentionCriteria : generalCriteria; aiState.result = ''; renderAIDialog(); });
  profile.append(profileSelect); dialog.append(profile);
  field('Criteria', 'criteria', 'textarea', { maxLength: 2000 });
  field('Reference context · optional', 'reference', 'textarea', { maxLength: 15000 });
  field('Submission', 'submission', 'textarea', { maxLength: 30000 });
  dialog.append(el('p', 'ai-note', `Judge sends these fields to ${aiState.model || 'your model'}. The result is an AI assessment, not an AgentBase-verified score.`));
  if (aiState.result) dialog.append(el('pre', 'ai-result', aiState.result));
  if (aiState.message) dialog.append(el('p', 'ai-message', aiState.message));
  const judgeRow = el('div', 'ai-actions');
  if (selectedTask && aiState.result) {
    const store = el('button', '', 'Save to task'); store.disabled = aiState.busy;
    store.addEventListener('click', async () => { aiState.busy = true; aiState.message = 'Saving to task knowledge…'; renderAIDialog(); try { const result = await window.agentbase.aiSaveToTask({ project_id: selectedTask.project_id, task_id: selectedTask.id, task_title: titleOf(selectedTask), profile: aiState.profile, criteria: aiState.criteria, reference: aiState.reference, submission: aiState.submission, result: aiState.result }); aiState.message = result.ok ? `Saved to task knowledge · ${result.record?.id || ''}` : result.error || 'Could not save assessment.'; if (result.ok) refresh(); } catch (error) { aiState.message = error.message; } finally { aiState.busy = false; renderAIDialog(); } }); judgeRow.append(store);
  }
  const judge = el('button', 'ai-judge-button', aiState.busy ? 'Judging…' : 'Judge'); judge.disabled = aiState.busy || !aiState.submission.trim();
  judge.addEventListener('click', async () => {
    aiState.busy = true; aiState.message = 'Judging…'; aiState.result = ''; renderAIDialog();
    try {
      const setup = await window.agentbase.aiSave({ provider: aiState.provider, endpoint: aiState.endpoint, model: aiState.model, apiKey: aiState.apiKey });
      if (!setup.ok) { aiState.message = setup.error; return; }
      aiState.hasKey = setup.hasKey; aiState.apiKey = '';
      const result = await window.agentbase.aiJudge({ profile: aiState.profile, criteria: aiState.criteria, reference: aiState.reference, submission: aiState.submission });
      aiState.result = result.ok ? result.result : '';
      aiState.message = result.ok ? '' : result.error || 'Assessment failed.';
    } catch (error) { aiState.message = error.message; }
    finally { aiState.busy = false; renderAIDialog(); }
  }); judgeRow.append(judge); dialog.append(judgeRow);
  overlay.replaceChildren(dialog);
}

function renderPanel(snapshot) {
  const panel = $('detail');
  if (!state.panel) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.classList.toggle('expanded', state.detailExpanded && state.panel === 'record');
  const header = el('div', 'detail-header');
  if (state.panel === 'record') {
    for (const [offset, label, title] of [[-1, '‹', 'Previous record'], [1, '›', 'Next record']]) {
      const button = el('button', '', label); button.title = title; button.disabled = state.historyIndex + offset < 0 || state.historyIndex + offset >= state.recordHistory.length;
      button.addEventListener('click', () => moveRecordHistory(offset)); header.append(button);
    }
  }
  header.append(el('span', 'detail-header-title', state.panel === 'record' ? 'Details' : state.panel === 'history' ? 'Recent changes' : 'Connections'));
  if (state.panel === 'record') {
    const selected = snapshot.records?.find(item => item.id === state.record);
    const switchView = el('button', '', state.view === 'tasks' ? '◎' : '▣'); switchView.title = state.view === 'tasks' ? 'Show in graph' : 'Show on board';
    switchView.addEventListener('click', () => { state.view = state.view === 'tasks' ? 'graph' : 'tasks'; refresh(); });
    if (selected?.kind === 'task') header.append(switchView);
    const expand = el('button', '', state.detailExpanded ? '⤢' : '⤡'); expand.title = state.detailExpanded ? 'Restore details' : 'Expand details';
    expand.addEventListener('click', () => { state.detailExpanded = !state.detailExpanded; renderPanel(snapshot); }); header.append(expand);
  }
  const close = el('button', '', '×'); close.setAttribute('aria-label', 'Close details'); close.addEventListener('click', () => { state.panel = ''; state.record = ''; state.detailExpanded = false; refresh(); }); header.append(close);
  const body = el('div');
  const section = (title, value) => {
    if (value == null || value === '') return;
    const wrap = el('div', 'detail-section'); wrap.append(el('h3', '', title), el('p', '', String(value))); body.append(wrap);
  };
  const list = (title, values) => {
    if (!Array.isArray(values) || !values.length) return;
    const wrap = el('div', 'detail-section'); wrap.append(el('h3', '', title));
    const items = el('ul'); values.forEach(value => items.append(el('li', '', typeof value === 'string' ? value : JSON.stringify(value)))); wrap.append(items); body.append(wrap);
  };
  if (state.panel === 'record') {
    const record = (snapshot.records || []).find(item => item.id === state.record);
    const node = (snapshot.graph?.nodes || []).find(item => item.id === state.record);
    if (record || node) {
      body.append(el('h2', 'detail-title', record ? titleOf(record) : node.title));
      if (record?.body?.status) {
        const line = el('div', 'detail-line'); line.append(badge(record.body.status), el('span', 'detail-meta', `Updated ${new Date(record.updated_at).toLocaleDateString('en-AU')}`)); body.append(line);
      }
      const primary = record?.body?.description || record?.body?.content || node?.summary;
      if (primary) body.append(el('div', 'detail-body', primary));
      if (record?.body?.acceptance?.length) {
        const section = el('div', 'detail-section'); section.append(el('h3', '', 'Acceptance criteria'));
        const list = el('ul'); for (const criterion of record.body.acceptance) list.append(el('li', '', criterion)); section.append(list); body.append(section);
      }
      if (record?.body?.reason) { const section = el('div', 'detail-section'); section.append(el('h3', '', 'Reason'), el('p', '', record.body.reason)); body.append(section); }
      if (record?.kind === 'task') {
        for (const key of ['owner', 'progress']) {
          if (record.body?.[key]) { const section = el('div', 'detail-section'); section.append(el('h3', '', key === 'owner' ? 'Owner' : 'Progress'), el('p', '', record.body[key])); body.append(section); }
        }
        const linkedTask = (id, label) => {
          if (!id) return;
          const item = snapshot.records?.find(value => value.id === id);
          const button = el('button', 'detail-link', `${label}: ${item ? titleOf(item) : id}`);
          button.addEventListener('click', () => selectRecord(id)); body.append(button);
        };
        linkedTask(record.body.plan_id, 'Plan');
        linkedTask(record.body.parent_task_id, 'Parent task');
        const children = (snapshot.records || []).filter(item => item.kind === 'task' && item.body?.parent_task_id === record.id);
        if (children.length) {
          const section = el('div', 'detail-section'); section.append(el('h3', '', 'Subtasks'));
          for (const child of children) { const button = el('button', 'detail-link', titleOf(child)); button.addEventListener('click', () => selectRecord(child.id)); section.append(button, badge(child.body?.status)); }
          body.append(section);
        }
        if (record.dependencies?.length) {
          const section = el('div', 'detail-section'); section.append(el('h3', '', 'Dependencies'));
          for (const dependency of record.dependencies) { const button = el('button', 'detail-link', dependency.title || 'Task'); button.addEventListener('click', () => selectRecord(dependency.id)); section.append(button, badge(dependency.status)); }
          body.append(section);
        }
        if (record.body.completion?.summary) { const section = el('div', 'detail-section'); section.append(el('h3', '', 'Completion · agent reported'), el('p', '', record.body.completion.summary)); body.append(section); }
        const recorded = record.body.sources || [];
        const suggested = (snapshot.focused_record_id === record.id ? snapshot.skill_recommendations || [] : [])
          .filter(skill => !recorded.some(source => source.reference === skill.id))
          .map(skill => ({ kind: 'Suggested skill', title: skill.title, reference: skill.id, note: skill.description, record_id: skill.id }));
        const sources = [...recorded, ...(record.body.completion?.evidence || []), ...suggested];
        if (sources.length) {
          const section = el('details', 'detail-section'); section.append(el('summary', '', `Sources (${sources.length})`));
          for (const source of sources) {
            const item = el('div', 'source-item');
            const linked = source.record_id || (typeof source.reference === 'string' && /^(skill|analysis|memory|decision|task|plan|dataset|checkpoint)_/u.test(source.reference) ? source.reference : '');
            if (linked) { const button = el('button', 'detail-link', source.title || source.kind || 'Source'); button.addEventListener('click', () => selectRecord(linked)); item.append(button); }
            else item.append(el('strong', '', source.title || source.kind || 'Source'));
            item.append(el('span', '', source.note || source.outcome || source.reference || ''));
            if (source.reference) item.append(el('code', '', source.reference));
            section.append(item);
          }
          body.append(section);
        }
      }
      if (record?.kind === 'checkpoint') {
        section('Handoff', record.body?.summary); section('Next action', record.body?.next_action);
        list('Remaining', record.body?.remaining); list('Blockers', record.body?.blockers); list('Completed', record.body?.completed);
      }
      if (record?.kind === 'plan') {
        section('Goal', record.body?.goal);
        for (const [index, milestone] of (record.body?.milestones || []).entries()) section(`${index + 1}. ${milestone.title || 'Milestone'}`, milestone.acceptance);
        list('Constraints', record.body?.constraints); list('Open questions', record.body?.open_questions);
      }
      if (record?.kind === 'memory' || record?.kind === 'decision') {
        section('Source', record.body?.source); section('Evidence', record.body?.epistemic_status);
        section('Scope', record.body?.scope);
        if (record.body?.valid_from || record.body?.valid_until) section('Valid', `${record.body?.valid_from || 'open'} → ${record.body?.valid_until || 'open'}`);
        section('Review', record.body?.review_status || 'unreviewed'); section('Status reason', record.body?.status_reason);
        if (record.body?.task_id) {
          const link = el('button', 'detail-link', `Task: ${record.body.task_id}`);
          link.addEventListener('click', () => selectRecord(record.body.task_id)); body.append(link);
        }
        const comparisons = memoryComparisons(record, snapshot.records || []);
        if (comparisons.length) {
          const wrap = el('div', 'detail-section'); wrap.append(el('h3', '', 'Compare before deciding'));
          for (const match of comparisons) {
            const button = el('button', 'comparison-item');
            button.append(el('strong', '', `${match.label} · ${titleOf(match.entry)}`), el('span', '', short(match.entry.body?.content, 130)));
            button.addEventListener('click', () => selectRecord(match.entry.id)); wrap.append(button);
          }
          body.append(wrap);
        }
        const events = (snapshot.events || []).filter(event => event.record_id === record.id).slice(0, 8);
        if (events.length) list('Recent changes', events.map(event => `${event.action.replaceAll('_', ' ')} · ${event.actor}`));
        renderMemoryActions(body, record);
      }
      if (record?.kind === 'dataset') {
        section('Source', record.body?.source);
        const columns = Array.isArray(record.body?.schema) ? record.body.schema : [];
        const rows = Array.isArray(record.body?.sample) ? record.body.sample : [];
        if (columns.length) {
          const preview = el('div', 'detail-section analysis-workspace'); preview.append(el('h3', '', 'Sample rows'));
          const scroll = el('div', 'analysis-table-scroll'), table = el('table', 'result-preview');
          const head = el('tr'); columns.forEach(column => head.append(el('th', '', column.name || 'Column'))); table.append(head);
          for (const row of rows) {
            const line = el('tr'); columns.forEach((column, index) => {
              const value = Array.isArray(row) ? row[index] : undefined;
              line.append(el('td', '', value == null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : value));
            }); table.append(line);
          }
          scroll.append(table); preview.append(scroll);
          if (!rows.length) preview.append(el('p', 'analysis-note', 'No saved rows.'));
          body.append(preview);
        }
      }
      if (record?.kind === 'analysis') {
        section('SQL', record.body?.sql); section('Interpretation', record.body?.interpretation);
        const workspace = el('div', 'detail-section analysis-workspace'); renderAnalysisWorkspace(workspace, record); body.append(workspace);
      }
      if (record) {
        const edges = (snapshot.graph?.edges || []).filter(edge => (edge.source === record.id || edge.target === record.id) && (record.kind !== 'task' || !['source', 'depends_on', 'child', 'related', 'contains'].includes(edge.relation)));
        if (edges.length) {
          const wrap = el('div', 'detail-section'); wrap.append(el('h3', '', record.kind === 'task' ? 'Other connections' : 'Graph connections'));
          for (const edge of edges.slice(0, 30)) {
            const id = edge.source === record.id ? edge.target : edge.source;
            const related = snapshot.records?.find(item => item.id === id) || snapshot.graph?.nodes?.find(item => item.id === id);
            const button = el('button', 'detail-link', related ? titleOf(related) : id);
            button.addEventListener('click', () => selectRecord(id)); wrap.append(button);
          }
          body.append(wrap);
        }
      }
      if (record) { const section = el('details', 'detail-section'); section.append(el('summary', '', 'Full record'), el('pre', '', JSON.stringify(record.body, null, 2))); body.append(section); }
    } else body.append(el('p', 'detail-body', 'This item is outside the current project.'));
  } else if (state.panel === 'history') {
    const events = (snapshot.events || []).slice(0, 30);
    if (!events.length) body.append(el('p', 'detail-body', 'No recent changes.'));
    for (const event of events) { const section = el('button', 'history-item'); section.append(el('h3', '', event.record_title || event.kind || 'Change'), el('p', '', `${event.action || event.type || 'Updated'} · ${event.actor || ''} · ${event.at ? new Date(event.at).toLocaleString('en-AU') : ''}`)); section.addEventListener('click', () => selectRecord(event.record_id)); body.append(section); }
  } else {
    body.append(el('h2', 'detail-title', 'Connections'), el('p', 'detail-body', 'AgentBase reads the local project store used by your coding agents. Choose the same data folder that your Codex or Claude Code connection uses.'));
    const hosts = state.connectionStatus;
    for (const [key, title] of [['codex', 'Codex'], ['claude', 'Claude Code']]) {
      const host = hosts?.[key];
      const row = el('div', 'connection-host');
      const identity = el('div', 'connection-identity');
      identity.append(el('strong', '', title), el('span', '', !host ? state.connectionLoading ? 'Checking…' : 'Not checked' : !host.ok ? host.error || 'Setup unavailable' : host.installed ? host.enabled ? host.message || 'Connected' : 'Disabled' : host[`${key}_available`] === false ? `${title} CLI not found` : 'Not installed'));
      row.append(identity);
      if (host?.ok && host[`${key}_available`] !== false) {
        const actions = el('div', 'connection-actions');
        const names = key === 'codex' ? host.installed ? [host.enabled ? ['disable', 'Disable'] : ['enable', 'Enable'], ['check', 'Check']] : [['install', 'Install']] : host.installed ? [['check', 'Check'], ['remove', 'Remove']] : [['install', 'Install']];
        for (const [action, label] of names) {
          const button = el('button', '', label);
          button.disabled = state.connectionActionBusy || state.connectionLoading || action === 'install' && host.install_available !== true;
          button.addEventListener('click', () => runConnectionAction(key, action)); actions.append(button);
        }
        row.append(actions);
      }
      body.append(row);
    }
    if (state.connectionMessage) body.append(el('p', 'connection-message', state.connectionMessage));
    if (hosts) {
      const paths = [hosts.codex, hosts.claude].filter(host => host?.ok && host.installed && host.store_path && host.store_path_source !== 'unknown').map(host => host.store_path);
      window.agentbase.storePath().then(path => { if (state.panel === 'connections' && paths.some(value => value !== path)) body.append(el('p', 'connection-warning', 'A connected host uses a different data folder. Check its MCP configuration before relying on shared memory.')); });
    }
    const check = el('button', 'detail-link', state.connectionLoading ? 'Checking…' : 'Refresh connections'); check.disabled = state.connectionLoading || state.connectionActionBusy; check.addEventListener('click', loadConnections); body.append(check);
    window.agentbase.storePath().then(path => { if (state.panel === 'connections') { const label = el('p', 'detail-body', `Data folder: ${path}`); body.append(label); } });
    const choose = el('button', 'task-card', 'Choose data folder…'); choose.addEventListener('click', async () => { await window.agentbase.chooseStore(); state.project = 'agentbase:all'; state.record = ''; state.panel = ''; state.connectionStatus = null; state.connectionRequest++; refresh(); }); body.append(choose);
    const ai = el('div', 'connection-host');
    const label = el('div', 'connection-identity'); label.append(el('strong', '', 'Your AI'), el('span', '', aiState.hasKey && aiState.model ? `Configured · ${aiState.model}` : 'OpenAI-compatible API'));
    const setup = el('button', 'memory-action', 'Setup / Judge'); setup.addEventListener('click', renderAIDialog);
    ai.append(label, setup); body.append(ai);
  }
  panel.replaceChildren(header, body);
}

async function runConnectionAction(host, action) {
  if (state.connectionActionBusy || state.connectionLoading) return;
  state.connectionActionBusy = true; state.connectionMessage = `${action[0].toUpperCase() + action.slice(1)} in progress…`;
  renderPanel(state.snapshot);
  try {
    const result = await window.agentbase.connectionAction({ host, action });
    state.connectionMessage = result.ok ? result.message || 'Connection updated. Start a new agent session if prompted.' : result.error || 'Connection action failed.';
  } catch (error) { state.connectionMessage = error.message; }
  finally { state.connectionActionBusy = false; await loadConnections(); }
}

async function loadConnections() {
  const request = ++state.connectionRequest;
  state.connectionLoading = true; state.connectionStatus = null;
  if (state.panel === 'connections') renderPanel(state.snapshot);
  try {
    const result = await window.agentbase.connectionStatus();
    if (request === state.connectionRequest) state.connectionStatus = result;
  } catch (error) {
    if (request === state.connectionRequest) state.connectionStatus = { codex: { ok: false, error: error.message }, claude: { ok: false, error: error.message } };
  } finally {
    if (request === state.connectionRequest) { state.connectionLoading = false; if (state.panel === 'connections') renderPanel(state.snapshot); }
  }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; state.panel = ''; state.record = ''; state.detailExpanded = false; state.skillEditing = false; state.editingSkill = ''; state.search = ''; $('search').value = ''; refresh(); }));
$('project').addEventListener('change', event => { state.project = event.target.value; state.record = ''; state.recordHistory = []; state.historyIndex = -1; state.detailExpanded = false; state.skill = ''; state.skillEditing = false; state.skillCategory = 'All'; state.panel = ''; state.zoom = 1; state.panX = 0; state.panY = 0; refresh(); });
$('status').addEventListener('change', event => { state.statusFilter = event.target.value; render(); });
$('search').addEventListener('input', event => { state.search = event.target.value; clearTimeout(window.searchTimer); window.searchTimer = setTimeout(refresh, 250); });
$('search').addEventListener('keydown', event => {
  if (event.key === 'Enter' && state.view === 'graph' && state.snapshot?.graph_search?.nodes?.length) {
    event.preventDefault(); state.search = ''; $('search').value = ''; $('search-results').hidden = true; selectRecord(state.snapshot.graph_search.nodes[0].id);
  }
});
$('refresh').addEventListener('click', refresh);
$('history').addEventListener('click', () => { state.panel = 'history'; renderPanel(state.snapshot); });
$('connections').addEventListener('click', () => { state.panel = 'connections'; state.connectionMessage = ''; renderPanel(state.snapshot); loadConnections(); if (!aiState.loaded) loadAIStatus(); });
$('fit').addEventListener('click', () => { state.zoom = 1; state.panX = 0; state.panY = 0; render(); });
$('load-more').addEventListener('click', () => { state.taskLimit = Math.min(1000, state.taskLimit + 200); refresh(); });
$('graph-settings').addEventListener('click', () => { $('settings-panel').hidden = !$('settings-panel').hidden; renderGraphSettings(state.snapshot); });
$('new-skill').addEventListener('click', () => { if (state.project === 'agentbase:all') return; renderTemplatePicker(); });
$('more').addEventListener('click', () => {
  const menu = $('menu'); menu.hidden = !menu.hidden;
  if (menu.hidden) return;
  const choose = el('button', '', 'Choose data folder…'); choose.addEventListener('click', async () => { menu.hidden = true; await window.agentbase.chooseStore(); state.project = 'agentbase:all'; state.record = ''; state.panel = ''; refresh(); });
  const reload = el('button', '', 'Refresh'); reload.addEventListener('click', () => { menu.hidden = true; refresh(); });
  const pause = el('button', '', state.paused ? 'Resume updates' : 'Pause updates');
  pause.addEventListener('click', () => { menu.hidden = true; state.paused = !state.paused; if (!state.paused) refresh(); else render(); });
  menu.replaceChildren(pause, reload, choose);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('template-picker').hidden) $('template-picker').hidden = true;
    else if (!$('ai-dialog').hidden) $('ai-dialog').hidden = true;
    else if (!$('menu').hidden) $('menu').hidden = true;
    else if (!$('settings-panel').hidden) $('settings-panel').hidden = true;
    else if (!$('search-results').hidden) $('search-results').hidden = true;
    else if (state.panel) { state.panel = ''; state.record = ''; state.detailExpanded = false; refresh(); }
  }
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    event.preventDefault(); $('search').focus();
  }
});
document.addEventListener('pointerdown', event => {
  if (event.target === $('template-picker')) $('template-picker').hidden = true;
  if (event.target === $('ai-dialog')) $('ai-dialog').hidden = true;
  if (state.panel && !event.target.closest('#detail,.task-card,.graph-hit,#history,#connections')) {
    state.panel = ''; state.record = ''; state.detailExpanded = false; renderPanel(state.snapshot);
  }
  if (!$('menu').hidden && !event.target.closest('#menu,#more')) $('menu').hidden = true;
  if (!$('settings-panel').hidden && !event.target.closest('#settings-panel,#graph-settings')) $('settings-panel').hidden = true;
  if (!$('search-results').hidden && !event.target.closest('#search-results,#search')) $('search-results').hidden = true;
});
window.agentbase.skillTemplates().then(templates => { state.skillTemplates = Array.isArray(templates) ? templates : []; }).catch(() => { state.skillTemplates = []; });
refresh();
setInterval(() => { if (!document.hidden && !state.paused && !state.skillEditing && !state.memoryBusy && !(state.panel === 'record' && state.memoryDraft?.id === state.record)) refresh(); }, 8000);
