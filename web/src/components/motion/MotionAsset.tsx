"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useReducedMotion } from "motion/react";
import { useState } from "react";

import styles from "./MotionAsset.module.css";

const Lottie = dynamic(() => import("lottie-react").then((module) => module.Lottie), { ssr: false });

export type MotionAssetProps = {
  src?: string;
  posterSrc: string;
  alt: string;
  className?: string;
  loop?: boolean;
  priority?: boolean;
  speed?: number;
};

export function MotionAsset({
  src,
  posterSrc,
  alt,
  className,
  loop = true,
  priority = false,
  speed = 1,
}: MotionAssetProps) {
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const canAnimate = Boolean(src && !reducedMotion && !failed);

  return (
    <figure className={`${styles.asset} ${className || ""}`}>
      <Image
        className={`${styles.poster} ${ready ? styles.hidden : ""}`}
        src={posterSrc}
        alt={alt}
        fill
        sizes="(max-width: 768px) 100vw, 50vw"
        priority={priority}
      />
      {canAnimate && (
        <Lottie
          className={styles.animation}
          src={src!}
          loop={loop}
          autoplay
          speed={speed}
          rendererSettings={{ runExpressions: false }}
          subscriptions={{ ready: () => setReady(true), error: () => setFailed(true) }}
          aria-hidden="true"
        />
      )}
    </figure>
  );
}
