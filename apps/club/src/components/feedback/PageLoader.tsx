"use client";

import { useEffect, useRef, useState } from "react";
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
  return <span className="club-archive-mark" aria-hidden="true">
    <span className={`club-archive-mark__fallback${ready ? " is-hidden" : ""}`}>
      <span className="club-archive-mark__diamond">◇</span>
      <LoadingSpinner size="md" />
    </span>
    <span className={`club-archive-mark__lottie${ready ? " is-ready" : ""}`} ref={container} />
  </span>;
}

export function PageLoader({ title = "正在读取档案…", detail = "请稍候", delayMs = 160, className = "" }: PageLoaderProps) {
  const [show, setShow] = useState(delayMs === 0);
  useEffect(() => {
    const timeout = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs]);
  return <div className={`club-page-loader ${className}`.trim()} data-visible={show} role="status" aria-live="polite" aria-busy="true">
    {show && <div className="club-page-loader__inner">
      <ArchiveLottie />
      <div className="club-page-loader__overline" aria-hidden="true">THE ARCHIVES</div>
      <p className="club-page-loader__title">{title}</p>
      <p className="club-page-loader__detail">{detail}</p>
    </div>}
    {!show && <span className="club-visually-hidden">{title}</span>}
  </div>;
}
