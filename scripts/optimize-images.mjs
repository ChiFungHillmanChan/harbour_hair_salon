#!/usr/bin/env node
// Optimizes hero images to WebP and generates proper favicon sizes.
// Idempotent — safe to re-run.

import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.resolve(here, '..', 'public', 'images');

const HEROES = [
  'hero-salon',
  'services-hero',
  'offers-hero',
  'og-image',
];

async function fileSize(p) {
  try {
    const s = await stat(p);
    return s.size;
  } catch {
    return null;
  }
}

function fmt(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function convertHero(base) {
  const srcPng = path.join(imagesDir, `${base}.png`);
  const dstWebp = path.join(imagesDir, `${base}.webp`);
  const dstAvif = path.join(imagesDir, `${base}.avif`);

  const before = await fileSize(srcPng);
  if (before == null) {
    console.log(`  skip ${base} — no source .png found`);
    return;
  }

  await sharp(srcPng)
    .webp({ quality: 82, effort: 5 })
    .toFile(dstWebp);

  await sharp(srcPng)
    .avif({ quality: 65, effort: 4 })
    .toFile(dstAvif);

  const webpSize = await fileSize(dstWebp);
  const avifSize = await fileSize(dstAvif);
  console.log(
    `  ${base.padEnd(16)} png=${fmt(before).padStart(9)}  webp=${fmt(webpSize).padStart(9)}  avif=${fmt(avifSize).padStart(9)}`
  );
}

async function splitFavicon() {
  const src = path.join(imagesDir, 'favicon.png');
  const outs = [
    { size: 32, name: 'favicon-32.png' },
    { size: 192, name: 'favicon-192.png' },
    { size: 512, name: 'favicon-512.png' },
  ];

  for (const { size, name } of outs) {
    const dst = path.join(imagesDir, name);
    await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9, palette: true })
      .toFile(dst);
    const s = await fileSize(dst);
    console.log(`  favicon ${size}x${size}  → ${name.padEnd(18)} ${fmt(s).padStart(9)}`);
  }
}

async function main() {
  console.log('Converting hero images...');
  for (const base of HEROES) {
    await convertHero(base);
  }

  console.log('\nGenerating favicon sizes...');
  await splitFavicon();

  console.log('\nDone.');

  const all = await readdir(imagesDir);
  console.log(`\npublic/images/ now contains ${all.length} files:`);
  for (const f of all.sort()) {
    const s = await fileSize(path.join(imagesDir, f));
    console.log(`  ${f.padEnd(22)} ${fmt(s).padStart(9)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
