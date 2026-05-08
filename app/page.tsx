"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BookHomepage from "@/components/BookHomepage";
import { hasAuthSession } from "@/lib/auth-session";
import { useAuth } from "@/lib/hooks/use-auth";
import { MANUAL_HOME_FADE_IN_KEY } from "@/lib/manual-home-fade";

/**
 * Match the auth book-card feel (login ~500ms ease-out + slight rise).
 * Slightly longer so the homepage manual read as a clear fade-in, not a pop.
 */
/** Homepage manual fade (enter/exit to login); 2× the prior 580ms for a slower reveal. */
const MANUAL_FADE_MS = 1160;

type ManualMotion = { opacity: number; translateY: number };

const manualVisible: ManualMotion = { opacity: 1, translateY: 0 };
const manualHidden: ManualMotion = { opacity: 0, translateY: 24 };

/**
 * Public marketing home — interactive manual preview book.
 * Authenticated staff are sent straight to `/dashboard` (single folder-library UI).
 */
export default function HomePage() {
  const router = useRouter();
  const auth = useAuth();
  const [isHydrated, setIsHydrated] = useState(false);
  const [manualMotion, setManualMotion] = useState<ManualMotion>(manualVisible);
  const isLoggedIn = hasAuthSession(auth);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  /**
   * After closing sign-in / sign-up: start hidden, then fade + rise like the auth card.
   * Double rAF commits opacity 0 to the screen before moving to 1 so the CSS transition
   * actually runs (setTimeout(0) alone often skips the animation).
   */
  useLayoutEffect(() => {
    try {
      if (sessionStorage.getItem(MANUAL_HOME_FADE_IN_KEY) !== "1") return;
      sessionStorage.removeItem(MANUAL_HOME_FADE_IN_KEY);
      setManualMotion(manualHidden);
    } catch {
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setManualMotion(manualVisible);
      });
    });
  }, []);

  useEffect(() => {
    if (!isHydrated || !isLoggedIn) return;
    router.replace("/dashboard");
  }, [isHydrated, isLoggedIn, router]);

  const openLogin = useCallback(() => {
    setManualMotion(manualHidden);
    window.setTimeout(() => router.push("/login"), MANUAL_FADE_MS);
  }, [router]);

  if (isHydrated && isLoggedIn) {
    return (
      <div
        className="min-h-[100dvh] w-full bg-[#f4f1ec]"
        aria-busy
        aria-live="polite"
        aria-label="Redirecting to dashboard…"
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        opacity: manualMotion.opacity,
        transform: `translateY(${manualMotion.translateY}px)`,
        transition: `opacity ${MANUAL_FADE_MS}ms ease-out, transform ${MANUAL_FADE_MS}ms ease-out`,
      }}
    >
      <BookHomepage onLoginClick={openLogin} />
    </div>
  );
}
