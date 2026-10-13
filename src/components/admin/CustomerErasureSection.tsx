import prisma from '@/app/lib/prisma';
import { erasureConfirmationFor, isErasedEmail } from '@/app/lib/customer-erasure';
import { displayableEmail } from '@/app/lib/walk-in-customer';
import { localizeHref } from '@/i18n/paths';
import { getLocale, getT } from '@/i18n/server';
import { EraseCustomerButton } from './EraseCustomerButton';

/** Shortest search that reaches the database; anything shorter lists nobody. */
const ERASURE_SEARCH_MIN_LENGTH = 2;

/**
 * Admin -> Users: find a customer and erase their personal data on request
 * (actions/admin-erasure.ts, docs/data-erasure.md). It searches only when
 * asked and shows at most ten matches — never the whole customer list.
 */
export async function CustomerErasureSection({ query }: { query: string }) {
  const [locale, t] = await Promise.all([getLocale(), getT('adminOps')]);
  const term = query.length >= ERASURE_SEARCH_MIN_LENGTH ? query : '';
  const customers = term
    ? await prisma.user.findMany({
      // Addresses are stored lower-case; names and phones are matched as typed.
      where: { role: 'USER', OR: [{ name: { contains: term } }, { email: { contains: term.toLowerCase() } }, { phone: { contains: term } }] },
      select: { id: true, name: true, email: true, phone: true, _count: { select: { appointments: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
    })
    : [];

  return (
    <section aria-labelledby="customer-erasure-title" className="mt-8 rounded-lg border border-zinc-200 bg-white shadow">
      <div className="border-b border-zinc-200 p-6">
        <h2 id="customer-erasure-title" className="text-lg font-bold text-zinc-900">{t('users.erasure.title')}</h2>
        <p className="mt-1 text-sm text-zinc-600">{t('users.erasure.intro')}</p>
      </div>
      <form action={localizeHref(locale, '/admin/users')} className="flex flex-wrap items-center gap-3 p-6">
        <input name="erase" defaultValue={query} maxLength={100} aria-label={t('users.erasure.searchLabel')} placeholder={t('users.erasure.searchPlaceholder')} className="rounded border px-3 py-2" />
        <button type="submit" className="underline">{t('users.erasure.search')}</button>
        <span className="text-xs text-zinc-500">{t('users.erasure.searchHint')}</span>
      </form>
      {term && (customers.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-zinc-500">{t('users.erasure.empty', { query: term })}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 border-t border-zinc-200">
          {customers.map((customer) => {
            const erased = isErasedEmail(customer.email);
            const name = customer.name || t('users.fallbackName');
            const contact = [
              erased ? null : displayableEmail(customer.email) || t('users.erasure.noEmail'),
              customer.phone,
              t('users.erasure.appointments', { count: customer._count.appointments }),
            ].filter(Boolean).join(' · ');
            return (
              <li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div className="text-sm">
                  <p className="font-medium text-zinc-900">{name}</p>
                  <p className="text-zinc-500">{contact}</p>
                </div>
                {erased
                  ? <span className="text-xs font-medium uppercase text-zinc-500">{t('users.erasure.erased')}</span>
                  : <EraseCustomerButton userId={customer.id} name={name} expected={erasureConfirmationFor(customer.email)} />}
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
}
