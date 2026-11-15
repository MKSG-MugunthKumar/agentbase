import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisData, analysisDefaultAxes, analysisPoints } from '../desktop/analysis-view.mjs';

test('shared analysis chart follows native axes and excludes unsupported values', () => {
  const data = analysisData({ body: {
    columns: [{ name: 'month', type: 'DATE' }, { name: 'value', type: 'DECIMAL(18,2)' }],
    rows: [['2026-01-01', '12.50'], ['2026-02-01', -2], ['2026-03-01', null], ['invalid-date', 3]],
    inspector_rows_omitted: 5, truncated: true,
  } });
  assert.deepEqual(analysisDefaultAxes(data), { x: 0, y: 1, style: 'Line' });
  assert.equal(analysisPoints(data, 0, 1).length, 2);
  assert.equal(analysisPoints(data, -1, 1).length, 3);
  assert.equal(data.omitted, 5);
  assert.equal(data.truncated, true);
});

test('shared analysis chart excludes booleans, unsafe integers and nonnumeric rows', () => {
  const data = analysisData({ body: {
    columns: [{ name: 'label', type: 'VARCHAR' }, { name: 'count', type: 'BIGINT' }],
    rows: [['one', 1], ['boolean', true], ['unsafe', '9007199254740992'], ['text', 'unknown']],
  } });
  assert.deepEqual(analysisDefaultAxes(data), { x: 0, y: 1, style: 'Bar' });
  assert.deepEqual(analysisPoints(data, 0, 1).map(point => point.label), ['one']);
});
