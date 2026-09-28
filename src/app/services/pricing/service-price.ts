import type { Prisma } from '@prisma/client';
import { penceToDecimalString, toPence } from './money';

export class ServicePriceError extends Error {
  constructor(readonly code: 'PRICE_INVALID' | 'PRICE_COMPOSITE') {
    super(code);
    this.name = 'ServicePriceError';
  }
}

/**
 * Change a service's listed price as part of publishing its content.
 *
 * - The price version increments, so a customer or admin still looking at the
 *   old price is asked to confirm the new one (quoteMatches) instead of being
 *   booked at a price they never saw.
 * - A composite option (extra long = long + surcharge) cannot be priced
 *   directly: its price is always base + surcharge. Re-pricing a BASE option
 *   re-prices its composites in the same transaction, so the £37 is never lost
 *   or applied twice.
 * - Existing appointments are untouched: they carry their own frozen amount.
 */
export async function applyServicePrice(db: Prisma.TransactionClient, serviceId: string, price: string | undefined) {
  if (price === undefined) return;
  let pence: number;
  try {
    pence = toPence(price);
  } catch {
    throw new ServicePriceError('PRICE_INVALID');
  }
  if (pence < 0 || pence > 10_000_000) throw new ServicePriceError('PRICE_INVALID');
  const service = await db.service.findUnique({ where: { id: serviceId }, select: { price: true, surchargeBaseServiceId: true } });
  if (!service) return;
  if (service.surchargeBaseServiceId) {
    if (toPence(service.price) !== pence) throw new ServicePriceError('PRICE_COMPOSITE');
    return;
  }
  if (toPence(service.price) === pence) return;
  await db.service.update({ where: { id: serviceId }, data: { price: penceToDecimalString(pence), priceVersion: { increment: 1 } } });
  const composites = await db.service.findMany({ where: { surchargeBaseServiceId: serviceId }, select: { id: true, surchargeAmount: true } });
  for (const composite of composites) {
    if (composite.surchargeAmount === null) continue;
    await db.service.update({
      where: { id: composite.id },
      data: { price: penceToDecimalString(pence + toPence(composite.surchargeAmount)), priceVersion: { increment: 1 } },
    });
  }
}
