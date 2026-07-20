import { hasActiveOffers } from '@/app/services/offers-service';
import { HeaderClient } from './HeaderClient';

/** Static marketing header data. Account state is loaded separately client-side. */
export async function Header() {
  const hasOffers = await hasActiveOffers();
  return <HeaderClient hasOffers={hasOffers} />;
}
