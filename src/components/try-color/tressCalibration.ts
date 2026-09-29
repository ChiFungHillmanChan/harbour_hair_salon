import { z } from 'zod';
import type { LabColor } from './constants';

const text = z.string().trim().min(1);
const lab = z.strictObject({
  l: z.number().finite().min(0).max(100),
  a: z.number().finite(),
  b: z.number().finite(),
});

/** Offline collection contract. A valid record is not proof of salon accuracy. */
export const tressCalibrationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: text,
  shade: z.strictObject({ brand: text, line: text, code: text, chartVersion: text, market: text }),
  levelScale: z.strictObject({ id: text, label: text, min: z.number().finite(), max: z.number().finite() }),
  base: z.strictObject({
    history: z.enum(['natural', 'coloured', 'lightened', 'unknown']),
    level: z.number().finite(),
    undertone: z.enum(['neutral', 'red', 'orange', 'yellow', 'pale-yellow']),
    greyPercent: z.number().min(0).max(100),
    porosity: z.enum(['low', 'normal', 'high', 'unknown']),
    historyNotes: text,
  }),
  process: z.strictObject({
    method: z.enum(['deposit', 'permanent', 'prelighten']),
    productNotes: text,
    developerNotes: text,
    processingMinutes: z.number().finite().positive(),
  }),
  measurement: z.strictObject({
    illuminant: z.enum(['D50', 'D65']),
    observer: z.enum(['2-degree', '10-degree']),
    geometry: text,
    specular: z.enum(['included', 'excluded']),
    instrument: text,
    // Project collection minimum, not a universal accuracy standard.
    replicateCount: z.number().int().min(3),
  }),
  beforeLab: lab,
  afterLab: lab,
  evidence: z.strictObject({
    measuredAt: z.iso.date(),
    operator: text,
    sourceRecord: text,
  }),
}).superRefine((record, context) => {
  const { min, max } = record.levelScale;
  if (min >= max) {
    context.addIssue({ code: 'custom', path: ['levelScale'], message: 'Scale minimum must be below maximum.' });
  }
  if (record.base.level < min || record.base.level > max) {
    context.addIssue({ code: 'custom', path: ['base', 'level'], message: 'Base level is outside this manufacturer scale.' });
  }
});

export type TressCalibration = z.infer<typeof tressCalibrationSchema>;

export function parseTressCalibrations(input: unknown): TressCalibration[] {
  return z.array(tressCalibrationSchema).min(1).superRefine((records, context) => {
    const seen = new Set<string>();
    records.forEach((record, index) => {
      if (seen.has(record.id)) {
        context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Duplicate measurement ID.' });
      }
      seen.add(record.id);
    });
  }).parse(input);
}

/**
 * CIEDE2000 with unit parametric factors. Both Lab values MUST share reference
 * white, observer and measurement conditions. This is a colour distance, never
 * a probability or a validated prediction of a hair-dye chemical process.
 * Formula reference: https://www.w3.org/TR/css-color-4/#color-difference-2000
 */
export function deltaE2000(first: LabColor, second: LabColor): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const degrees = (radians: number) => radians * 180 / Math.PI;
  const c1 = Math.hypot(first.a, first.b);
  const c2 = Math.hypot(second.a, second.b);
  const meanC = (c1 + c2) / 2;
  const meanC7 = meanC ** 7;
  const g = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + 25 ** 7)));
  const a1 = (1 + g) * first.a;
  const a2 = (1 + g) * second.a;
  const cp1 = Math.hypot(a1, first.b);
  const cp2 = Math.hypot(a2, second.b);
  const hue = (a: number, b: number) => (degrees(Math.atan2(b, a)) + 360) % 360;
  const h1 = cp1 === 0 ? 0 : hue(a1, first.b);
  const h2 = cp2 === 0 ? 0 : hue(a2, second.b);
  const dl = second.l - first.l;
  const dc = cp2 - cp1;
  let dh = h2 - h1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(radians(dh / 2));
  const meanL = (first.l + second.l) / 2;
  const meanCp = (cp1 + cp2) / 2;
  let meanH = (h1 + h2) / 2;
  if (cp1 * cp2 === 0) meanH = h1 + h2;
  else if (Math.abs(h1 - h2) > 180) meanH += h1 + h2 < 360 ? 180 : -180;
  const t = 1 - 0.17 * Math.cos(radians(meanH - 30))
    + 0.24 * Math.cos(radians(2 * meanH))
    + 0.32 * Math.cos(radians(3 * meanH + 6))
    - 0.20 * Math.cos(radians(4 * meanH - 63));
  const sl = 1 + 0.015 * (meanL - 50) ** 2 / Math.sqrt(20 + (meanL - 50) ** 2);
  const sc = 1 + 0.045 * meanCp;
  const sh = 1 + 0.015 * meanCp * t;
  const rotation = 30 * Math.exp(-(((meanH - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7));
  const rt = -Math.sin(radians(2 * rotation)) * rc;
  return Math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh));
}
