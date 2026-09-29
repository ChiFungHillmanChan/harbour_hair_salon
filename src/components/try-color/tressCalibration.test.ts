import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaE2000, parseTressCalibrations } from './tressCalibration';

// Synthetic validation fixture, never a shipped shade or measured salon result.
function record() {
  return {
    schemaVersion: 1,
    id: 'test-tress-1',
    shade: { brand: 'Test brand', line: 'Test line', code: 'TEST', chartVersion: 'test-v1', market: 'GB' },
    levelScale: { id: 'test-scale', label: 'Test scale', min: 1, max: 15 },
    base: { history: 'natural', level: 5, undertone: 'orange', greyPercent: 0, porosity: 'normal', historyNotes: 'Untreated test substrate' },
    process: { method: 'permanent', productNotes: 'Recorded test product', developerNotes: 'Recorded test developer', processingMinutes: 30 },
    measurement: { illuminant: 'D65', observer: '2-degree', geometry: 'd/8', specular: 'included', instrument: 'Test instrument', replicateCount: 3 },
    beforeLab: { l: 30, a: 4, b: 8 },
    afterLab: { l: 40, a: 5, b: 12 },
    evidence: { measuredAt: '2026-09-29', operator: 'test-operator', sourceRecord: 'test-record-1' },
  };
}

test('calibration preserves a manufacturer scale above the generic preview maximum', () => {
  const sample = record();
  sample.base.level = 13;
  const [parsed] = parseTressCalibrations([sample]);
  assert.equal(parsed.base.level, 13);
  assert.equal(parsed.levelScale.id, 'test-scale');
});

test('calibration rejects a shade without product identity or measurement conditions', () => {
  assert.throws(() => parseTressCalibrations([{ swatchHex: '#123456' }]));
  const sample = record();
  sample.measurement.instrument = '';
  assert.throws(() => parseTressCalibrations([sample]));
});

test('calibration rejects an out-of-scale base, invalid Lab, and duplicate records', () => {
  const sample = record();
  sample.base.level = 16;
  assert.throws(() => parseTressCalibrations([sample]));
  sample.base.level = 5;
  sample.afterLab.l = 101;
  assert.throws(() => parseTressCalibrations([sample]));
  assert.throws(() => parseTressCalibrations([record(), record()]));
  assert.throws(() => parseTressCalibrations([]));
});

test('calibration rejects non-finite colour values and inadequate replicates', () => {
  const sample = record();
  sample.beforeLab.a = Number.NaN;
  assert.throws(() => parseTressCalibrations([sample]));
  sample.beforeLab.a = 4;
  sample.measurement.replicateCount = 1;
  assert.throws(() => parseTressCalibrations([sample]));
});

// Sharma, Wu & Dalal supplementary CIEDE2000 pairs (not hair measurements).
// https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/
test('CIEDE2000 matches published reference pairs including hue-wrap cases', () => {
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.001], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  ] as const;
  for (const [first, second, expected] of pairs) {
    const a = { l: first[0], a: first[1], b: first[2] };
    const b = { l: second[0], a: second[1], b: second[2] };
    assert.ok(Math.abs(deltaE2000(a, b) - expected) < 0.0001);
    assert.ok(Math.abs(deltaE2000(b, a) - expected) < 0.0001);
    assert.equal(deltaE2000(a, a), 0);
  }
});
