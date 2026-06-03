"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { getBackendErrorMessage } from "@/lib/api-errors";
import { checkEmailForLogin, signIn } from "@/lib/api";
import { SignInBlockedByAccountStatusError } from "@/lib/sign-in-errors";
import { markManualShouldFadeInOnHome } from "@/lib/manual-home-fade";

/* ── Design tokens ── */
const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody  = "'Source Serif 4', Georgia, serif";
const C = {
  navy:   "#1a2744",
  gold:   "#c97c2a",
  paper:  "#faf8f3",
  bg:     "#f4f1ec",
  border: "#d0c4aa",
  muted:  "#a07848",
};

const AUTH_CHECK_EMAIL_DISABLED = process.env.NEXT_PUBLIC_AUTH_CHECK_EMAIL_DISABLED === "true";
const LOGIN_CREDENTIALS_ERROR   = "Incorrect email or password.";
/** Entrance / exit duration for the book card (exit is the reverse motion). */
const AUTH_CARD_MS = 500;

type EmailContinueAlert = null | { message: string; detail?: string; showSignupLink: boolean };
type AuthStep = "email" | "password";

const EMAIL_NOT_REGISTERED_MESSAGE = "This email is not registered. Please request access to create an account.";
const EMAIL_PENDING_APPROVAL_PRIMARY = "Awaiting admin approval.";
const EMAIL_PENDING_APPROVAL_SECONDARY = "Sign in once your account is active.";

function rejectedAccountMessage(): string {
  return new SignInBlockedByAccountStatusError("REJECTED").message;
}

