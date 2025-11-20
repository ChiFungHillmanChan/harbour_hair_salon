import React from 'react';

// Header is now a separate server component in ./Header.tsx
// exporting Footer from here for backward compatibility or just use direct import

export function Footer() {
  return (
    <footer className="bg-zinc-900 text-white py-12" id="contact">
      <div className="container mx-auto px-4 grid md:grid-cols-3 gap-8">
        <div>
          <h3 className="text-xl font-serif mb-4">Harbour Hair</h3>
          <p className="text-zinc-400 text-sm">
            Located in Leeds, specialized in barbering services designed to meet the unique style and grooming needs of modern men. 
            Precision and quality in every cut.
          </p>
        </div>
        
        <div>
          <h4 className="text-lg font-serif mb-4">Visit Us</h4>
          <address className="text-zinc-400 text-sm not-italic">
            F/1 Central Arcade<br />
            Central Road, Leeds<br />
            LS1 6DX<br />
            <br />
            <span className="block mt-2 text-xs">10-minute walk from Leeds station</span>
          </address>
        </div>

        <div>
          <h4 className="text-lg font-serif mb-4">Hours</h4>
          <ul className="text-zinc-400 text-sm space-y-2">
            <li>Mon - Fri: 10:00 AM – 7:30 PM</li>
            <li>Sat - Sun: 10:30 AM – 6:00 PM</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-zinc-800 mt-12 pt-8 text-center text-zinc-500 text-xs flex flex-col gap-2">
        <p>&copy; {new Date().getFullYear()} Harbour Hair Salon. All rights reserved.</p>
        <p>Amenities: Paid parking available • Payment: Cash & Credit Card • Languages: English, Chinese</p>
      </div>
    </footer>
  );
}
