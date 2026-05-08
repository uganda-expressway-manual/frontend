"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/api";
import { markManualShouldFadeInOnHome } from "@/lib/manual-home-fade";
import { SignupSuccessCheck } from "@/components/signup-success-check";

/* ── Design tokens (matches login page exactly) ── */
const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody  = "'Source Serif 4', Georgia, serif";
const C = {
  navy:   "#1a2744",
  gold:   "#c97c2a",
  paper:  "#faf8f3",
  bg:     "#f4f1ec",
  border: "#d0c4aa",
  muted:  "#8a7a60",
  green:  "#2d6a3a",
};

/** Book card entrance / exit (X button fades out then navigates). */
const AUTH_CARD_MS = 520;

type AuthStep = "email" | "password";

function signupPasswordChecks(pw: string) {
  const t = pw.trim();
  return {
    lengthOk:  t.length >= 8,
    lowerOk:   /[a-z]/.test(t),
    upperOk:   /[A-Z]/.test(t),
    digitOk:   /\d/.test(t),
    specialOk: /[^A-Za-z0-9]/.test(t),
  };
}

function signupPasswordValidationMessage(pw: string): string | undefined {
  const t = pw.trim();
  if (!t)                      return "Enter a password.";
  if (t.length < 8)            return "Must be at least 8 characters.";
  if (!/[a-z]/.test(t))        return "Include one lowercase letter (a-z).";
  if (!/[A-Z]/.test(t))        return "Include one uppercase letter (A-Z).";
  if (!/\d/.test(t))           return "Include at least one number (0-9).";
  if (!/[^A-Za-z0-9]/.test(t)) return "Include a special character (e.g. *&!).";
  return undefined;
}

/* ── Sub-components (mirrors login page) ── */

type UnderlineFieldProps = {
  id: string; type: string; label: string; value: string;
  autoComplete?: string; placeholder?: string;
  focused: boolean; onFocus: () => void; onBlur: () => void;
  onChange: (v: string) => void;
  required?: boolean; minLength?: number; maxLength?: number;
  suffix?: React.ReactNode; error?: boolean;
};

function UnderlineField({
  id, type, label, value, autoComplete, placeholder,
  focused, onFocus, onBlur, onChange, required, minLength, maxLength, suffix, error,
}: UnderlineFieldProps) {
  const borderColor = error ? "#c0392b" : focused ? C.gold : C.border;
  return (
    <div>
      <label htmlFor={id} style={{
        display: "block", fontFamily: fontBody,
        fontSize: 10, textTransform: "uppercase", letterSpacing: "0.16em",
        color: C.navy, fontWeight: 600, marginBottom: 6,
      }}>
        {label}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          id={id} type={type} autoComplete={autoComplete}
          value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} required={required}
          minLength={minLength} maxLength={maxLength}
          onFocus={onFocus} onBlur={onBlur}
          style={{
            flex: 1, background: "transparent",
            border: "none",
            borderBottom: `${error || focused ? "1.5px" : "1px"} solid ${borderColor}`,
            padding: "8px 0",
            fontFamily: fontBody, fontSize: 14, color: C.navy,
            outline: "none", borderRadius: 0,
            transition: "border-color 200ms",
          }}
        />
        {suffix && <div style={{ marginLeft: 8 }}>{suffix}</div>}
      </div>
    </div>
  );
}

