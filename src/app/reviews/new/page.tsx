import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { ReviewForm } from '@/components/reviews/ReviewForm';

export const metadata: Metadata = {
  title: 'Leave a Review',
  description: 'Share your experience at Harbour Hair Salon.',
  robots: { index: false, follow: false },
};

export default async function NewReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ appointmentId?: string }>;
}) {
  const now = new Date();
  const session = await verifySession();
  const { appointmentId } = await searchParams;

  if (!appointmentId) {
    redirect('/appointments');
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      service: { select: { name: true } },
      stylist: { select: { name: true } },
      review: { select: { id: true } },
    },
  });

  if (!appointment || appointment.userId !== session.userId) {
    notFound();
  }

  if (appointment.review) {
    return (
      <div className="min-h-screen bg-white">
        <div className="container mx-auto px-4 py-20 max-w-2xl text-center">
          <h1 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-4">
            Review already submitted
          </h1>
          <p className="text-zinc-600 font-light mb-8">
            Thank you — you&apos;ve already shared feedback for this appointment.
          </p>
          <Link
            href="/appointments"
            className="inline-block bg-zinc-900 text-white px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-black transition-all"
          >
            Back to My Bookings
          </Link>
        </div>
      </div>
    );
  }

  const isPast = appointment.date.getTime() < now.getTime();
  const isCancelled = appointment.status === 'CANCELLED';
  if (!isPast || isCancelled) {
    return (
      <div className="min-h-screen bg-white">
        <div className="container mx-auto px-4 py-20 max-w-2xl text-center">
          <h1 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-4">
            Not yet ready for a review
          </h1>
          <p className="text-zinc-600 font-light mb-8">
            You can leave a review once you&apos;ve attended your appointment.
          </p>
          <Link
            href="/appointments"
            className="inline-block bg-zinc-900 text-white px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-black transition-all"
          >
            Back to My Bookings
          </Link>
        </div>
      </div>
    );
  }

  const dateFormatted = appointment.date.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-white">
      <section className="relative py-20 bg-zinc-900 text-white">
        <div className="container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-4xl md:text-5xl font-serif mb-4 tracking-tight">
            How was your <span className="text-zinc-300">visit?</span>
          </h1>
          <p className="text-zinc-400 max-w-xl mx-auto font-light leading-relaxed">
            Your feedback helps us improve and helps other clients find the right stylist.
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-6 mb-10">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium mb-2">
            Your appointment
          </p>
          <p className="text-lg font-medium text-zinc-900">{appointment.service.name}</p>
          <p className="text-zinc-600 mt-1">
            with {appointment.stylist.name} on {dateFormatted}
          </p>
        </div>

        <ReviewForm appointmentId={appointment.id} />
      </div>
    </div>
  );
}
