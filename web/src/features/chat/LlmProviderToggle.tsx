"use client";

import { useCallback, useSyncExternalStore } from "react";
import { m } from "motion/react";

import type { LlmProvider } from "@/types/api";
import styles from "./LlmProviderToggle.module.css";

const STORAGE_KEY = "airport-intelligence-llm-provider";
const CHANGE_EVENT = "airport-intelligence-llm-provider";
const options: Array<{ value: LlmProvider; label: string }> = [
  { value: "groq", label: "Groq" },
  { value: "gemini", label: "Gemini" },
];

function defaultProvider(): LlmProvider {
  const fromEnv = process.env.NEXT_PUBLIC_DEFAULT_LLM_PROVIDER;
  return fromEnv === "gemini" ? "gemini" : "groq";
}

export function readStoredLlmProvider(): LlmProvider {
  if (typeof window === "undefined") return defaultProvider();
  const stored = window.sessionStorage.getItem(STORAGE_KEY);
  return stored === "gemini" || stored === "groq" ? stored : defaultProvider();
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHANGE_EVENT, onStoreChange);
}

export function LlmProviderToggle({
  value,
  onChange,
}: {
  value: LlmProvider;
  onChange: (provider: LlmProvider) => void;
}) {
  return (
    <div className={styles.group} role="group" aria-label="Language model">
      {options.map(({ value: option, label }) => (
        <button
          key={option}
          type="button"
          className={styles.option}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {value === option && <m.span className={styles.indicator} layoutId="llm-provider-indicator" />}
          {label}
        </button>
      ))}
    </div>
  );
}

export function useLlmProvider(): [LlmProvider, (provider: LlmProvider) => void] {
  const provider = useSyncExternalStore(subscribe, readStoredLlmProvider, defaultProvider);
  const update = useCallback((next: LlmProvider) => {
    window.sessionStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [provider, update];
}
