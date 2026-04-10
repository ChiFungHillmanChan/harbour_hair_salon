'use client';

import {
  createElement,
  useEffect,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';

type RevealTag = 'div' | 'section' | 'article' | 'span' | 'li';

interface RevealProps {
  children: ReactNode;
  as?: RevealTag;
  variant?: 'up' | 'left' | 'scale';
  delay?: number;
  className?: string;
  once?: boolean;
}

export function Reveal({
  children,
  as = 'div',
  variant = 'up',
  delay = 0,
  className = '',
  once = true,
}: RevealProps) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node, once]);

  const variantClass =
    variant === 'left' ? 'reveal reveal-left' : variant === 'scale' ? 'reveal reveal-scale' : 'reveal';

  const style: CSSProperties = delay ? { transitionDelay: `${delay}ms` } : {};

  return createElement(
    as,
    {
      ref: setNode,
      className: `${variantClass} ${visible ? 'is-visible' : ''} ${className}`.trim(),
      style,
    },
    children
  );
}
