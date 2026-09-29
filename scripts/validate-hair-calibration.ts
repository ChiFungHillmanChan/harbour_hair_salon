import { readFile } from 'node:fs/promises';
import { parseTressCalibrations } from '../src/components/try-color/tressCalibration';

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: pnpm exec tsx scripts/validate-hair-calibration.ts <measurements.json>');
  const records = parseTressCalibrations(JSON.parse(await readFile(filename, 'utf8')));
  console.log(`Validated ${records.length} measurement records. Format validation does not establish prediction accuracy or publish any shades.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not validate measurement records.');
  process.exitCode = 1;
});
