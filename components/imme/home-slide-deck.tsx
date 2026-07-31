"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Slide = {
  id: string;
  label: string;
  content: ReactNode;
};

/**
 * Paginates the public homepage into full-height slides (book preview, demo video, …)
 * instead of one long scroll. Scroll-snap moves between slides; the dot rail on the right
 * (bottom, on small screens) shows which slide is active and jumps to any slide on click.
 *
 * Deck height tracks the real, currently-rendered `<header>` height (not a hardcoded px
 * value) so slides fill exactly the space below the sticky site header on every viewport.
 */
export function HomeSlideDeck({ slides }: { slides: Slide[] }) {
  const slideRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [headerH, setHeaderH] = useState(68);

  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const measure = () => setHeaderH(header.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const targets = slideRefs.current.filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const idx = slideRefs.current.indexOf(entry.target as HTMLElement);
            if (idx !== -1) setActiveIndex(idx);
          }
        }
      },
      { threshold: [0.5] },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [slides.length]);

  const goTo = (idx: number) => {
    slideRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      style={{ height: `calc(100dvh - ${headerH}px)`, scrollbarWidth: "none", msOverflowStyle: "none" }}
      className="relative w-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden"
    >
      {slides.map((slide, i) => {
        const isActive = activeIndex === i;
        return (
          <section
            key={slide.id}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            aria-hidden={!isActive}
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              opacity: isActive ? 1 : 0,
              pointerEvents: isActive ? "auto" : "none",
              transition: "opacity 550ms ease-out",
            }}
            className="h-full w-full snap-start snap-always overflow-y-auto [&::-webkit-scrollbar]:hidden"
          >
            {slide.content}
          </section>
        );
      })}

      {slides.length > 1 ? (
        <nav
          aria-label="Homepage sections"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center gap-3 sm:inset-x-auto sm:inset-y-0 sm:right-5 sm:flex-col sm:items-center sm:justify-center sm:gap-4"
        >
          {slides.map((slide, i) => {
            const isActive = activeIndex === i;
            return (
              <button
                key={slide.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to ${slide.label}`}
                aria-current={isActive}
                className="pointer-events-auto flex h-5 w-5 items-center justify-center"
              >
                <span
                  className={[
                    "block rounded-full transition-all duration-300",
                    isActive
                      ? "h-2.5 w-2.5 bg-imme-navy shadow-[0_0_0_4px_rgba(26,45,79,0.16)]"
                      : "h-2 w-2 border border-imme-muted/30 bg-white/70 hover:border-imme-navy/50",
                  ].join(" ")}
                />
              </button>
            );
          })}
        </nav>
      ) : null}

      {slides.length > 1 && activeIndex < slides.length - 1 ? (
        <button
          type="button"
          onClick={() => goTo(activeIndex + 1)}
          aria-label={`Scroll to ${slides[activeIndex + 1].label}`}
          /* Mobile: no side margin around the portrait cover, so stay bottom-center (above the
             dot row). From `sm` up the cover leaves wide empty side margins — shift into the
             right-hand margin instead (the dot rail stays vertically centered, well above this),
             so the hint never overlaps the book art. Each axis is touched by exactly one base
             class + one `sm:` override of that same property, so the breakpoint swap is
             unambiguous regardless of Tailwind's internal utility ordering. */
          className="pointer-events-auto fixed bottom-16 left-1/2 z-30 flex w-fit -translate-x-1/2 flex-col items-center gap-2 sm:left-auto sm:right-6 sm:translate-x-0"
        >
          <span className="whitespace-nowrap rounded-full bg-white/90 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-imme-navy shadow-imme-card backdrop-blur">
            Scroll to watch the demo
          </span>
          <span className="home-scroll-hint-chevron flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-imme-navy shadow-imme-card backdrop-blur">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      ) : null}

      <style>{`
        @keyframes homeScrollHintBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(5px); }
        }
        .home-scroll-hint-chevron {
          animation: homeScrollHintBounce 1.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
