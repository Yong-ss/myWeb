import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// `*.dev.tsx` routes (the component showcase at /showcase) exist only under `next dev`.
// Production builds use the default extensions, so the static export never contains them.
export default function config(phase: string): NextConfig {
  return {
    output: "export",
    images: { unoptimized: true },
    pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ["dev.tsx", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],
  };
}