function SubmitButton({
  pending, disabled, label, pendingLabel,
}: { pending: boolean; disabled?: boolean; label: string; pendingLabel: string }) {
  const [hovered, setHovered] = useState(false);
  const isDisabled = pending || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", padding: "13px 0", marginTop: 28,
        fontFamily: fontBody, fontSize: 14,
        letterSpacing: "0.08em", color: "white",
        background: isDisabled ? "#c8b89a" : hovered ? C.gold : C.navy,
        border: "none", borderRadius: 3,
        cursor: isDisabled ? "not-allowed" : "pointer",
        transition: "background 200ms",
        textAlign: "center",
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

const PW_RULES = [
  { key: "lengthOk",  label: "At least 8 characters" },
  { key: "lowerOk",  label: "One lowercase letter (a–z)" },
  { key: "upperOk",  label: "One uppercase letter (A–Z)" },
  { key: "digitOk",  label: "At least one number (0–9)" },
  { key: "specialOk",label: "One special character (e.g. *&!)" },
] as const;

export default function SignUpPage() {
  const router = useRouter();
  const [step,                  setStep]                  = useState<AuthStep>("email");
  const [email,                 setEmail]                 = useState("");
  const [username,              setUsername]              = useState("");
  const [password,              setPassword]              = useState("");
  const [registrationSucceeded, setRegistrationSucceeded] = useState(false);
  const [successRevealPhase,    setSuccessRevealPhase]    = useState<"celebrate" | "details">("celebrate");
  const [isPasswordHidden,      setIsPasswordHidden]      = useState(true);
  const [passwordSubmitRejected,setPasswordSubmitRejected]= useState(false);
  const [passwordBlinkTick,     setPasswordBlinkTick]     = useState(0);
  const [focusedField,          setFocusedField]          = useState<string | null>(null);
  const [mounted,               setMounted]               = useState(false);
  const [exiting,               setExiting]               = useState(false);

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    }, AUTH_CARD_MS);
  };

  const handleSignupCheckComplete = useCallback(() => {
    setSuccessRevealPhase("details");
  }, []);

  useEffect(() => {
    if (!registrationSucceeded) return;
    const reduced = typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setSuccessRevealPhase(reduced ? "details" : "celebrate");
  }, [registrationSucceeded]);

  useEffect(() => {
    if (!registrationSucceeded || successRevealPhase !== "celebrate") return;
    const id = window.setTimeout(() => {
      setSuccessRevealPhase(p => p === "celebrate" ? "details" : p);
    }, 2000);
    return () => window.clearTimeout(id);
  }, [registrationSucceeded, successRevealPhase]);

  useEffect(() => {
    if (!passwordBlinkTick) return;
    const el = passwordInputRef.current;
    if (!el) return;
    el.classList.remove("signup-password-input-blink");
    void el.offsetWidth;
    el.classList.add("signup-password-input-blink");
    const done = () => el.classList.remove("signup-password-input-blink");
    el.addEventListener("animationend", done, { once: true });
    return () => el.removeEventListener("animationend", done);
  }, [passwordBlinkTick]);

  const signUpMutation = useMutation({
    mutationFn: async () => signUp(email.trim(), password, username.trim()),
    onSuccess: () => setRegistrationSucceeded(true),
  });

  const onSubmitEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedUser  = username.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return;
    if (!trimmedUser) return;
    setEmail(trimmedEmail);
    setUsername(trimmedUser);
    setStep("password");
  };

  const goBackToEmailStep = () => {
    setStep("email");
    setPassword("");
    setPasswordSubmitRejected(false);
    signUpMutation.reset();
  };

  const onSubmitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const msg = signupPasswordValidationMessage(password);
    if (msg) {
      setPasswordSubmitRejected(true);
      setPasswordBlinkTick(n => n + 1);
      queueMicrotask(() => passwordInputRef.current?.focus());
      return;
    }
    setPasswordSubmitRejected(false);
    signUpMutation.mutate();
  };

  const pwChecks = signupPasswordChecks(password);
  const allPwMet = pwChecks.lengthOk && pwChecks.lowerOk && pwChecks.upperOk && pwChecks.digitOk && pwChecks.specialOk;

  const errorMessage = (() => {
    if (!signUpMutation.error) return "";
    if (axios.isAxiosError(signUpMutation.error)) {
      const apiMsg = (signUpMutation.error.response?.data as { message?: string } | undefined)?.message
        ?? signUpMutation.error.message;
      return apiMsg || "Could not create account. Try again.";
    }
    if (signUpMutation.error instanceof Error) return signUpMutation.error.message || "Could not create account. Try again.";
    return "Could not create account. Try again.";
  })();

  return (
    <div style={{
      minHeight: "100dvh",
      background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 16px",
      backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 22px,rgba(0,0,0,0.018) 22px,rgba(0,0,0,0.018) 23px)",
    }}>
      {/* ── Open book card ── */}
      <div style={{
        display: "flex",
        width: "min(900px, 100%)",
        minHeight: 560,
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.08)",
        opacity:   cardVisible ? 1 : 0,
        transform: cardVisible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity ${AUTH_CARD_MS}ms ease-out, transform ${AUTH_CARD_MS}ms ease-out`,
        pointerEvents: exiting ? "none" : "auto",
        flexDirection: "row",
      }}>

        {/* ── Left page: brand cover ── */}
        <div style={{
          flex: "0 0 45%",
          position: "relative",
          background: C.navy,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
          minHeight: 200,
          borderRadius: "6px 0 0 6px",
        }}>
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
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(160deg, rgba(10,18,40,0.45) 0%, rgba(10,18,40,0.82) 100%)",
          }} />
          <div style={{
            position: "relative", zIndex: 1,
            textAlign: "center", padding: "0 28px",
            display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            <p style={{
              fontFamily: fontBody, fontSize: 9, color: C.gold,
              letterSpacing: "0.18em", textTransform: "uppercase",
              marginBottom: 16,
            }}>
              Ministry of Works &amp; Transport
            </p>
            <h1 style={{
              fontFamily: fontSerif, fontSize: 24, fontWeight: 700,
              color: "white", lineHeight: 1.2, marginBottom: 0,
            }}>
              Expressway<br />Integrated Manual
            </h1>
            <div style={{
              width: 36, height: 1.5, background: C.gold,
              margin: "14px 0",
            }} />
            <p style={{
              fontFamily: fontBody, fontSize: 13, fontStyle: "italic",
              color: "rgba(255,255,255,0.65)", lineHeight: 1.6,
            }}>
              Create your account to access<br />the complete reference library
            </p>
            {/* Partner pills */}
            <div style={{
              position: "absolute", bottom: 28,
              display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center",
            }}>
              {["EX", "DOHWA", "CHEIL", "KOICA"].map(name => (
                <span key={name} style={{
                  fontFamily: fontSerif, fontSize: 9,
                  color: "rgba(255,255,255,0.45)",
                  border: "0.5px solid rgba(255,255,255,0.2)",
                  padding: "3px 8px", borderRadius: 2,
                  letterSpacing: "0.06em",
                }}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Center spine binding ── */}
        <div style={{
          width: 14, flexShrink: 0,
          background: "linear-gradient(90deg,#c8b89a,#e0d4bb,#c8b89a)",
          boxShadow: "inset 1px 0 3px rgba(0,0,0,0.12), inset -1px 0 3px rgba(0,0,0,0.12)",
        }} />

        {/* ── Right page: form ── */}
        <div style={{
          flex: 1,
          background: C.paper,
          backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 24px,rgba(180,160,120,0.06) 24px,rgba(180,160,120,0.06) 25px)",
          padding: "40px 44px",
          display: "flex", flexDirection: "column", justifyContent: "center",
          position: "relative",
          borderRadius: "0 6px 6px 0",
          overflow: "hidden",
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

          {/* Success state */}
          {registrationSucceeded ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", textAlign: "center", gap: 20,
            }}>
              {/* Gold/navy flavored success check */}
              <div style={{
                background: "rgba(201,124,42,0.1)", borderRadius: "50%",
                padding: 12, display: "inline-flex",
              }}>
                <SignupSuccessCheck
                  celebrate={successRevealPhase === "celebrate"}
                  onDrawComplete={handleSignupCheckComplete}
                />
              </div>
              {successRevealPhase === "details" && (
                <>
                  <div>
                    <h2 style={{ fontFamily: fontSerif, fontSize: 22, fontWeight: 700, color: C.navy, marginBottom: 6 }}>
                      Account created
                    </h2>
                    <div style={{ width: 28, height: 1.5, background: C.gold, margin: "0 auto 14px" }} />
                    <p style={{ fontFamily: fontBody, fontSize: 14, color: C.muted, lineHeight: 1.6, maxWidth: 280 }}>
                      An administrator needs to approve your access before you can sign in. We&apos;ll email{" "}
                      <span style={{ color: C.navy, fontWeight: 600 }}>{email.trim()}</span> when you&apos;re ready.
                    </p>
                  </div>
                  <Link
                    href="/login"
                    style={{
                      display: "block", width: "100%", maxWidth: 280,
                      padding: "13px 0", textAlign: "center",
                      fontFamily: fontBody, fontSize: 14, letterSpacing: "0.08em",
                      color: "white", background: C.navy,
                      border: "none", borderRadius: 3, textDecoration: "none",
                      transition: "background 200ms",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = C.gold; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = C.navy; }}
                  >
                    Continue to sign in
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              {/* ── Step indicator ── */}
              <StepIndicator step={step} />

              {/* ── Heading ── */}
              <div style={{ marginBottom: 24 }}>
                <h2 style={{
                  fontFamily: fontSerif, fontSize: 22, fontWeight: 700,
                  color: C.navy, marginBottom: 8,
                }}>
                  {step === "email" ? "Create your account" : "Choose a password"}
                </h2>
                <div style={{ width: 28, height: 1.5, background: C.gold }} />
              </div>

              {/* ── Step slider ── */}
              <div style={{ overflow: "hidden", flex: 1 }}>
                <div style={{
                  display: "flex",
                  width: "200%",
                  transform: step === "email" ? "translateX(0)" : "translateX(-50%)",
                  transition: "transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                }}>
                  {/* Step 1: Account details */}
                  <div style={{ width: "50%", paddingRight: 20 }}>
                    <form onSubmit={onSubmitEmail} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                      <UnderlineField
                        id="signup-email" type="email" label="Email address"
                        value={email} autoComplete="email"
                        placeholder="you@example.com"
                        focused={focusedField === "email"}
                        onFocus={() => setFocusedField("email")}
                        onBlur={() => setFocusedField(null)}
                        onChange={v => setEmail(v)}
                        required
                      />
                      <UnderlineField
                        id="signup-username" type="text" label="Username"
                        value={username} autoComplete="username"
                        placeholder="How you'll appear in the system"
                        focused={focusedField === "username"}
                        onFocus={() => setFocusedField("username")}
                        onBlur={() => setFocusedField(null)}
                        onChange={v => setUsername(v)}
                        required minLength={2} maxLength={64}
                      />
                      <SubmitButton pending={false} label="Continue →" pendingLabel="Continue →" />
                    </form>

                    <p style={{ marginTop: 20, textAlign: "center", fontFamily: fontBody, fontSize: 13, color: C.muted }}>
                      Already have an account?{" "}
                      <Link href="/login"
                        style={{ color: C.gold, textDecoration: "none" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                      >
                        Sign in
                      </Link>
                    </p>
                  </div>

                  {/* Step 2: Password */}
                  <div style={{ width: "50%", paddingRight: 0 }}>
                    {/* Back arrow */}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={goBackToEmailStep}
                      onKeyDown={e => e.key === "Enter" && goBackToEmailStep()}
                      style={{
                        display: "inline-block", cursor: "pointer",
                        fontFamily: fontBody, fontSize: 13, color: C.gold,
                        marginBottom: 16, userSelect: "none",
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.opacity = "0.7"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.opacity = "1"; }}
                    >
                      ← Back
                    </span>

                    <form noValidate lang="en" onSubmit={onSubmitPassword}
                      style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {/* Password field with show/hide */}
                      <div>
                        <label htmlFor="signup-password" style={{
                          display: "block", fontFamily: fontBody,
                          fontSize: 10, textTransform: "uppercase", letterSpacing: "0.16em",
                          color: C.navy, fontWeight: 600, marginBottom: 6,
                        }}>
                          Password
                        </label>
                        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                          <input
                            ref={passwordInputRef}
                            id="signup-password"
                            type={isPasswordHidden ? "password" : "text"}
                            autoComplete="new-password"
                            value={password}
                            onChange={e => {
                              const v = e.target.value;
                              setPassword(v);
                              const c = signupPasswordChecks(v);
                              if (c.lengthOk && c.lowerOk && c.upperOk && c.digitOk && c.specialOk) {
                                setPasswordSubmitRejected(false);
                              }
                            }}
                            onFocus={() => setFocusedField("password")}
                            onBlur={() => setFocusedField(null)}
                            aria-describedby="signup-pw-hint"
                            aria-invalid={passwordSubmitRejected ? true : undefined}
                            style={{
                              flex: 1, background: "transparent",
                              border: "none",
                              borderBottom: `${passwordSubmitRejected ? "1.5px solid #c0392b" : focusedField === "password" ? `1.5px solid ${C.gold}` : `1px solid ${C.border}`}`,
                              padding: "8px 0",
                              fontFamily: fontBody, fontSize: 14, color: C.navy,
                              outline: "none", borderRadius: 0,
                              transition: "border-color 200ms",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setIsPasswordHidden(p => !p)}
                            aria-label={isPasswordHidden ? "Show password" : "Hide password"}
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              color: isPasswordHidden ? C.muted : C.gold,
                              padding: "0 2px", marginLeft: 8,
                              transition: "color 150ms",
                            }}
                          >
                            {isPasswordHidden ? (
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                <path d="M3 3l18 18" /><path d="M10.58 10.58a2 2 0 102.84 2.84" />
                                <path d="M9.88 5.09A10.94 10.94 0 0112 5c5.05 0 9.27 3.11 10 7-.21 1.13-.73 2.2-1.5 3.11" />
                                <path d="M6.61 6.61C4.62 7.9 3.26 9.82 3 12c.73 3.89 4.95 7 10 7 2.18 0 4.2-.58 5.9-1.59" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Inline password rules — no card, no box */}
                      <ul
                        id="signup-pw-hint"
                        aria-label="Password requirements"
                        aria-live="polite"
                        style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 5 }}
                      >
                        {PW_RULES.map(({ key, label }) => {
                          const ok = pwChecks[key];
                          return (
                            <li key={key} style={{
                              display: "flex", alignItems: "center", gap: 8,
                              fontFamily: fontBody, fontSize: 12,
                              color: ok ? C.green : C.muted,
                              transition: "color 200ms",
                            }}>
                              <span style={{
                                fontSize: 11, lineHeight: 1,
                                color: ok ? C.gold : "#ccc",
                                transition: "color 200ms", flexShrink: 0,
                              }}>
                                {ok ? "✓" : "○"}
                              </span>
                              {label}
                            </li>
                          );
                        })}
                      </ul>

                      <SubmitButton
                        pending={signUpMutation.isPending}
                        disabled={!allPwMet && !signUpMutation.isPending}
                        label="Create account"
                        pendingLabel="Creating your account…"
                      />
                    </form>

                    {signUpMutation.error && (
                      <p role="alert" style={{ marginTop: 12, fontFamily: fontBody, fontSize: 12, color: "#c0392b" }}>
                        {errorMessage}
                      </p>
                    )}

                    <p style={{ marginTop: 20, textAlign: "center", fontFamily: fontBody, fontSize: 13, color: C.muted }}>
                      Already have an account?{" "}
                      <Link href="/login"
                        style={{ color: C.gold, textDecoration: "none" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                      >
                        Sign in
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile responsive */}
      <style>{`
        @media (max-width: 768px) {
          .signup-book-card { flex-direction: column !important; }
          .signup-book-left { flex: 0 0 140px !important; min-height: 140px !important; border-radius: 6px 6px 0 0 !important; }
          .signup-book-binding { width: 100% !important; height: 10px !important; background: linear-gradient(180deg,#c8b89a,#e0d4bb,#c8b89a) !important; }
        }
        @keyframes signup-pw-blink {
          0%,100% { border-color: #c0392b; }
          50%     { border-color: transparent; }
        }
        .signup-password-input-blink { animation: signup-pw-blink 420ms ease 3; }
        @keyframes signup-btn-pulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

function StepIndicator({ step }: { step: AuthStep }) {
  const isStep1 = step === "email";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      marginBottom: 22,
    }}>
      {/* Dots */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: isStep1 ? C.navy : "transparent",
          border: `1.5px solid ${isStep1 ? C.navy : C.gold}`,
          display: "inline-block", transition: "all 200ms",
        }} />
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: !isStep1 ? C.navy : "transparent",
          border: `1.5px solid ${!isStep1 ? C.navy : C.gold}`,
          display: "inline-block", transition: "all 200ms",
        }} />
      </div>
      {/* Label */}
      <div style={{ position: "relative" }}>
        <span style={{
          fontFamily: "'Source Serif 4', Georgia, serif",
          fontSize: 11, textTransform: "uppercase",
          letterSpacing: "0.14em", color: C.muted,
        }}>
          {isStep1 ? "Step 1 of 2  ·  Account Details" : "Step 2 of 2  ·  Set Password"}
        </span>
        {/* Gold underline under current step */}
        <div style={{
          position: "absolute", bottom: -3, left: 0,
          width: 20, height: 1, background: C.gold,
          transition: "width 200ms",
        }} />
      </div>
    </div>
  );
}
