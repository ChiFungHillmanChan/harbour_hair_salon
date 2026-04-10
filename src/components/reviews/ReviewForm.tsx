'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createReview } from '@/app/actions/reviews';

interface ReviewFormProps {
  appointmentId: string;
}

export function ReviewForm({ appointmentId }: ReviewFormProps) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [state, formAction, pending] = useActionState(createReview, {});

  if (state.success) {
    setTimeout(() => router.push('/appointments'), 1500);
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-serif text-zinc-900 mb-2">Thank you!</h2>
        <p className="text-zinc-600 font-light">
          Your review has been submitted and will appear once approved.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="rating" value={rating} />

      <fieldset>
        <legend className="block text-sm font-medium text-zinc-900 mb-4 uppercase tracking-wider">
          Your rating
        </legend>
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((value) => {
            const active = (hover || rating) >= value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} star${value > 1 ? 's' : ''}`}
                onClick={() => setRating(value)}
                onMouseEnter={() => setHover(value)}
                onMouseLeave={() => setHover(0)}
                className="p-1 transition-transform hover:scale-110"
              >
                <svg
                  className={`w-10 h-10 transition-colors ${
                    active ? 'text-accent fill-accent' : 'text-zinc-300 fill-zinc-200'
                  }`}
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                  />
                </svg>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="comment"
          className="block text-sm font-medium text-zinc-900 mb-2 uppercase tracking-wider"
        >
          Tell us more <span className="text-zinc-400 normal-case tracking-normal">(optional)</span>
        </label>
        <textarea
          id="comment"
          name="comment"
          rows={5}
          maxLength={1000}
          placeholder="What did you love? Anything we could do better?"
          className="w-full border border-zinc-300 rounded-lg px-4 py-3 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent font-light"
        />
      </div>

      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || rating === 0}
        className="w-full bg-accent text-black px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-accent-light transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Submitting…' : 'Submit Review'}
      </button>
    </form>
  );
}
