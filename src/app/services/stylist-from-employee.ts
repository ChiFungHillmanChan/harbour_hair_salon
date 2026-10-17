import 'server-only';
import type { Prisma } from '@prisma/client';
import { slugify } from '@/app/stylists/slug';
import { createPublished } from '@/app/services/content/drafts';
import { appendAuditEvent } from '@/app/lib/audit';

/**
 * Admin → Employees → "Also add as stylist" (owner, 2026-10-17): a stylist for
 * a member of staff, so they appear in Admin → Stylists, the schedule and the
 * Google diary. Hidden from the website (showOnWebsite false) until staff switch
 * it on: there is no photo or bio yet, and online booking must not wait for
 * their rota or Fresha feed. The profile's role line is the job title in both
 * languages; staff can edit the Chinese in Admin → Stylists.
 */
export async function createStylistForEmployee(
  tx: Prisma.TransactionClient,
  input: { name: string; title: string; adminId: string },
): Promise<string> {
  const name = input.name.trim();
  const title = input.title.trim();
  const slug = await freeSlug(tx, slugify(name) || 'stylist');
  const fields = { 'en-GB': { role: title }, 'zh-HK': { role: title } };
  const created = await createPublished(tx, 'STYLIST', { fields, confirmedReviewed: true, adminId: input.adminId }, (english) => tx.stylist.create({
    select: { id: true },
    data: { name, slug, role: typeof english.role === 'string' ? english.role : title, showOnWebsite: false },
  }));
  await appendAuditEvent({ actorUserId: input.adminId, action: 'STYLIST.CREATED_FOR_EMPLOYEE', targetType: 'Stylist', targetId: created.id, metadata: { showOnWebsite: false } }, tx);
  return created.id;
}

/** `base`, else `base-2`, `base-3`…: the first address no stylist has. */
async function freeSlug(tx: Prisma.TransactionClient, base: string): Promise<string> {
  const rows = await tx.stylist.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } });
  const taken = new Set(rows.map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
