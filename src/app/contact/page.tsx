import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Contact & Find Us in Leeds City Centre',
  description: 'Visit Harbour Hair Salon at Unit 15 Central Arcade, Leeds LS1 6DX. Opening hours, directions from Leeds station, and contact details.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header Section */}
      <div className="bg-zinc-900 text-white py-14">
        <div className="container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-[var(--accent)] mx-auto mb-6" />
          <h1 className="text-3xl md:text-5xl font-serif mb-4 tracking-tight">Contact <span className="italic text-zinc-400">Us</span></h1>
          <p className="text-lg text-zinc-300 font-light">Find us in the heart of Leeds city centre</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 md:py-20">
        <div className="grid md:grid-cols-2 gap-12 max-w-6xl mx-auto">
          
          {/* Contact Info */}
          <div className="space-y-12">
            {/* Address */}
            <div>
              <h2 className="text-2xl font-bold text-black mb-6 border-b-2 border-zinc-200 pb-2">Location</h2>
              <address className="not-italic text-zinc-600 text-lg leading-relaxed">
                <p className="font-medium text-zinc-900 mb-2">Harbour Hair Salon</p>
                <p>Upper Floor, Unit 15</p>
                <p>Central Arcade, Central Rd</p>
                <p>Leeds, LS1 6DX</p>
                <p className="mt-4 text-sm text-zinc-500">
                  Located inside Central Arcade, just a short walk from Leeds Train Station.
                </p>
              </address>
            </div>

            {/* Contact & Social */}
            <div>
              <h2 className="text-2xl font-bold text-black mb-6 border-b-2 border-zinc-200 pb-2">Get in Touch</h2>
              <div className="space-y-4 text-lg">
                <p>
                  <span className="block text-sm font-bold text-zinc-900 uppercase tracking-wider mb-1">Phone</span>
                  <a href="tel:+447831830898" className="text-zinc-600 hover:text-zinc-900 transition-colors">
                    07831 830898
                  </a>
                </p>
                <p>
                  <span className="block text-sm font-bold text-zinc-900 uppercase tracking-wider mb-1">Instagram</span>
                  <a 
                    href="https://www.instagram.com/harbourhair_leeds/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-zinc-600 hover:text-zinc-900 transition-colors inline-flex items-center gap-2"
                  >
                    Follow us on Instagram
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                    </svg>
                  </a>
                </p>
              </div>
            </div>

            {/* Opening Hours */}
            <div>
              <h2 className="text-2xl font-bold text-black mb-6 border-b-2 border-zinc-200 pb-2">Opening Hours</h2>
              <ul className="space-y-2 text-lg text-zinc-600">
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Monday</span>
                  <span>10:00 – 19:30</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Tuesday</span>
                  <span>10:00 – 19:30</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Wednesday</span>
                  <span>10:00 – 19:30</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Thursday</span>
                  <span>10:00 – 19:30</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Friday</span>
                  <span>10:00 – 19:30</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Saturday</span>
                  <span>10:30 – 18:00</span>
                </li>
                <li className="flex justify-between">
                  <span className="font-medium text-zinc-900">Sunday</span>
                  <span>10:30 – 18:00</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Map */}
          <div className="h-full min-h-[400px] bg-zinc-100 rounded-lg overflow-hidden relative shadow-lg">
            <iframe 
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2356.2!2d-1.544255!3d53.7965911!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x48795d7c1f30e4cf%3A0xad74be12e1f34d1a!2sHarbour%20Hair!5e0!3m2!1sen!2suk!4v1710000000000!5m2!1sen!2suk" 
              width="100%" 
              height="100%" 
              style={{ border: 0, minHeight: '500px' }} 
              allowFullScreen 
              loading="lazy" 
              referrerPolicy="no-referrer-when-downgrade"
              className="transition-all duration-500"
            ></iframe>
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-20 text-center bg-zinc-900 p-16">
          <div className="w-12 h-[2px] bg-[var(--accent)] mx-auto mb-8" />
          <h2 className="text-3xl font-serif text-white mb-6">Ready for a fresh look?</h2>
          <p className="text-zinc-400 mb-10 max-w-xl mx-auto font-light">
            Book your appointment online today and let our expert stylists take care of you.
          </p>
          <Link
            href="/book"
            className="inline-block bg-[var(--accent)] text-black px-12 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-[var(--accent-light)] transition-all"
          >
            Book Appointment
          </Link>
        </div>
      </div>
    </div>
  );
}
