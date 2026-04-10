import Image from 'next/image';
import Link from 'next/link';

export function Hero() {
  return (
    <section className="relative h-[90vh] min-h-[650px] flex items-center justify-center bg-zinc-900 text-white overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0">
        <Image
          src="/images/hero-salon.png"
          alt="Harbour Hair Salon interior in Leeds Central Arcade"
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/30" />
      </div>

      <div className="relative z-10 text-center max-w-4xl px-4 animate-fade-in">
        {/* Gold accent line */}
        <div className="w-16 h-[2px] bg-[var(--accent)] mx-auto mb-8" />

        <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent)] mb-6 font-medium">
          Leeds City Centre
        </p>

        <h1 className="text-5xl md:text-7xl lg:text-8xl font-serif mb-6 tracking-tight leading-[0.95]">
          Expert Hair
          <br />
          <span className="italic text-zinc-300">Styling</span>
        </h1>

        <p className="text-lg md:text-xl text-zinc-300 mb-10 max-w-2xl mx-auto font-light leading-relaxed">
          Tailored cuts, colours and grooming by Hong Kong trained stylists.
          Precision and artistry in every appointment.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/book"
            className="inline-block bg-[var(--accent)] text-black px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-[var(--accent-light)] transition-all duration-300 hover:scale-105"
          >
            Book Appointment
          </Link>
          <Link
            href="/services"
            className="inline-block border border-white/40 text-white px-10 py-4 text-sm uppercase tracking-[0.2em] font-medium hover:bg-white/10 transition-all duration-300"
          >
            View Services
          </Link>
        </div>

        {/* Gold accent line */}
        <div className="w-16 h-[2px] bg-[var(--accent)] mx-auto mt-12" />
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <svg className="w-6 h-6 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    </section>
  );
}
