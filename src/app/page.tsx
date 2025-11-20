import prisma from '@/app/lib/prisma';
import { Hero } from '@/components/home/Hero';
import { ServiceMenu } from '@/components/home/ServiceMenu';
import { StylistShowcase } from '@/components/home/StylistShowcase';

// Revalidate data every hour
export const revalidate = 3600;

async function getServices() {
  const services = await prisma.service.findMany({
    orderBy: { category: 'asc' }
  });
  
  // Convert Decimal to number for client components
  return services.map(service => ({
    ...service,
    price: Number(service.price)
  }));
}

async function getStylists() {
  return prisma.stylist.findMany({
    orderBy: { name: 'asc' }
  });
}

export default async function Home() {
  const [services, stylists] = await Promise.all([
    getServices(),
    getStylists()
  ]);

  return (
    <div className="flex flex-col min-h-screen">
      <Hero />
      <ServiceMenu services={services} />
      <StylistShowcase stylists={stylists} />
    </div>
  );
}
