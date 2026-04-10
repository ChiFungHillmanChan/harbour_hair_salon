#!/usr/bin/env node
// Seeds ServiceCategoryContent table from src/app/services/categories.ts.

import { PrismaClient } from '@prisma/client';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const categoriesPath = path.resolve(here, '..', 'src', 'app', 'services', 'categories.ts');

const { getAllCategories } = await import(pathToFileURL(categoriesPath).href);
const prisma = new PrismaClient();

async function main() {
  const all = getAllCategories();
  console.log(`Seeding ${all.length} category content rows...`);

  for (let i = 0; i < all.length; i++) {
    const cat = all[i];
    const existing = await prisma.serviceCategoryContent.findUnique({
      where: { slug: cat.slug },
    });
    if (existing) {
      console.log(`  skip ${cat.slug} (already exists)`);
      continue;
    }

    await prisma.serviceCategoryContent.create({
      data: {
        slug: cat.slug,
        category: cat.category,
        title: cat.title,
        hero: cat.hero,
        metaDescription: cat.metaDescription,
        intro: cat.intro,
        overviewJson: JSON.stringify(cat.overview),
        includesJson: JSON.stringify(cat.includes),
        processJson: JSON.stringify(cat.process),
        aftercareJson: JSON.stringify(cat.aftercare),
        faqsJson: JSON.stringify(cat.faqs),
        relatedSlugs: (cat.relatedSlugs ?? []).join(','),
        displayOrder: i,
      },
    });
    console.log(`  seeded ${cat.slug}`);
  }

  const total = await prisma.serviceCategoryContent.count();
  console.log(`\nServiceCategoryContent table now has ${total} rows.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
