'use client';

import { useT } from '@/i18n/client';

export function PaginationText({ kind, page, id, className }: { kind: 'label' | 'previous' | 'next' | 'page'; page?: number; id?: string; className?: string }) {
  const t = useT('common');
  const text = kind === 'page' ? t('pagination.page', { page: page ?? 1 }) : t(`pagination.${kind}`);
  return <span id={id} className={className}>{text}</span>;
}
