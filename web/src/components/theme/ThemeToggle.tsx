"use client";

import { Monitor, Moon, Sun } from "@phosphor-icons/react";
import { m } from "motion/react";

import type { ThemePreference } from "@/types/ui";
import { useTheme } from "./ThemeProvider";
import styles from "./ThemeToggle.module.css";

const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light theme", icon: Sun },
  { value: "system", label: "Use system theme", icon: Monitor },
  { value: "dark", label: "Dark theme", icon: Moon },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div className={styles.group} role="group" aria-label="Color theme">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={styles.option}
          aria-label={label}
          aria-pressed={preference === value}
          onClick={() => setPreference(value)}
        >
          {preference === value && <m.span className={styles.indicator} layoutId="theme-indicator" />}
          <Icon size={16} weight={preference === value ? "fill" : "regular"} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
