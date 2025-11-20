import Link from 'next/link';

export function Hero() {
  return (
    <section className="relative h-[80vh] min-h-[600px] flex items-center justify-center bg-zinc-900 text-white overflow-hidden">
      {/* Background Image Placeholder - In production this would be a high-res image */}
      <div className="absolute inset-0 opacity-50 bg-[url('https://images.unsplash.com/photo-1585747860715-2ba37e788b70?q=80&w=2674&auto=format&fit=crop')] bg-cover bg-center" />
      
      <div className="relative z-10 text-center max-w-4xl px-4 animate-fade-in">
        <h1 className="text-5xl md:text-7xl font-serif mb-6 tracking-tight">
          Precision <span className="italic text-zinc-300">Barbering</span>
        </h1>
        <p className="text-lg md:text-xl text-zinc-200 mb-8 max-w-2xl mx-auto font-light">
          Experience tailored cuts and grooming in Leeds. Led by Hong Kong Stylist expertise.
        </p>
        <Link 
          href="/book"
          className="inline-block bg-white text-black px-8 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-zinc-200 transition-all hover:scale-105 duration-300"
        >
          Book Appointment
        </Link>
      </div>
    </section>
  );
}
