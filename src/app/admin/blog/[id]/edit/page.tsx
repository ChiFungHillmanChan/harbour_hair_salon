import { requireAdmin } from '@/app/lib/session';
import { notFound } from 'next/navigation';
import { BlogPostForm } from '@/components/admin/BlogPostForm';
import { updateBlogPost } from '@/app/actions/admin-blog';
import { getPostById } from '@/app/services/blog-service';

export const dynamic = 'force-dynamic';

export default async function EditBlogPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved } = await searchParams;
  const post = await getPostById(id);
  if (!post) notFound();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Edit post</h1>
        <p className="text-zinc-700 mt-2 font-mono text-sm">/{post.slug}</p>
      </div>
      <BlogPostForm mode="edit" action={updateBlogPost} post={post} saved={Boolean(saved)} />
    </div>
  );
}
