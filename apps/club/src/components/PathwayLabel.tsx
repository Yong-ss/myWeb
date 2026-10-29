import Image from "next/image";
import { getPathway, type PathwayValue } from "../lib/pathways";

/** Decorative beside a visible name; the label remains the accessible source of truth. */
export function PathwayIcon({ pathway }: { pathway: PathwayValue }) {
  const metadata = getPathway(pathway);
  return metadata
    ? <Image src={metadata.icon} alt="" width={20} height={20} className="size-5 shrink-0 object-contain" />
    : <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground"><span className="size-1 rounded-full bg-current" /></span>;
}

export function PathwayLabel({ pathway, missingText = "—" }: { pathway: PathwayValue; missingText?: string }) {
  const metadata = getPathway(pathway);
  return <span className="inline-flex items-center gap-2 whitespace-nowrap align-middle text-muted-foreground" style={metadata ? { color: metadata.accent } : undefined}>
    <PathwayIcon pathway={pathway} /><span>{pathway ?? missingText}</span>
  </span>;
}
