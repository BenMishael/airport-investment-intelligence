"use client";

import { ArrowRight, Check, EnvelopeSimple, WifiHigh, WifiSlash } from "@phosphor-icons/react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { MotionAsset } from "@/components/motion/MotionAsset";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getSupabase } from "@/lib/supabase/client";
import styles from "./SignIn.module.css";

type AuthLike = { status?: number; statusCode?: number; code?: string; message?: string };

function authStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const item = error as AuthLike;
  return item.status || item.statusCode || 0;
}

function isOperationalAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const item = error as AuthLike & { name?: string };
  const status = authStatus(error);
  const code = (item.code || "").toLowerCase();
  const name = item.name || "";
  const message = item.message || "";
  const blob = `${name} ${code} ${message}`;
  if (/AuthRetryableFetchError|Failed to fetch|NetworkError|fetch failed|ERR_CONNECTION|abort/i.test(blob)) {
    return true;
  }
  return status === 429 || status >= 500 || code.includes("rate_limit") || /rate limit|over_email|html|internal/i.test(blob);
}

export function SignIn({ configured, notice = "" }: { configured: boolean; notice?: string }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [online, setOnline] = useState(true);
  const otpRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (step === "otp") requestAnimationFrame(() => otpRef.current?.focus());
  }, [step]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  async function requestCode() {
    if (!configured || busy || !email.trim()) return;
    setBusy(true);
    setInvalid(false);
    setFailed(false);
    try {
      const { error } = await getSupabase().auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: false },
      });
      if (error && isOperationalAuthError(error)) {
        setFailed(true);
        setMessage("We could not send a code right now. Try again in a moment.");
        return;
      }
      setMessage("If this email is authorized, an eight-digit code is on its way.");
      setResendIn(60);
      setStep("otp");
    } catch {
      setFailed(true);
      setMessage("We could not request a code. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setInvalid(false);
    setFailed(false);
    try {
      const { error } = await getSupabase().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: token.trim(),
        type: "email",
      });
      if (!error) {
        setMessage("Signed in.");
        return;
      }
      if (isOperationalAuthError(error)) {
        setFailed(true);
        setMessage("The code could not be verified. Try again.");
        return;
      }
      setInvalid(true);
      setMessage("The code is invalid or expired. Request a new code and try again.");
    } catch {
      setFailed(true);
      setMessage("The code could not be verified. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const transition = reduced ? { duration: 0.09 } : { duration: 0.24 };
  return (
    <main className={styles.shell}>
      <section className={styles.visual} aria-label="Connected airport evidence network">
        <div className={styles.visualHeader}>
          <BrandMark />
          <span>Airport Intelligence</span>
        </div>
        <div className={styles.visualCopy}>
          <p className="eyebrow">Private interview workspace</p>
          <h2>
            Connected evidence for <em>sharper decisions.</em>
          </h2>
          <p>Public aviation data, deterministic scoring, and source-bound explanations in one focused workspace.</p>
        </div>
        <MotionAsset
          className={styles.network}
          src="/assets/motion/route-network.json"
          posterSrc="/assets/posters/route-network-poster.svg"
          alt="Abstract world map of connected airports"
          priority
        />
      </section>
      <section className={styles.formPanel} aria-labelledby="sign-in-title">
        <div className={styles.formBrand}>
          <BrandMark />
          <span>Airport Intelligence</span>
        </div>
        <div className={styles.theme}>
          <ThemeToggle />
        </div>
        <div className={styles.formWrap}>
          <p className="eyebrow">Secure access</p>
          <h1 id="sign-in-title">
            Airport intelligence, <em>by invitation.</em>
          </h1>
          <p className={styles.lead}>
            Use an approved email address. We&apos;ll send a one-time code—no password or account setup required.
          </p>
          {!configured && (
            <div className={styles.error} role="alert">
              Supabase public settings are missing. Add them to <code>.env.local</code>.
            </div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            {step === "email" ? (
              <m.form
                key="email"
                onSubmit={(event) => {
                  event.preventDefault();
                  void requestCode();
                }}
                className={styles.form}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
                transition={transition}
              >
                <label htmlFor="email">Email address</label>
                <div className={styles.inputWrap}>
                  <EnvelopeSimple size={20} aria-hidden="true" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
                <button className={styles.primary} disabled={!configured || busy || !email.trim() || !online}>
                  {busy ? (
                    "Sending…"
                  ) : (
                    <>
                      Send sign-in code <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </m.form>
            ) : (
              <m.form
                key="otp"
                onSubmit={verifyCode}
                className={styles.form}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
                transition={transition}
              >
                <div className={styles.codeHeader}>
                  <label htmlFor="otp">Eight-digit code</label>
                  <span>{email}</span>
                </div>
                <m.div className={`${styles.otp} ${invalid ? styles.otpInvalid : ""}`}>
                  <input
                    ref={otpRef}
                    id="otp"
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{8}"
                    maxLength={8}
                    required
                    value={token}
                    onChange={(event) => {
                      setToken(event.target.value.replace(/\D/g, ""));
                      setInvalid(false);
                    }}
                    placeholder="00000000"
                    aria-invalid={invalid}
                  />
                  <div aria-hidden="true">
                    {Array.from({ length: 8 }, (_, index) => (
                      <span className={token[index] ? styles.filled : ""} key={index}>
                        {token[index] || ""}
                        {token[index] && <Check size={9} weight="bold" />}
                      </span>
                    ))}
                  </div>
                </m.div>
                <button className={styles.primary} disabled={busy || token.length !== 8}>
                  {busy ? (
                    "Verifying…"
                  ) : (
                    <>
                      Open workspace <ArrowRight size={18} />
                    </>
                  )}
                </button>
                <div className={styles.recovery}>
                  <button type="button" onClick={() => void requestCode()} disabled={busy || resendIn > 0}>
                    {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setToken("");
                      setMessage("");
                      setInvalid(false);
                      setFailed(false);
                    }}
                  >
                    Use another email
                  </button>
                </div>
              </m.form>
            )}
          </AnimatePresence>
          {(message || notice) && (
            <p
              className={`${styles.message} ${invalid || failed || (!message && notice) ? styles.messageError : ""}`}
              role={invalid || failed || (!message && notice) ? "alert" : "status"}
            >
              {message || notice}
            </p>
          )}
          <div className={styles.meta}>
            <span>
              {online ? <WifiHigh size={16} /> : <WifiSlash size={16} />}
              {online ? "Connected" : "Offline"}
            </span>
            <span>Codes expire after 10 minutes</span>
          </div>
        </div>
      </section>
    </main>
  );
}
