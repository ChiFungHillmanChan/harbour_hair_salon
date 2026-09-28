import { requireAdmin } from '@/app/lib/session';
import { notFound } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { BlogPostForm } from '@/components/admin/BlogPostForm';
import { BilingualContentEditor } from '@/components/admin/BilingualContentEditor';
import { updateBlogPost } from '@/app/actions/admin-blog';
import { getPostById } from '@/app/services/blog-service';
import { getEditorState } from '@/app/services/content/drafts';
import { getT } from '@/i18n/server';

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
  const [post, t] = await Promise.all([getPostById(id), getT('adminContent')]);
  if (!post) notFound();
  const editor = await prisma.$transaction((tx) => getEditorState(tx, 'BLOG_POST', post.id));

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('blog.form.editTitle')}</h1>
        <p className="text-zinc-700 mt-2 font-mono text-sm">/{post.slug}</p>
      </div>
      <BilingualContentEditor
        mode="edit"
        type="BLOG_POST"
        entityId={post.id}
        initial={{
          revision: editor.revision,
          working: editor.working,
          review: editor.review,
          shared: editor.shared,
          hasDraft: editor.hasDraft,
          draftUpdatedAt: editor.draftUpdatedAt,
        }}
      />
      <BlogPostForm
        mode="edit"
        action={updateBlogPost}
        post={{
          id: post.id,
          slug: post.slug,
          author: post.author,
          publishedAt: post.publishedAt,
          readingTime: post.readingTime,
          tags: post.tags,
          coverImage: post.coverImage,
          relatedSlugs: post.relatedSlugs,
          status: post.status,
        }}
        saved={Boolean(saved)}
      />
    </div>
  );
}
