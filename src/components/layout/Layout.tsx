import React from 'react';
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="bg-zinc-900 text-white" id="contact">
      {/* Booking CTA strip */}
      <div className="bg-accent text-black py-6">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-serif text-xl md:text-2xl font-medium text-center sm:text-left">
            Ready for a fresh look?
          </p>
          <Link
            href="/book"
            className="bg-black text-white px-8 py-3 text-sm uppercase tracking-[0.2em] font-bold hover:bg-zinc-800 transition-colors"
          >
            Book Appointment
          </Link>
        </div>
      </div>

      {/* Main footer */}
      <div className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <h3 className="text-2xl font-serif mb-4">
              Harbour <span className="text-accent">Hair</span>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Expert hair styling in the heart of Leeds. Specialising in precision cuts, colours, perms and grooming with Hong Kong trained expertise.
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-accent">Quick Links</h4>
            <ul className="space-y-3 text-sm text-zinc-400">
              <li><Link href="/services" className="hover:text-white transition-colors">Services & Pricing</Link></li>
              <li><Link href="/offers" className="hover:text-white transition-colors">Special Offers</Link></li>
              <li><Link href="/book" className="hover:text-white transition-colors">Book Online</Link></li>
              <li><Link href="/contact" className="hover:text-white transition-colors">Contact Us</Link></li>
            </ul>
          </div>

          {/* Visit Us */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-accent">Visit Us</h4>
            <address className="text-zinc-400 text-sm not-italic space-y-1">
              <p>Upper Floor, Unit 15</p>
              <p>Central Arcade, Central Rd</p>
              <p>Leeds, LS1 6DX</p>
              <p className="text-xs text-zinc-500 mt-3">Located inside Central Arcade</p>
            </address>
            <div className="mt-4">
              <a href="tel:+447831830898" className="text-sm text-zinc-300 hover:text-accent transition-colors">
                07831 830898
              </a>
            </div>
          </div>

          {/* Hours */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-accent">Hours</h4>
            <ul className="text-zinc-400 text-sm space-y-2">
              <li className="flex justify-between">
                <span>Mon – Fri</span>
                <span>10:00 – 19:30</span>
              </li>
              <li className="flex justify-between">
                <span>Sat – Sun</span>
                <span>10:30 – 18:00</span>
              </li>
            </ul>

            {/* Social */}
            <div className="mt-6 flex items-center gap-4">
              <a
                href="https://www.instagram.com/harbourhair_leeds/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-accent transition-colors"
                aria-label="Follow us on Instagram"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-zinc-800 py-6 text-center text-zinc-500 text-xs">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <p>&copy; {new Date().getFullYear()} Harbour Hair Salon. All rights reserved.</p>
          <p>Payment: Cash & Card &middot; Languages: English, Chinese (Cantonese)</p>
        </div>
      </div>
    </footer>
  );
}
