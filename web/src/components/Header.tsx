"use client";

import { ClockCounterClockwise, SignOut } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";
import styles from "./Header.module.css";

export function Header({
  email,
  onSignOut,
  onOpenHistory,
}: {
  email: string;
  onSignOut: () => void;
  onOpenHistory: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
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
  return (
    <header className={`${styles.header} ${scrolled ? styles.scrolled : ""}`}>
      <div className={styles.inner}>
        <a className={styles.brand} href="#top">
          <BrandMark />
          <span>
            Airport Intelligence<small>Investment screening workspace</small>
          </span>
        </a>
        <div className={styles.actions}>
          {online && (
            <span className={styles.status}>
              <i />
              Evidence connected
            </span>
          )}
          <button type="button" className={styles.history} onClick={onOpenHistory} aria-label="Open analysis history">
            <ClockCounterClockwise size={18} />
            <span>History</span>
          </button>
          <ThemeToggle />
          <span className={styles.email} title={email}>
            {email}
          </span>
          <button type="button" className={styles.signOut} onClick={onSignOut} aria-label="Sign out">
            <SignOut size={17} />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
