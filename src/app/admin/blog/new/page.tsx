import { requireAdmin } from '@/app/lib/session';
import { BlogPostForm } from '@/components/admin/BlogPostForm';
import { createBlogPost } from '@/app/actions/admin-blog';

export const dynamic = 'force-dynamic';

export default async function NewBlogPostPage() {
  await requireAdmin();
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">New post</h1>
        <p className="text-zinc-700 mt-2">Write a new journal entry for Harbour Hair Salon.</p>
      </div>
      <BlogPostForm mode="create" action={createBlogPost} />
    </div>
  );
}
