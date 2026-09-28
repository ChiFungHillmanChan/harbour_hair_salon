import Image from 'next/image';
import { getT } from '@/i18n/server';

// `key` names the photo's alt text and caption in the `contact.gallery` dictionary.
type Photo = { src: string; key: 'floor' | 'reception' | 'wash' | 'stations' | 'light' | 'retail' | 'tools' };

// First photo is the wide hero; the remaining six tessellate into a clean 3×2 grid.
const HERO: Photo = { src: '/images/gallery/salon-1.webp', key: 'floor' };

const PHOTOS: Photo[] = [
  { src: '/images/gallery/salon-2.webp', key: 'reception' },
  { src: '/images/gallery/salon-3.webp', key: 'wash' },
  { src: '/images/gallery/salon-4.webp', key: 'stations' },
  { src: '/images/gallery/salon-5.webp', key: 'light' },
  { src: '/images/gallery/salon-6.webp', key: 'retail' },
  { src: '/images/gallery/salon-7.webp', key: 'tools' },
];

export default async function SalonGallery() {
  const t = await getT('contact');
  const alt = (photo: Photo) => t(`gallery.${photo.key}Alt`);
  const caption = (photo: Photo) => t(`gallery.${photo.key}Caption`);
  return (
    <section className="mt-20" aria-labelledby="our-space-heading">
      <div className="text-center mb-10">
        <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
        <h2 id="our-space-heading" className="text-3xl font-serif text-black mb-3">{t('gallery.title')}</h2>
        <p className="text-zinc-500 max-w-xl mx-auto font-light">
          {t('gallery.intro')}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        {/* Wide hero */}
        <figure className="group relative col-span-2 md:col-span-3 aspect-[16/9] md:aspect-[21/9] overflow-hidden rounded-xl shadow-sm">
          <Image
            src={HERO.src}
            alt={alt(HERO)}
            fill
            sizes="(max-width: 768px) 100vw, 1200px"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-105 motion-reduce:transform-none"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          <figcaption className="absolute inset-x-0 bottom-0 p-5 text-white text-sm tracking-[0.15em] uppercase font-light translate-y-2 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transition-none">
            {caption(HERO)}
          </figcaption>
        </figure>

        {/* Uniform 3×2 grid */}
        {PHOTOS.map((p) => (
          <figure
            key={p.src}
            className="group relative aspect-[4/3] overflow-hidden rounded-xl shadow-sm"
          >
            <Image
              src={p.src}
              alt={alt(p)}
              fill
              sizes="(max-width: 768px) 50vw, 33vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-105 motion-reduce:transform-none"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <figcaption className="absolute inset-x-0 bottom-0 p-4 text-white text-xs tracking-[0.15em] uppercase font-light translate-y-2 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transition-none">
              {caption(p)}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
