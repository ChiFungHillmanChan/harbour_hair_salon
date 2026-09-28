'use client';

import type { ComponentProps } from 'react';
import { usePreservedForm } from '@/i18n/draft-store';

/**
 * A plain <form> whose unsaved fields survive an interface-language switch
 * (memory only, see draft-store). For server-rendered forms that post
 * straight to a server action; mark secret fields `data-no-preserve`.
 */
export function DraftForm({ draftKey, ...props }: ComponentProps<'form'> & { draftKey: string }) {
  const formRef = usePreservedForm(draftKey);
  return <form ref={formRef} {...props} />;
}
