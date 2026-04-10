#!/usr/bin/env node
// Idempotent seeder — inserts the hardcoded posts.ts content into the BlogPost table
// only if a post with the same slug doesn't already exist.

import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const postsPath = path.resolve(here, '..', 'src', 'app', 'blog', 'posts.ts');

// Dynamic TS import via tsx loader
const { getAllPosts } = await import(pathToFileURL(postsPath).href);

const prisma = new PrismaClient();

async function main() {
  const posts = getAllPosts();
  console.log(`Found ${posts.length} hardcoded posts.`);

  for (const p of posts) {
    const existing = await prisma.blogPost.findUnique({ where: { slug: p.slug } });
    if (existing) {
      console.log(`  skip ${p.slug} (already exists)`);
      continue;
    }

    await prisma.blogPost.create({
      data: {
        slug: p.slug,
        title: p.title,
        description: p.description,
        excerpt: p.excerpt,
        author: p.author,
        authorRole: p.authorRole,
        publishedAt: new Date(p.publishedAt),
        readingTime: p.readingTime,
        tags: p.tags.join(','),
        coverImage: p.coverImage,
        coverAlt: p.coverAlt,
        lede: p.lede,
        sectionsJson: JSON.stringify(p.sections),
        relatedSlugs: (p.relatedSlugs ?? []).join(','),
        status: 'PUBLISHED',
      },
    });
    console.log(`  seeded ${p.slug}`);
  }

  const total = await prisma.blogPost.count();
  console.log(`\nBlogPost table now has ${total} rows.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
