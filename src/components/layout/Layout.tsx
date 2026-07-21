import React from 'react';
import Link from 'next/link';
import { NewsletterForm } from '@/components/newsletter/NewsletterForm';
import SocialLinks from '@/components/layout/SocialLinks';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { hasActiveOffers } from '@/app/services/offers-service';
import { toTelHref } from '@/app/lib/phone';

export function FooterPromotions() {
  return (
    <aside aria-label="Booking and newsletter">
      {/* Booking CTA strip */}
      <div className="bg-zinc-100 text-zinc-900 py-6">
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

      {/* Newsletter strip */}
      <div className="border-b border-zinc-800 bg-zinc-950">
        <div className="container mx-auto px-4 py-14 max-w-xl text-center">
          <div className="w-12 h-px bg-white/50 mx-auto mb-5" />
          <h3 className="text-2xl md:text-3xl font-serif text-white tracking-tight mb-3">
            Stay in the loop
          </h3>
          <p className="text-zinc-400 font-light leading-relaxed mb-6 text-sm">
            Seasonal offers and stylist tips, straight to your inbox. No spam, unsubscribe any time.
          </p>
          <div className="max-w-sm mx-auto">
            <NewsletterForm variant="inline" source="footer" />
          </div>
        </div>
      </div>
    </aside>
  );
}

export async function Footer() {
  const [hasOffers, settings] = await Promise.all([
    hasActiveOffers(),
    getSiteSettings(),
  ]);
  const phoneDisplay = settings.phone.trim() || '07831 830898';

  return (
    <footer className="bg-zinc-900 text-white" id="contact">
      {/* Main footer */}
      <div className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <h3 className="text-2xl font-serif mb-4">
              Harbour <span className="text-zinc-400">Hair</span>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Expert hair styling in the heart of Leeds. Specialising in precision cuts, colours, perms and grooming with Hong Kong trained expertise.
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-zinc-300">Quick Links</h4>
            <ul className="space-y-3 text-sm text-zinc-400">
              <li><Link href="/services" className="hover:text-white transition-colors">Services & Pricing</Link></li>
              {hasOffers && (
                <li><Link href="/offers" className="hover:text-white transition-colors">Special Offers</Link></li>
              )}
              <li><Link href="/stylists" className="hover:text-white transition-colors">Our Stylists</Link></li>
              <li><Link href="/reviews" className="hover:text-white transition-colors">Client Reviews</Link></li>
              <li><Link href="/blog" className="hover:text-white transition-colors">Journal</Link></li>
              <li><Link href="/book" className="hover:text-white transition-colors">Book Online</Link></li>
              <li><Link href="/contact" className="hover:text-white transition-colors">Contact Us</Link></li>
              <li>
                <a
                  href="https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  Treatwell
                </a>
              </li>
            </ul>
          </div>

          {/* Visit Us */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-zinc-300">Visit Us</h4>
            <address className="text-zinc-400 text-sm not-italic space-y-1">
              <p>Upper Floor, Unit 15</p>
              <p>Central Arcade, Central Rd</p>
              <p>Leeds, LS1 6DX</p>
              <p className="text-xs text-zinc-500 mt-3">Located inside Central Arcade</p>
            </address>
            <div className="mt-4">
              <a href={toTelHref(phoneDisplay)} className="text-sm text-zinc-300 hover:text-white transition-colors">
                {phoneDisplay}
              </a>
            </div>
          </div>

          {/* Hours */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-zinc-300">Hours</h4>
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
            <div className="mt-6">
              <SocialLinks settings={settings} tone="dark" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-zinc-800 py-6 text-center text-zinc-500 text-xs">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <p>&copy; {new Date().getFullYear()} Harbour Hair Salon. All rights reserved.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span>Payment: Cash & Card &middot; Languages: English, Chinese (Cantonese)</span>
            <Link href="/privacy" className="hover:text-zinc-300 transition-colors">Privacy</Link>
            <Link href="/unsubscribe" className="hover:text-zinc-300 transition-colors">Unsubscribe</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
