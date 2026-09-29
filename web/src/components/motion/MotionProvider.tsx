"use client";

import { domAnimation, LazyMotion, MotionConfig } from "motion/react";

const transition = { type: "spring" as const, stiffness: 360, damping: 32, mass: 0.7 };

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={transition}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
