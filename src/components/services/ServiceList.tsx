'use client';

import { Service, Offer } from '@prisma/client';
import { useState } from 'react';

interface ServiceListProps {
  groupedServices: Record<string, (Omit<Service, 'price'> & { price: number })[]>;
  categories: string[];
  activeOffer: (Omit<Offer, 'discountValue'> & { discountValue: number }) | null;
}

export function ServiceList({ groupedServices, categories, activeOffer }: ServiceListProps) {
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    categories.reduce((acc, cat) => ({ ...acc, [cat]: cat === 'Haircuts' }), {})
  );

  const toggleCategory = (category: string) => {
    setOpenCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const getDiscountedPrice = (price: number) => {
    if (!activeOffer) return null;
    if (activeOffer.discountType === 'PERCENTAGE') {
      return price - (price * (activeOffer.discountValue / 100));
    }
    return Math.max(0, price - activeOffer.discountValue);
  };

  return (
    <div className="space-y-8">
      {categories.map((category) => (
        <div key={category} className="bg-white/50 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleCategory(category)}
            className="w-full flex items-center justify-between py-6 px-4 md:px-0 text-left group"
          >
            <h2 className="text-3xl font-serif text-zinc-900 relative pl-6">
              <span className="relative z-10 bg-transparent pr-6">{category}</span>
            </h2>
            <div className="pr-6 text-zinc-400 group-hover:text-zinc-900 transition-colors">
              {openCategories[category] ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              )}
            </div>
          </button>
          
          {openCategories[category] && (
            <div className="px-6 md:px-0 pb-8 grid grid-cols-1 gap-8 animate-in slide-in-from-top-4 duration-300">
              {groupedServices[category].map((service) => {
                const discountedPrice = getDiscountedPrice(service.price);
                
                return (
                  <div key={service.id} className="group flex justify-between items-baseline border-b border-zinc-100 pb-4 hover:border-zinc-300 transition-colors">
                    <div className="pr-8">
                      <h3 className="text-xl font-serif text-zinc-900 mb-1 group-hover:text-zinc-600 transition-colors">
                        {service.name}
                      </h3>
                      {service.description && (
                        <p className="text-zinc-500 font-light text-sm leading-relaxed mb-2">
                          {service.description}
                        </p>
                      )}
                      <span className="text-xs text-zinc-400 uppercase tracking-wider">
                        {service.duration} mins
                      </span>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {discountedPrice !== null ? (
                        <div className="flex flex-col items-end">
                          <span className="text-sm text-zinc-400 line-through decoration-zinc-400/50">
                            £{service.price.toFixed(2)}
                          </span>
                          <span className="text-xl font-medium text-red-700 font-serif">
                            £{discountedPrice.toFixed(2)}
                          </span>
                        </div>
                      ) : (
                        <div className="text-xl font-medium text-zinc-900 font-serif">
                          £{service.price.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

