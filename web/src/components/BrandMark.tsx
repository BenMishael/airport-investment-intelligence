import Image from "next/image";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <Image
        src="/assets/brand/airplane-flight-around-the-planet-svgrepo-com.svg"
        alt=""
        width={26}
        height={26}
        unoptimized
      />
    </span>
  );
}
