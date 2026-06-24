import Image from 'next/image';

type Photo = { src: string; w: number; h: number; alt: string };

const PHOTOS: Photo[] = [
  { src: '/images/gallery/salon-1.webp', w: 1400, h: 933, alt: 'The styling floor at Harbour Hair, with backlit round mirrors and styling chairs' },
  { src: '/images/gallery/salon-2.webp', w: 1400, h: 933, alt: 'Reception desk featuring the Harbour Hair sign' },
  { src: '/images/gallery/salon-3.webp', w: 1400, h: 933, alt: 'Wash and treatment area beside the hand-painted calligraphy wall' },
  { src: '/images/gallery/salon-4.webp', w: 933, h: 1400, alt: 'Styling stations with illuminated round mirrors' },
  { src: '/images/gallery/salon-5.webp', w: 933, h: 1400, alt: 'Styling area with natural light and professional hood dryers' },
  { src: '/images/gallery/salon-6.webp', w: 1400, h: 933, alt: 'Reception and retail area with calligraphy wall art' },
  { src: '/images/gallery/salon-7.webp', w: 1400, h: 933, alt: 'Professional styling scissors at a Harbour Hair station' },
];

export default function SalonGallery() {
  return (
    <section className="mt-20" aria-labelledby="our-space-heading">
      <div className="text-center mb-10">
        <div className="w-12 h-[2px] bg-accent mx-auto mb-6" />
        <h2 id="our-space-heading" className="text-3xl font-serif text-black mb-3">Our Space</h2>
        <p className="text-zinc-500 max-w-xl mx-auto font-light">
          A look inside the Harbour Hair studio in central Leeds.
        </p>
      </div>
      <div className="columns-2 md:columns-3 gap-4">
        {PHOTOS.map((p) => (
          <div key={p.src} className="mb-4 break-inside-avoid overflow-hidden rounded-lg shadow-sm">
            <Image
              src={p.src}
              width={p.w}
              height={p.h}
              alt={p.alt}
              sizes="(max-width: 768px) 50vw, 33vw"
              className="w-full h-auto object-cover transition-transform duration-500 hover:scale-105"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
