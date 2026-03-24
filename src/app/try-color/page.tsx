import type { Metadata } from 'next';
import TryColorClient from './TryColorClient';

export const metadata: Metadata = {
  title: 'Virtual Hair Color Try-On',
  description:
    'Preview different hair colours in real time using your camera. See how a new look suits you before booking at Harbour Hair Salon.',
  alternates: { canonical: '/try-color' },
};

export default function TryColorPage() {
  return (
    <TryColorClient />
  );
}
