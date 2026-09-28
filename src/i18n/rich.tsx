import { Fragment, type ReactNode } from 'react';

/**
 * Render a translated sentence that contains markup, e.g.
 *   "View it in <link>My Bookings</link>."  →  rich(text, { link: (c) => <Link …>{c}</Link> })
 * Tags cannot nest; text outside tags is plain (React escapes it). Server and
 * client safe — no hooks.
 */
export function rich(text: string, tags: Record<string, (chunk: string) => ReactNode>): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const render = tags[match[1]];
    parts.push(<Fragment key={index++}>{render ? render(match[2]) : match[2]}</Fragment>);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
