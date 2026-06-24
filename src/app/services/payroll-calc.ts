export type PayType = 'HOURLY' | 'SALARY' | 'COMMISSION' | 'HYBRID';

export function round2(n: number): number {
  return (Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

type GrossInput = {
  payType: PayType;
  hourlyRate: number | null;
  monthlySalary: number | null;
  commissionRate: number | null;
  regularHours: number;
  overtimeHours: number;
  overtimeMultiplier: number | null;
  commissionableRevenue: number;
  adjustments: number;
};

type GrossResult = { basePay: number; overtimePay: number; commissionPay: number; grossPay: number };

export function computeGross(input: GrossInput): GrossResult {
  const rate = input.hourlyRate ?? 0;
  const salary = input.monthlySalary ?? 0;
  const commRate = input.commissionRate ?? 0;
  const otMult = input.overtimeMultiplier ?? 1.5;

  const hourlyBase = input.regularHours * rate;
  const overtimePayHourly = input.overtimeHours * rate * otMult;
  const commissionPay = input.commissionableRevenue * commRate;

  let basePay = 0;
  let overtimePay = 0;

  switch (input.payType) {
    case 'HOURLY':
      basePay = hourlyBase;
      overtimePay = overtimePayHourly;
      break;
    case 'SALARY':
      basePay = salary; // full fixed monthly amount, no overtime
      break;
    case 'COMMISSION':
      basePay = 0;
      break;
    case 'HYBRID':
      // Hourly base if an hourly rate is set, otherwise salary base.
      basePay = input.hourlyRate != null ? hourlyBase : salary;
      overtimePay = input.hourlyRate != null ? overtimePayHourly : 0;
      break;
  }

  const grossPay = basePay + overtimePay + commissionPay + input.adjustments;
  return {
    basePay: round2(basePay),
    overtimePay: round2(overtimePay),
    commissionPay: round2(commissionPay),
    grossPay: round2(grossPay),
  };
}