export default function LoginPage() {
  const router = useRouter();
  const [step,              setStep]              = useState<AuthStep>("email");
  const [email,             setEmail]             = useState("");
  const [password,          setPassword]          = useState("");
  const [isPasswordHidden,  setIsPasswordHidden]  = useState(true);
  const [emailAlert,        setEmailAlert]        = useState<EmailContinueAlert>(null);
  const [mounted,           setMounted]           = useState(false);
  const [exiting,           setExiting]           = useState(false);
  const [focusedField,      setFocusedField]      = useState<string | null>(null);
  /** DOM timer id — avoids `Timeout` vs `number` clash when `@types/node` merges globals. */
  const exitTimerRef       = useRef<number | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => () => {
    if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
  }, []);

  const cardVisible = mounted && !exiting;
  const closeToHome = () => {
    if (exiting) return;
    markManualShouldFadeInOnHome();
    setExiting(true);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      router.replace("/");
    }, AUTH_CARD_MS) as unknown as number;
  };

  const checkEmailMutation = useMutation({
    mutationFn: (addr: string) => checkEmailForLogin(addr),
  });
  const loginMutation = useMutation({
    mutationFn: async () => signIn(email.trim(), password),
    onSuccess: () => router.replace("/dashboard"),
  });

  const onSubmitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    setEmailAlert(null);

    if (AUTH_CHECK_EMAIL_DISABLED) { setEmail(trimmed); setStep("password"); return; }

    try {
      const result = await checkEmailMutation.mutateAsync(trimmed);
      if (!result.registered) {
        setEmailAlert({ message: EMAIL_NOT_REGISTERED_MESSAGE, showSignupLink: true }); return;
      }
      if (result.status !== "APPROVED") {
        setEmailAlert({
          message: result.status === "REJECTED" ? rejectedAccountMessage() : EMAIL_PENDING_APPROVAL_PRIMARY,
          detail: result.status === "REJECTED" ? undefined : EMAIL_PENDING_APPROVAL_SECONDARY,
          showSignupLink: false,
        }); return;
      }
      setEmail(trimmed); setStep("password");
    } catch (error) {
      setEmailAlert({ message: getBackendErrorMessage(error, "Could not verify this email. Try again."), showSignupLink: false });
    }
  };

  const onSubmitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    loginMutation.mutate();
  };

  return (
    <div style={{
      minHeight: "100dvh",
      background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 16px",
      /* paper texture */
      backgroundImage:
        "repeating-linear-gradient(0deg,transparent,transparent 22px,rgba(0,0,0,0.018) 22px,rgba(0,0,0,0.018) 23px)",
    }}>
      {/* Book-spread card */}
      <div style={{
        display: "flex",
        width: "min(860px, 100%)",
        minHeight: 500,
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)",
        opacity:    cardVisible ? 1 : 0,
        transform:  cardVisible ? "translateY(0)" : "translateY(24px)",
        transition: `opacity ${AUTH_CARD_MS}ms ease-out, transform ${AUTH_CARD_MS}ms ease-out`,
        pointerEvents: exiting ? "none" : "auto",
        /* Stack on mobile */
        flexDirection: "row",
      }}>

        {/* ── Left page: brand cover ── */}
        <div style={{
          flex: "0 0 45%",
          position: "relative",
          background: C.navy,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
          /* On small screens collapse to banner */
          minHeight: 200,
        }}>
          {/* Book cover image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo/bookcover.png"
            alt=""
            aria-hidden
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%",
              objectFit: "cover", objectPosition: "center top",
            }}
          />

          {/* Dark overlay gradient */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to top, rgba(10,18,40,0.85) 0%, rgba(10,18,40,0.45) 100%)",
          }} />

        </div>

        {/* ── Center binding ── */}
        <div style={{
          flex: "0 0 12px",
          background: "linear-gradient(90deg,#c8b89a,#e0d4bb,#c8b89a)",
          boxShadow: "inset -2px 0 6px rgba(0,0,0,0.08), inset 2px 0 6px rgba(0,0,0,0.08)",
        }} />

        {/* ── Right page: login form ── */}
        <div style={{
          flex: 1,
          background: C.paper,
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 22px,rgba(0,0,0,0.025) 22px,rgba(0,0,0,0.025) 23px)",
          padding: "40px 36px 32px",
          display: "flex", flexDirection: "column", justifyContent: "center",
          position: "relative",
        }}>
          {/* Close button — fades card out then navigates home */}
          <button
            type="button"
            onClick={closeToHome}
            aria-label="Return home"
            disabled={exiting}
            style={{
              position: "absolute", top: 16, right: 16,
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: "50%",
              color: C.muted, background: "transparent", border: "none", cursor: exiting ? "default" : "pointer",
              transition: "background 150ms",
              opacity: exiting ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (!exiting) (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.06)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>

          {/* Back arrow when on password step */}
          {step === "password" && (
            <button
              type="button"
              onClick={() => { setStep("email"); setPassword(""); setEmailAlert(null); loginMutation.reset(); }}
              style={{
                position: "absolute", top: 16, left: 16,
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, borderRadius: "50%",
                color: C.muted, background: "none", border: "none", cursor: "pointer",
                transition: "background 150ms",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.06)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              aria-label="Back to email"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}

          {/* Header */}
          <div style={{ marginBottom: 28 }}>
            <h2 style={{
              fontFamily: fontSerif, fontSize: 24, fontWeight: 700,
              color: C.navy, marginBottom: 6,
            }}>
              Welcome back
            </h2>
            <p style={{
              fontFamily: fontBody, fontSize: 13, fontStyle: "italic",
              color: C.muted,
            }}>
              {step === "email"
                ? "Sign in to continue"
                : `Enter your password for ${email}`}
            </p>
          </div>

          {/* ── Email step ── */}
          {step === "email" && (
            <form onSubmit={onSubmitEmail} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <UnderlineField
                id="login-email"
                type="email"
                label="Email address"
                value={email}
                autoComplete="email"
                placeholder="you@example.com"
                focused={focusedField === "email"}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                onChange={v => { setEmail(v); setEmailAlert(null); }}
                required
              />

              {emailAlert && (
                <div role="alert" style={{
                  fontFamily: fontBody, fontSize: 12, color: "#c0392b",
                  lineHeight: 1.5,
                }}>
                  <p>{emailAlert.message}{emailAlert.showSignupLink && (
                    <> {" "}<Link href="/signup" style={{ color: C.gold }}>Sign up</Link></>
                  )}</p>
                  {emailAlert.detail && <p style={{ marginTop: 4 }}>{emailAlert.detail}</p>}
                </div>
              )}

              <SubmitButton pending={checkEmailMutation.isPending} label="Continue" pendingLabel="Checking…" />
            </form>
          )}

          {/* ── Password step ── */}
          {step === "password" && (
            <form onSubmit={onSubmitPassword} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <UnderlineField
                id="login-password"
                type={isPasswordHidden ? "password" : "text"}
                label="Password"
                value={password}
                autoComplete="current-password"
                focused={focusedField === "password"}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                onChange={setPassword}
                required
                minLength={1}
                suffix={
                  <button
                    type="button"
                    onClick={() => setIsPasswordHidden(p => !p)}
                    aria-label={isPasswordHidden ? "Show password" : "Hide password"}
                    title={isPasswordHidden ? "Show password" : "Hide password"}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: "none", border: "none", cursor: "pointer",
                      color: C.navy, padding: "4px", marginRight: -4,
                      opacity: 0.55, transition: "opacity 150ms",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.55"; }}
                  >
                    {isPasswordHidden ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M3 3l18 18" />
                        <path d="M10.58 10.58a2 2 0 102.84 2.84" />
                        <path d="M9.88 5.09A10.94 10.94 0 0112 5c5.05 0 9.27 3.11 10 7-.21 1.13-.73 2.2-1.5 3.11" />
                        <path d="M6.61 6.61C4.62 7.9 3.26 9.82 3 12c.73 3.89 4.95 7 10 7 2.18 0 4.2-.58 5.9-1.59" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                }
              />

              {loginMutation.error && (
                <p role="alert" style={{ fontFamily: fontBody, fontSize: 12, color: "#c0392b" }}>
                  {loginMutation.error instanceof SignInBlockedByAccountStatusError
                    ? loginMutation.error.message
                    : LOGIN_CREDENTIALS_ERROR}
                </p>
              )}

              <SubmitButton pending={loginMutation.isPending} label="Sign in" pendingLabel="Signing in…" />
            </form>
          )}

          {/* Divider */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            margin: "20px 0 14px",
          }}>
            <div style={{ flex: 1, height: 1, background: C.border }} />
            <span style={{ fontFamily: fontBody, fontSize: 12, fontStyle: "italic", color: C.muted }}>or</span>
            <div style={{ flex: 1, height: 1, background: C.border }} />
          </div>

          {/* Sign-up link */}
          <p style={{ textAlign: "center", fontFamily: fontBody, fontSize: 13, color: C.navy }}>
            Don&apos;t have an account?{" "}
            <Link href="/signup"
              style={{ color: C.gold, textDecoration: "none", transition: "opacity 150ms" }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>

      {/* Mobile: responsive stack handled by flex-direction media */}
      <style>{`
        @media (max-width: 600px) {
          .book-card { flex-direction: column !important; }
          .book-left { flex: 0 0 120px !important; min-height: 120px !important; }
          .book-binding { flex: 0 0 6px !important; width: 100% !important; background: linear-gradient(180deg,#c8b89a,#e0d4bb,#c8b89a) !important; }
        }
      `}</style>
    </div>
  );
}

/* ── Shared sub-components ── */

type UnderlineFieldProps = {
  id: string;
  type: string;
  label: string;
  value: string;
  autoComplete?: string;
  placeholder?: string;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
  suffix?: React.ReactNode;
};

function UnderlineField({
  id, type, label, value, autoComplete, placeholder,
  focused, onFocus, onBlur, onChange, required, minLength, suffix,
}: UnderlineFieldProps) {
  return (
    <div>
      <label htmlFor={id} style={{
        display: "block", fontFamily: fontBody,
        fontSize: 10, textTransform: "uppercase", letterSpacing: "0.10em",
        color: C.navy, fontWeight: 600, marginBottom: 8,
      }}>
        {label}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          onFocus={onFocus}
          onBlur={onBlur}
          style={{
            flex: 1, background: "transparent",
            border: "none",
            borderBottom: `2px solid ${focused ? "rgba(26,39,68,0.72)" : C.border}`,
            padding: "6px 0 8px",
            fontFamily: fontBody, fontSize: 14, color: C.navy,
            outline: "none",
            boxShadow: "none",
            borderRadius: 0,
            transition: "border-color 200ms",
            WebkitTapHighlightColor: "transparent",
          }}
        />
        {suffix && (
          <div style={{ marginLeft: 8 }}>{suffix}</div>
        )}
      </div>
    </div>
  );
}

function SubmitButton({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="submit"
      disabled={pending}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", padding: "11px 0",
        fontFamily: fontBody, fontSize: 14,
        letterSpacing: "0.06em", color: "white",
        background: hovered ? C.gold : C.navy,
        border: "none", borderRadius: 3,
        cursor: pending ? "not-allowed" : "pointer",
        opacity: pending ? 0.7 : 1,
        transition: "background 200ms, opacity 150ms",
        textAlign: "center",
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
