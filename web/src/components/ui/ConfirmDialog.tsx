"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

import styles from "./ConfirmDialog.module.css";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const reduced = useReducedMotion();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const confirmingRef = useRef(false);
  useEffect(() => {
    if (!open) {
      confirmingRef.current = false;
      return;
    }
    restoreRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => cancelRef.current?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = cancelRef.current?.closest('[role="alertdialog"]');
      const controls = Array.from(dialog?.querySelectorAll<HTMLElement>("button") || []);
      if (!controls.length) return;
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && index === controls.length - 1) {
        event.preventDefault();
        controls[0]?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreRef.current?.focus();
    };
  }, [open, onCancel]);
  return (
    <AnimatePresence>
      {open && (
        <m.div
          className={styles.scrim}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) onCancel();
          }}
        >
          <m.section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-description"
            className={styles.dialog}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
          >
            <p className="eyebrow">Confirm action</p>
            <h2 id="confirm-title">{title}</h2>
            <p id="confirm-description">{description}</p>
            <div className={styles.actions}>
              <button ref={cancelRef} type="button" onClick={onCancel}>
                Keep analysis
              </button>
              <button
                type="button"
                className={styles.danger}
                onClick={(event) => {
                  if (confirmingRef.current) return;
                  confirmingRef.current = true;
                  event.currentTarget.disabled = true;
                  onConfirm();
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </m.section>
        </m.div>
      )}
    </AnimatePresence>
  );
}
