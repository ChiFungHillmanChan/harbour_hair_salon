import prisma from '@/app/lib/prisma';
import { Hero } from '@/components/home/Hero';
import { ServiceMenu } from '@/components/home/ServiceMenu';
import { StylistShowcase } from '@/components/home/StylistShowcase';
import { getSession } from '@/app/lib/session';
import { redirect } from 'next/navigation';

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

async function getGlobalOffer() {
  const offer = await prisma.offer.findFirst({
    where: { isActive: true, isGlobal: true },
    orderBy: { createdAt: 'desc' }
  });

  if (!offer) return null;

  return {
    ...offer,
    discountValue: Number(offer.discountValue)
  };
}

async function getStylists() {
  return prisma.stylist.findMany({
    orderBy: { name: 'asc' }
  });
}

export default async function Home() {
  const session = await getSession();
  if (session?.role === 'ADMIN') {
    redirect('/admin');
  }

  const [services, stylists, activeOffer] = await Promise.all([
    getServices(),
    getStylists(),
    getGlobalOffer()
  ]);

  return (
    <div className="flex flex-col min-h-screen">
      <Hero />
      <ServiceMenu services={services} activeOffer={activeOffer} />
      <StylistShowcase stylists={stylists} />
    </div>
  );
}
