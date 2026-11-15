export function taskGroup(record) {
  const status = record.body?.status;
  if (['done', 'cancelled'].includes(status)) return 'Done';
  const waiting = record.dependencies?.some(task => task.status !== 'done');
  const expired = record.body?.owner && record.lease_active === false && ['in_progress', 'review'].includes(status);
  if (status === 'blocked' || status === 'review' || waiting || expired) return 'Needs attention';
  if (status === 'in_progress') return 'Active';
  return 'Queue';
}

export function taskSummary(record) {
  return record.body?.status === 'done' && record.body?.completion?.summary
    || record.body?.progress || record.body?.description || '';
}

export function visibleGraph(graph, { hiddenKinds = new Set(), orphans = true, localGraph = false, localDepth = 1, focus = '' } = {}) {
  const typed = (graph.nodes || []).filter(node => !hiddenKinds.has(node.kind));
  const ids = new Set(typed.map(node => node.id));
  const typedEdges = (graph.edges || []).filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const connected = new Set(typedEdges.flatMap(edge => [edge.source, edge.target]));
  let nodes = orphans ? typed : typed.filter(node => connected.has(node.id));
  if (localGraph) {
    const adjacency = new Map(nodes.map(node => [node.id, []]));
    for (const edge of typedEdges) {
      adjacency.get(edge.source)?.push(edge.target);
      adjacency.get(edge.target)?.push(edge.source);
    }
    const reached = new Set(adjacency.has(focus) ? [focus] : []);
    let frontier = [...reached];
    for (let depth = 0; depth < localDepth; depth++) {
      frontier = frontier.flatMap(id => adjacency.get(id) || []).filter(id => !reached.has(id));
      frontier.forEach(id => reached.add(id));
    }
    nodes = nodes.filter(node => reached.has(node.id));
  }
  const visibleIDs = new Set(nodes.map(node => node.id));
  return { nodes, edges: typedEdges.filter(edge => visibleIDs.has(edge.source) && visibleIDs.has(edge.target)) };
}

export function memoryComparisons(entry, records) {
  const normalize = value => String(value || '').toLocaleLowerCase().trim().replace(/\s+/gu, ' ');
  const title = normalize(entry.body?.title), content = normalize(entry.body?.content);
  return records.filter(other => other.id !== entry.id && ['memory', 'decision'].includes(other.kind) && other.body?.status !== 'forgotten')
    .map(other => {
      if (content && normalize(other.body?.content) === content) return { entry: other, label: 'Same content' };
      if (title && normalize(other.body?.title) === title && normalize(other.body?.content) !== content) return { entry: other, label: 'Same title, different content' };
      return null;
    }).filter(Boolean).slice(0, 8);
}
