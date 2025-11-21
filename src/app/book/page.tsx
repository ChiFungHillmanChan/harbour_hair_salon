import prisma from '@/app/lib/prisma';
import { BookingWizard } from '@/components/booking/BookingWizard';

export const metadata = {
  title: 'Book Appointment | Harbour Hair',
  description: 'Book your next hair appointment online.',
};

// Revalidate frequently for booking page
export const revalidate = 60;

async function getServices() {
  const services = await prisma.service.findMany({
    orderBy: { category: 'asc' },
  });
  
  // Convert Decimal to number for client components
  return services.map(service => ({
    ...service,
    price: Number(service.price)
  }));
}

async function getStylists() {
  return prisma.stylist.findMany({
    orderBy: { name: 'asc' },
  });
}

export default async function BookPage() {
  const [services, stylists] = await Promise.all([
    getServices(),
    getStylists(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50 py-12">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-serif mb-4 text-zinc-900">Book Your Appointment</h1>
          <p className="text-zinc-600">Select your service, stylist, and preferred time.</p>
        </div>
        
        <BookingWizard services={services} stylists={stylists} />
      </div>
    </div>
  );
}
