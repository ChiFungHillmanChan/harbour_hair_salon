/**
 * Decides where a consultation-gated service should route the customer.
 *
 * Only haircuts and the 焗油 (oil) treatment book directly; every other service
 * is `requiresConsultation`. Colour (which also needs an allergy patch test)
 * routes to the Consultation & Patch Test; everything else routes to the
 * general Consultation. Both are paid (£15 each since 2026-10-15).
 */
export interface RoutableService {
  id: string;
  name: string;
  requiresConsultation: boolean;
  requiresPatchTest: boolean;
  isConsultation: boolean;
  isPatchTest: boolean;
  price: number;
}

export interface ConsultationTarget<T extends RoutableService> {
  target: T;
  fee: number;
}

export function resolveConsultationTarget<T extends RoutableService>(
  service: T,
  all: T[],
): ConsultationTarget<T> | null {
  if (!service.requiresConsultation) return null;

  const target = service.requiresPatchTest
    ? all.find((s) => s.isPatchTest)
    : all.find((s) => s.isConsultation);

  if (!target) return null;
  return { target, fee: target.price };
}

/**
 * What each consultation-required service's customer pays for the consultation
 * first (pence), by service id, from the same routing the booking wizard uses.
 * Services that need no consultation, or have no consultation to route to, are
 * absent. The services pages show the credit promise with this amount.
 */
export function consultationFeeByServiceId<T extends RoutableService & { amountPence: number }>(
  all: readonly T[],
): Record<string, number> {
  const fees: Record<string, number> = {};
  for (const service of all) {
    const routed = resolveConsultationTarget(service, [...all]);
    if (routed) fees[service.id] = routed.target.amountPence;
  }
  return fees;
}
