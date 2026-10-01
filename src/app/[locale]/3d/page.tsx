import { permanentRedirect } from 'next/navigation';
import { getLocale } from '@/i18n/server';
import { localizeHref } from '@/i18n/paths';

/** Keep existing tour links working after moving it into the About page. */
export default async function Salon3DPage() {
  permanentRedirect(localizeHref(await getLocale(), '/about#salon-tour'));
}
