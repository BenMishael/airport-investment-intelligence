"use client";

import { CaretDown } from "@phosphor-icons/react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useId, useState } from "react";

import styles from "./AnimatedDisclosure.module.css";

export function AnimatedDisclosure({
  label,
  children,
  defaultOpen = false,
  className = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reduced = useReducedMotion();
  const id = useId();
  return (
    <section className={`${styles.root} ${className}`}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <m.span animate={{ rotate: open && !reduced ? 180 : 0 }}>
          <CaretDown size={18} aria-hidden="true" />
        </m.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            id={id}
            className={styles.content}
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0.09 : 0.24 }}
          >
            <div>{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}
