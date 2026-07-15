"use client";

import { useLayoutEffect, useRef } from "react";

/** Draw duration (stroke): 2× faster than the prior ~3.33s pass → ~1.67s */
const DRAW_MS = Math.round((5000 / 1.5) / 2);

/**
 * Success check: mint circle pops (CSS), stroke draws via Web Animations API (reliable on SVG).
 */
export function SignupSuccessCheck({
  celebrate,
  onDrawComplete,
}: {
  celebrate: boolean;
  onDrawComplete: () => void;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const doneRef = useRef(false);

  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path) {
      return;
    }

    doneRef.current = false;
    let cancelled = false;
    let animation: Animation | undefined;
    let safetyTimer: ReturnType<typeof setTimeout> | undefined;

    const clearSafety = () => {
      if (safetyTimer !== undefined) {
        clearTimeout(safetyTimer);
        safetyTimer = undefined;
      }
    };

    const finishOnce = () => {
      if (cancelled || doneRef.current) {
        return;
      }
      doneRef.current = true;
      clearSafety();
      onDrawComplete();
    };

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "0";
      queueMicrotask(finishOnce);
      return;
    }

    const len = path.getTotalLength();
    if (!Number.isFinite(len) || len < 0.5) {
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "0";
      queueMicrotask(finishOnce);
      return;
    }

    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;

    safetyTimer = setTimeout(finishOnce, DRAW_MS + 900);

    requestAnimationFrame(() => {
      if (cancelled || !pathRef.current) {
        return;
      }
      const el = pathRef.current;

      if (typeof el.animate !== "function") {
        el.style.setProperty("--signup-dash", `${len}`);
        el.classList.add("signup-success-check-path-css-fallback");
        return;
      }

      try {
        animation = el.animate(
          [{ strokeDashoffset: `${len}` }, { strokeDashoffset: "0" }],
          {
            duration: DRAW_MS,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "forwards",
          },
        );
        animation.onfinish = () => finishOnce();
      } catch {
        el.style.setProperty("--signup-dash", `${len}`);
        el.classList.add("signup-success-check-path-css-fallback");
      }
    });

    return () => {
      cancelled = true;
      clearSafety();
      animation?.cancel();
      path.classList.remove("signup-success-check-path-css-fallback");
      path.style.removeProperty("--signup-dash");
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "";
    };
  }, [onDrawComplete]);

  return (
    <div
      className={[
        "signup-success-mark signup-success-mark-pop mx-auto flex shrink-0 items-center justify-center rounded-full",
        celebrate ? "h-[5.5rem] w-[5.5rem]" : "h-14 w-14",
      ].join(" ")}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className={["shrink-0 overflow-visible fill-none", celebrate ? "h-11 w-11" : "h-8 w-8"].join(" ")}
        aria-hidden
      >
        <path
          ref={pathRef}
          className="signup-success-check-path"
          d="M4 12L9 17L20 6"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}
