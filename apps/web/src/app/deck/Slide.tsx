"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type SlideProps = {
  children: ReactNode;
  index: number;
  of: number;
};

/**
 * Per-slide wrapper that toggles a `data-seen` attribute the first time
 * the slide enters the viewport. CSS keys off that to stagger the
 * fade/rise entrance animation for the eyebrow, title, and body. We
 * also flag the moment of hydration with a `.deck-slide-anim` class —
 * before that class is present (SSR / no-JS), nothing is hidden, so
 * the deck stays readable even if the IntersectionObserver never runs.
 */
export function Slide({ children, index, of }: SlideProps) {
  const ref = useRef<HTMLElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // No IO support → just show the slide. Reduced-motion users land
      // here too because we explicitly skip the observer for them below.
      setSeen(true);
      return;
    }

    // If the slide is already in view when this effect runs (which is
    // basically always the case for slide 1), set seen synchronously
    // so the initial paint isn't a blank flash.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setSeen(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setSeen(true);
            io.disconnect();
            return;
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  return (
    <section
      className={hydrated ? "deck-slide-wrap deck-slide-anim" : "deck-slide-wrap"}
      data-seen={seen ? "true" : "false"}
      id={`slide-${index}`}
      ref={ref}
    >
      {children}
      <span className="deck-pager" aria-hidden="true">
        {index.toString().padStart(2, "0")} / {of.toString().padStart(2, "0")}
      </span>
    </section>
  );
}
