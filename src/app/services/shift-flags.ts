export type ShiftEvaluation = {
  late: boolean;
  lateByMin: number;
  earlyLeave: boolean;
  earlyByMin: number;
};

/** Compare a day's actual first clock-in / last clock-out (salon-local minutes since
 *  midnight) against an assigned shift, with a grace window. Informational only. */
export function evaluateShift(input: {
  shiftStartMin: number;
  shiftEndMin: number;
  firstInMin: number;
  lastOutMin: number;
  graceMin: number;
}): ShiftEvaluation {
  const lateBy = input.firstInMin - input.shiftStartMin;
  const earlyBy = input.shiftEndMin - input.lastOutMin;
  const late = lateBy > input.graceMin;
  const earlyLeave = earlyBy > input.graceMin;
  return {
    late,
    lateByMin: late ? lateBy : 0,
    earlyLeave,
    earlyByMin: earlyLeave ? earlyBy : 0,
  };
}
