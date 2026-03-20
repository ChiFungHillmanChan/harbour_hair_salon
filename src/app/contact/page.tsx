import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Contact & Location | Harbour Hair Salon',
  description: 'Find Harbour Hair Salon at Central Arcade, Leeds. Opening hours, directions, and contact details.',
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header Section */}
      <div className="bg-zinc-900 text-white py-10">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-3xl md:text-5xl font-serif mb-4 tracking-tight">Contact Us</h1>
          <p className="text-lg text-zinc-300 font-light">Find us in the heart of Leeds</p>
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
                <p>F/1 Central Arcade</p>
                <p>Central Road</p>
                <p>Leeds, LS1 6DX</p>
                <p className="mt-4 text-sm text-zinc-500">
                  Just a 10-minute walk from Leeds Train Station.
                  <br />
                  Located inside Central Arcade.
                </p>
              </address>
            </div>

            {/* Contact & Social */}
            <div>
              <h2 className="text-2xl font-bold text-black mb-6 border-b-2 border-zinc-200 pb-2">Get in Touch</h2>
              <div className="space-y-4 text-lg">
                <p>
                  <span className="block text-sm font-bold text-zinc-900 uppercase tracking-wider mb-1">Phone</span>
                  <a href="tel:+441234567890" className="text-zinc-600 hover:text-zinc-900 transition-colors">
                    +44 123 456 7890
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
                  <span>10:00 AM – 7:30 PM</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Tuesday</span>
                  <span>10:00 AM – 7:30 PM</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Wednesday</span>
                  <span>10:00 AM – 7:30 PM</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Thursday</span>
                  <span>10:00 AM – 7:30 PM</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Friday</span>
                  <span>10:00 AM – 7:30 PM</span>
                </li>
                <li className="flex justify-between border-b border-zinc-100 pb-1">
                  <span className="font-medium text-zinc-900">Saturday</span>
                  <span>10:30 AM – 6:00 PM</span>
                </li>
                <li className="flex justify-between">
                  <span className="font-medium text-zinc-900">Sunday</span>
                  <span>10:30 AM – 6:00 PM</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Map */}
          <div className="h-full min-h-[400px] bg-zinc-100 rounded-lg overflow-hidden relative shadow-lg">
            <iframe 
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2356.118936462793!2d-1.5446742229743192!3d53.79784867246742!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x48795c1e2c072d9f%3A0x2524661623250319!2sCentral%20Arcade!5e0!3m2!1sen!2suk!4v1710000000000!5m2!1sen!2suk" 
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
        <div className="mt-20 text-center bg-zinc-50 rounded-2xl p-16">
          <h2 className="text-3xl font-bold text-black mb-6">Ready for a fresh look?</h2>
          <p className="text-zinc-600 mb-10 max-w-xl mx-auto">
            Book your appointment online today and let our expert stylists take care of you.
          </p>
          <div className="mb-4">
            <Link 
              href="/book"
              className="inline-block bg-zinc-900 text-white px-12 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-zinc-800 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-1"
            >
              Book Here
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
