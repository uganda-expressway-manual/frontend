"use client";

import { useEffect, useRef, useState } from "react";

/** Space must stay encoded for the <video> src; parentheses are safe unencoded in browsers. */
const DEMO_VIDEO_SRC = "/uganda-expressway-manual%20(demo).mp4";

/**
 * Sits below the interactive book cover — reveals on scroll so it never competes with the
 * cover for attention on first paint. Fade + slight rise mirrors the book's own reveal motion.
 */
export function HomepageDemoSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="border-t border-imme-line bg-white py-16 sm:py-20 lg:py-24">
      <div className="imme-container">
        <div
          style={{
            opacity: isVisible ? 1 : 0,
            transform: `translateY(${isVisible ? 0 : 24}px)`,
            transition: "opacity 900ms ease-out, transform 900ms ease-out",
          }}
        >
          <p className="imme-eyebrow">See it in action</p>
          <h2 className="imme-h2 mt-2 max-w-2xl">Watch the manual come to life</h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-imme-muted">
            A short walkthrough of the Uganda Expressway Integrated Manual — browsing volumes,
            searching content, and navigating the interactive digital library.
          </p>
          <div className="mt-8 overflow-hidden rounded-imme border border-imme-line bg-imme-concrete shadow-imme-card">
            <video
              className="block h-auto w-full"
              src={DEMO_VIDEO_SRC}
              controls
              playsInline
              preload="metadata"
              poster="/uganda-expressway-manual-logo.png"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
