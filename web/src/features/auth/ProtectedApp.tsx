"use client";

import { Database, ShieldCheck } from "@phosphor-icons/react";
import { m, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import { Header } from "@/components/Header";
import { BrandMark } from "@/components/BrandMark";
import { Workspace } from "@/features/chat/Workspace";
import { SignIn } from "./SignIn";
import { useAuth } from "./AuthProvider";
import styles from "./ProtectedApp.module.css";

export const footerSources = [
  {
    label: "BTS",
    href: "https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ",
    title: "BTS Reporting Carrier On-Time Performance",
  },
  {
    label: "FAA",
    href: "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger",
    title: "FAA passenger boarding data",
  },
  {
    label: "NOAA",
    href: "https://aviationweather.gov/",
    title: "NOAA Aviation Weather Center",
  },
  {
    label: "Census",
    href: "https://www.census.gov/programs-surveys/acs.html",
    title: "U.S. Census American Community Survey",
  },
  {
    label: "BLS",
    href: "https://www.bls.gov/",
    title: "U.S. Bureau of Labor Statistics",
  },
] as const;

export function FooterSources() {
  return (
    <nav className={styles.sources} aria-label="Public data sources">
      {footerSources.map((source, index) => (
        <span key={source.label}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          <a href={source.href} target="_blank" rel="noreferrer noopener" title={source.title}>
            {source.label}
          </a>
        </span>
      ))}
    </nav>
  );
}

export function ProtectedApp() {
  const { session, loading, configured, notice, signOut } = useAuth();
  const [active, setActive] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const reduced = useReducedMotion();
  const handleUnauthorized = useCallback(() => {
    void signOut("expired");
  }, [signOut]);
  if (loading)
    return (
      <main className={styles.loading}>
        <m.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <BrandMark />
        </m.span>
        <p>Restoring secure session…</p>
      </main>
    );
  if (!session) return <SignIn configured={configured} notice={notice} />;
  return (
    <>
      <Header
        email={session.user.email || "Authorized user"}
        onSignOut={() => void signOut()}
        onOpenHistory={() => setHistoryOpen(true)}
      />
      <main id="top">
        <Workspace
          accessToken={session.access_token}
          onUnauthorized={handleUnauthorized}
          historyOpen={historyOpen}
          onHistoryOpenChange={setHistoryOpen}
          onActiveChange={setActive}
          intro={
            <m.section
              className={`${styles.overview} ${active ? styles.compact : ""}`}
              layout={!reduced}
              aria-labelledby="workspace-title"
            >
              <p className="eyebrow">US aviation · verified public data · FAA CY2025 / BTS CY2024</p>
              <h1 id="workspace-title">
                See airport opportunity <em>in context.</em>
              </h1>
              <p className={styles.intro}>
                Compare demand, route mix, and operational pressure with every number tied to a source, date, formula,
                and caveat.
              </p>
              <div className={styles.trust}>
                <span>
                  <Database size={17} />
                  Deterministic metrics
                </span>
                <span>
                  <ShieldCheck size={17} />
                  Evidence-constrained AI
                </span>
              </div>
            </m.section>
          }
        />
      </main>
      <footer className={styles.footer}>
        <FooterSources />
        <span>Airport Investment Intelligence</span>
      </footer>
    </>
  );
}
