import Link from 'next/link';

/**
 * One-line footer for focused flows (auth pages) where the full marketing
 * footer — booking CTA, newsletter, link columns — would compete with the task.
 */
export function SlimFooter() {
  return (
    <footer className="bg-zinc-900 py-6 text-center text-xs text-zinc-500">
      <div className="container mx-auto flex flex-col items-center justify-center gap-2 px-4 sm:flex-row sm:gap-4">
        <p>&copy; {new Date().getFullYear()} Harbour Hair Salon. All rights reserved.</p>
        <Link href="/privacy" className="hover:text-zinc-300 transition-colors">
          Privacy
        </Link>
      </div>
    </footer>
  );
}
