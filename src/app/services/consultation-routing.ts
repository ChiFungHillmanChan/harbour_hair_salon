/**
 * Decides where a consultation-gated service should route the customer.
 *
 * Only haircuts and the 焗油 (oil) treatment book directly; every other service
 * is `requiresConsultation`. Colour (which also needs an allergy patch test)
 * routes to the paid Consultation & Patch Test; everything else routes to the
 * free general Consultation.
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
