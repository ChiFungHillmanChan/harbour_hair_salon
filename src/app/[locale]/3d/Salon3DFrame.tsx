'use client';

import { useEffect, useRef } from 'react';

/** The standalone scene is requested only when this route's frame is visible. */
export default function Salon3DFrame({ title }: { title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof IntersectionObserver === 'undefined') return;

    let visible = true;
    const notifyVisibility = () => {
      frame.contentWindow?.postMessage({ type: 'harbour:visibility', visible }, window.location.origin);
    };
    // Re-send after navigation because the first observation can precede load.
    frame.addEventListener('load', notifyVisibility);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      notifyVisibility();
    });
    observer.observe(frame);

    return () => {
      observer.disconnect();
      frame.removeEventListener('load', notifyVisibility);
    };
  }, []);

  return (
    <iframe
      ref={frameRef}
      src="/harbour-hair-3d.html"
      title={title}
      loading="lazy"
      allow="fullscreen"
      allowFullScreen
      className="block h-full w-full border-0"
    />
  );
}
