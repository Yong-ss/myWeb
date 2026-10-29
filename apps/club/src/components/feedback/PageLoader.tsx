"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { LoadingSpinner } from "./LoadingSpinner";

type PageLoaderProps = {
  title?: string;
  detail?: string;
  /** Useful to avoid flashing a full loader during a very fast navigation. */
  delayMs?: number;
  className?: string;
};

/** On-demand local Lottie, with a no-dependency visual fallback and reduced-motion support. */
function ArchiveLottie() {
  const container = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelled = false;
    let generation = 0;
    let instance: { destroy(): void } | undefined;
    // Dynamic import: only PageLoader users pay for the Lottie playback bundle.
    function start() {
    const current=++generation;
    if(media.matches)return;
    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (cancelled || current!==generation || media.matches || !container.current) return;
      const animation = lottie.loadAnimation({
        container: container.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: "/animations/club-archive-loader.json",
        rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
      });
      instance = animation;
      animation.addEventListener("DOMLoaded", () => { if (!cancelled) setReady(true); });
      animation.addEventListener("data_failed", () => { if (!cancelled) setReady(false); });
    }).catch(() => { if (!cancelled) setReady(false); });
    }
    const change=()=>{instance?.destroy();instance=undefined;setReady(false);start();};
    start();media.addEventListener("change",change);
    return () => { cancelled = true;media.removeEventListener("change",change); instance?.destroy(); };
  }, []);
  return <span className="club-archive-mark relative mb-3 block size-28" aria-hidden="true">
    <span className={cn("club-archive-mark__fallback absolute inset-0 grid place-items-center transition-opacity duration-180 ease-club-feedback", ready && "is-hidden opacity-0")}>
      <span className="absolute font-heading text-[32px] text-gold">◇</span>
      <LoadingSpinner size="lg" />
    </span>
    <span className={cn("club-archive-mark__lottie absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-180 ease-club-feedback", ready && "is-ready opacity-100")} ref={container} />
  </span>;
}

export function PageLoader({ title = "正在读取档案…", detail = "请稍候", delayMs = 160, className }: PageLoaderProps) {
  const [show, setShow] = useState(delayMs === 0);
  useEffect(() => {
    const timeout = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs]);
  return <div className={cn("club-page-loader grid min-h-62 place-items-center px-4 py-8 text-center max-sm:min-h-50", className)} data-visible={show} role="status" aria-live="polite" aria-busy="true">
    {show && <div className="flex flex-col items-center">
      <ArchiveLottie />
      <div className="eyebrow mb-3 text-brass" aria-hidden="true">THE ARCHIVES</div>
      <p className="m-0 font-heading text-base text-gold">{title}</p>
      <p className="m-0 mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>}
    {!show && <span className="sr-only">{title}</span>}
  </div>;
}
