"use client";

import { useEffect } from "react";

function syncViewportFit() {
  const root = document.documentElement;
  const header = document.querySelector("header");
  const footer = document.querySelector("footer");
  root.style.setProperty("--header-offset", `${Math.round(header?.getBoundingClientRect().height || 72)}px`);
  root.style.setProperty("--footer-offset", `${Math.round(footer?.getBoundingClientRect().height || 52)}px`);
}

export function ViewportFit() {
  useEffect(() => {
    const root = document.documentElement;
    syncViewportFit();
    const observer = new ResizeObserver(syncViewportFit);
    const header = document.querySelector("header");
    const footer = document.querySelector("footer");
    if (header) observer.observe(header);
    if (footer) observer.observe(footer);
    window.addEventListener("resize", syncViewportFit);
    window.visualViewport?.addEventListener("resize", syncViewportFit);
    window.visualViewport?.addEventListener("scroll", syncViewportFit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncViewportFit);
      window.visualViewport?.removeEventListener("resize", syncViewportFit);
      window.visualViewport?.removeEventListener("scroll", syncViewportFit);
      root.style.removeProperty("--header-offset");
      root.style.removeProperty("--footer-offset");
    };
  }, []);
  return null;
}
