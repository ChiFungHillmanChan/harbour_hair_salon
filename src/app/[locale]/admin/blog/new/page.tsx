import { requireAdmin } from '@/app/lib/session';
import { BlogPostForm } from '@/components/admin/BlogPostForm';
import { createBlogPost } from '@/app/actions/admin-blog';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export default async function NewBlogPostPage() {
  await requireAdmin();
  const t = await getT('adminContent');
  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('blog.form.newTitle')}</h1>
        <p className="text-zinc-700 mt-2">{t('blog.form.newIntro')}</p>
      </div>
      <BlogPostForm mode="create" action={createBlogPost} />
    </div>
  );
}
