"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./MarkdownAnswer.module.css";

type Props = { markdown: string };

const HEADINGS = ["Direct answer", "Evidence and method", "Scope and uncertainty", "Conclusion"] as const;

const components: Components = {
  img: ({ alt }) => (alt ? <em>{alt}</em> : null),
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
};

export function normalizeMemo(text: string): string {
  let out = text.trim();
  if (out.includes("\\n")) out = out.replace(/\\n/g, "\n");
  if (out.includes("\\t")) out = out.replace(/\\t/g, "\t");
  out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (const title of HEADINGS) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`^(?:## )?${escaped}\\s*[:;]?\\s*`, "gm"), `## ${title}\n\n`);
  }
  return out.replace(/^;\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function MarkdownAnswer({ markdown }: Props) {
  return (
    <div className={styles.root}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalizeMemo(markdown)}
      </ReactMarkdown>
    </div>
  );
}
