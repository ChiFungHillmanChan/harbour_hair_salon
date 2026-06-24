export type ClosedSegment = { clockIn: Date; clockOut: Date; breakMinutes: number };

export function segmentWorkedMinutes(seg: ClosedSegment): number {
  const gross = (seg.clockOut.getTime() - seg.clockIn.getTime()) / 60000;
  return Math.max(0, gross - seg.breakMinutes);
}

export function totalWorkedHours(segs: ClosedSegment[]): number {
  const minutes = segs.reduce((sum, s) => sum + segmentWorkedMinutes(s), 0);
  return minutes / 60;
}

export function splitRegularOvertime(
  totalHours: number,
  opts: { enabled: boolean; thresholdHours: number },
): { regularHours: number; overtimeHours: number } {
  if (!opts.enabled || totalHours <= opts.thresholdHours) {
    return { regularHours: totalHours, overtimeHours: 0 };
  }
  return { regularHours: opts.thresholdHours, overtimeHours: totalHours - opts.thresholdHours };
}
