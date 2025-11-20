'use client';

import { Service, Stylist } from '@prisma/client';
import { format, addDays, startOfToday } from 'date-fns';
import { useState, useEffect } from 'react';
import { fetchSlots, submitBooking } from '@/app/actions/booking';

// Define a ClientService type where price is number instead of Decimal
type ClientService = Omit<Service, 'price'> & { price: number };

type Step = 'SERVICE' | 'STYLIST' | 'DATE' | 'DETAILS' | 'CONFIRM';

interface BookingWizardProps {
  services: ClientService[];
  stylists: Stylist[];
}

export function BookingWizard({ services, stylists }: BookingWizardProps) {
  const [step, setStep] = useState<Step>('SERVICE');
  const [selectedService, setSelectedService] = useState<ClientService | null>(null);
  const [selectedStylist, setSelectedStylist] = useState<Stylist | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [userDetails, setUserDetails] = useState({ name: '', email: '', phone: '' });
  const [isLoading, setIsLoading] = useState(false);

  // Fetch slots when stylist or date changes
  useEffect(() => {
    if (selectedStylist && selectedDate && selectedService) {
      const loadSlots = async () => {
        setIsLoading(true);
        const slots = await fetchSlots(selectedStylist.id, selectedDate, selectedService.duration);
        setAvailableSlots(slots.filter(s => s.available).map(s => s.time));
        setIsLoading(false);
      };
      loadSlots();
    }
  }, [selectedStylist, selectedDate, selectedService]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStylist || !selectedService || !selectedTime) return;

    setIsLoading(true);
    const result = await submitBooking({
      stylistId: selectedStylist.id,
      serviceId: selectedService.id,
      date: selectedDate,
      time: selectedTime,
      userName: userDetails.name,
      userEmail: userDetails.email,
      userPhone: userDetails.phone,
    });

    setIsLoading(false);
    if (result.success) {
      setStep('CONFIRM');
    } else {
      alert('Booking failed. Please try again.');
    }
  };

  const renderStepIndicator = () => (
    <div className="flex justify-center mb-8 space-x-2">
      {['SERVICE', 'STYLIST', 'DATE', 'DETAILS'].map((s, idx) => (
        <div 
          key={s} 
          className={`h-2 w-12 rounded-full ${
            ['SERVICE', 'STYLIST', 'DATE', 'DETAILS', 'CONFIRM'].indexOf(step) >= idx 
              ? 'bg-black' 
              : 'bg-gray-200'
          }`} 
        />
      ))}
    </div>
  );

  if (step === 'CONFIRM') {
    return (
      <div className="text-center py-12 animate-fade-in">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-3xl font-serif mb-4">Booking Confirmed!</h2>
        <p className="text-zinc-600 mb-8">
          Thank you, {userDetails.name}. We have sent a confirmation email to {userDetails.email}.
        </p>
        <button 
          onClick={() => window.location.href = '/'}
          className="bg-black text-white px-8 py-3 uppercase tracking-widest text-sm hover:bg-zinc-800"
        >
          Return Home
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto bg-white shadow-xl p-8 min-h-[600px]">
      {renderStepIndicator()}
      
      <div className="mb-8">
        <h2 className="text-2xl font-serif mb-2">
          {step === 'SERVICE' && 'Select a Service'}
          {step === 'STYLIST' && 'Choose a Stylist'}
          {step === 'DATE' && 'Select Date & Time'}
          {step === 'DETAILS' && 'Your Details'}
        </h2>
        <p className="text-zinc-500 text-sm">
           Step {['SERVICE', 'STYLIST', 'DATE', 'DETAILS'].indexOf(step) + 1} of 4
        </p>
      </div>

      {step === 'SERVICE' && (
        <div className="space-y-4">
          {services.map(service => (
            <div 
              key={service.id}
              onClick={() => { setSelectedService(service); setStep('STYLIST'); }}
              className="border border-zinc-200 p-4 flex justify-between items-center hover:border-black cursor-pointer transition-colors group"
            >
              <div>
                <h3 className="font-medium group-hover:text-black transition-colors">{service.name}</h3>
                <p className="text-sm text-zinc-500">{service.duration} mins</p>
              </div>
              <span className="font-serif">£{service.price.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {step === 'STYLIST' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {stylists.map(stylist => (
              <div 
                key={stylist.id}
                onClick={() => { setSelectedStylist(stylist); setStep('DATE'); }}
                className="border border-zinc-200 p-4 text-center hover:border-black cursor-pointer transition-colors"
              >
                 <div className="w-20 h-20 bg-zinc-200 rounded-full mx-auto mb-3 overflow-hidden">
                   {stylist.imageUrl ? (
                     // eslint-disable-next-line @next/next/no-img-element
                     <img src={stylist.imageUrl} alt={stylist.name} className="w-full h-full object-cover" />
                   ) : (
                     <div className="w-full h-full flex items-center justify-center text-xl font-serif text-zinc-400">
                       {stylist.name.charAt(0)}
                     </div>
                   )}
                 </div>
                <h3 className="font-medium">{stylist.name}</h3>
                <p className="text-xs text-zinc-500">{stylist.role}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setStep('SERVICE')} className="text-sm underline text-zinc-500">Back</button>
        </div>
      )}

      {step === 'DATE' && (
        <div>
          <div className="flex flex-col md:flex-row gap-8 mb-6">
            <div className="flex-1">
              <h3 className="font-medium mb-4">Select Date</h3>
              <div className="flex space-x-2 overflow-x-auto pb-2">
                {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                  const date = addDays(startOfToday(), offset);
                  const isSelected = format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                  return (
                    <button
                      key={offset}
                      onClick={() => setSelectedDate(date)}
                      className={`flex-shrink-0 w-14 h-20 rounded-lg border flex flex-col items-center justify-center ${
                        isSelected ? 'border-black bg-black text-white' : 'border-zinc-200'
                      }`}
                    >
                      <span className="text-xs uppercase">{format(date, 'EEE')}</span>
                      <span className="text-lg font-bold">{format(date, 'd')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            
            <div className="flex-1">
              <h3 className="font-medium mb-4">Available Times</h3>
              {isLoading ? (
                <div className="text-zinc-400 text-sm">Loading slots...</div>
              ) : availableSlots.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {availableSlots.map(time => (
                    <button
                      key={time}
                      onClick={() => setSelectedTime(time)}
                      className={`py-2 text-sm border rounded ${
                        selectedTime === time ? 'bg-black text-white border-black' : 'border-zinc-200 hover:border-black'
                      }`}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-zinc-500 text-sm italic">No slots available for this date.</div>
              )}
            </div>
          </div>
          
          <div className="flex justify-between items-center">
             <button onClick={() => setStep('STYLIST')} className="text-sm underline text-zinc-500">Back</button>
             <button 
               disabled={!selectedTime}
               onClick={() => setStep('DETAILS')}
               className="bg-black text-white px-6 py-2 uppercase text-sm tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
             >
               Continue
             </button>
          </div>
        </div>
      )}

      {step === 'DETAILS' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-zinc-50 p-4 rounded mb-6">
            <h3 className="font-serif mb-2 border-b pb-2">Booking Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-zinc-500 block">Service</span>
                {selectedService?.name}
              </div>
              <div>
                <span className="text-zinc-500 block">Stylist</span>
                {selectedStylist?.name}
              </div>
              <div>
                <span className="text-zinc-500 block">Date</span>
                {format(selectedDate, 'MMMM d, yyyy')}
              </div>
              <div>
                <span className="text-zinc-500 block">Time</span>
                {selectedTime}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">Full Name</label>
            <input 
              required
              type="text" 
              className="w-full border border-zinc-300 p-2 rounded focus:outline-none focus:border-black"
              value={userDetails.name}
              onChange={e => setUserDetails({...userDetails, name: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Email Address</label>
            <input 
              required
              type="email" 
              className="w-full border border-zinc-300 p-2 rounded focus:outline-none focus:border-black"
              value={userDetails.email}
              onChange={e => setUserDetails({...userDetails, email: e.target.value})}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Phone Number</label>
            <input 
              type="tel" 
              className="w-full border border-zinc-300 p-2 rounded focus:outline-none focus:border-black"
              value={userDetails.phone}
              onChange={e => setUserDetails({...userDetails, phone: e.target.value})}
            />
          </div>

          <div className="flex justify-between items-center mt-8">
             <button type="button" onClick={() => setStep('DATE')} className="text-sm underline text-zinc-500">Back</button>
             <button 
               type="submit"
               disabled={isLoading}
               className="bg-black text-white px-8 py-3 uppercase text-sm tracking-widest disabled:opacity-50"
             >
               {isLoading ? 'Booking...' : 'Confirm Booking'}
             </button>
          </div>
        </form>
      )}
    </div>
  );
}
