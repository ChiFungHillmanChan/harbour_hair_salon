import { notFound } from 'next/navigation';

// Any unmatched URL inside a language renders that language's not-found page
// (with the site header/footer) instead of Next's unstyled global 404.
export default function CatchAll() {
  notFound();
}
