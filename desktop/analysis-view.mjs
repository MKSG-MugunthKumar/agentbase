const numericType = /^(?:U?(?:TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT)|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL)/u;

export function analysisData(record) {
  const body = record?.body || {};
  const columns = (Array.isArray(body.columns) ? body.columns : []).map((column, id) => {
    const type = String(column?.type || '').toUpperCase();
    return { id, name: String(column?.name || 'Column'), type, numeric: numericType.test(type), temporal: type.startsWith('DATE') || type.startsWith('TIMESTAMP') };
  });
  return { columns, rows: Array.isArray(body.rows) ? body.rows : [], omitted: Math.max(0, Number(body.inspector_rows_omitted) || 0), truncated: body.truncated === true };
}

function number(value, type) {
  if (typeof value === 'boolean' || value == null || (typeof value !== 'number' && typeof value !== 'string')) return null;
  const result = Number(value);
  if (!String(value).trim() || !Number.isFinite(result) || Math.abs(result) > 1e100) return null;
  if (type.includes('INT') && Math.abs(result) > Number.MAX_SAFE_INTEGER) return null;
  return result;
}

function date(value) {
  if (typeof value !== 'string') return null;
  let valueText = value;
  if (valueText.length === 10) valueText += 'T00:00:00Z';
  else { valueText = valueText.replace(' ', 'T'); if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(valueText)) valueText += 'Z'; }
  const parsed = Date.parse(valueText);
  return Number.isFinite(parsed) ? parsed : null;
}

export function analysisDefaultAxes(data) {
  const y = data.columns.find(column => column.numeric)?.id ?? -1;
  const x = data.columns.find(column => column.id !== y && column.temporal)?.id
    ?? data.columns.find(column => column.id !== y && !column.numeric)?.id
    ?? data.columns.find(column => column.id !== y)?.id ?? -1;
  return { x, y, style: data.columns[x]?.temporal ? 'Line' : 'Bar' };
}

export function analysisPoints(data, x, y) {
  const yColumn = data.columns[y];
  if (!yColumn) return [];
  return data.rows.flatMap((row, id) => {
    if (!Array.isArray(row) || y >= row.length) return [];
    const value = number(row[y], yColumn.type);
    if (value === null) return [];
    if (x < 0) return [{ id, label: String(id + 1), x: id + 1, y: value, valueText: String(row[y]) }];
    const xColumn = data.columns[x];
    if (!xColumn || x >= row.length || row[x] == null) return [];
    const horizontal = xColumn.temporal ? date(row[x]) : xColumn.numeric ? number(row[x], xColumn.type) : id + 1;
    if (horizontal === null) return [];
    return [{ id, label: String(row[x]), x: horizontal, y: value, valueText: String(row[y]) }];
  });
}
