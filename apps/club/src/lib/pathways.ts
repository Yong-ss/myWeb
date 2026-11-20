export type PathwayMetadata = {
  name: string;
  icon: `/pathway/${string}.webp`;
  accent: `var(--club-pathway-${string})`;
};

/** Presentation only: keys and labels are the exact stored game names. */
// Accents resolve through tokens.css; confirmed in-game colors include 观众 (healer).
export const pathways = {
  占卜家: { name: "占卜家", icon: "/pathway/seer-f3155962252b.webp", accent: "var(--club-pathway-seer)" },
  学徒: { name: "学徒", icon: "/pathway/apprentice.webp", accent: "var(--club-pathway-apprentice)" },
  观众: { name: "观众", icon: "/pathway/spectator-c617261c48b5.webp", accent: "var(--club-pathway-spectator)" },
  窥秘人: { name: "窥秘人", icon: "/pathway/mystery-pryer.webp", accent: "var(--club-pathway-mystery-pryer)" },
  战士: { name: "战士", icon: "/pathway/warrior.webp", accent: "var(--club-pathway-warrior)" },
  // Confirmed: 歌颂者 uses the sun artwork; never rename the stored value to 太阳.
  歌颂者: { name: "歌颂者", icon: "/pathway/sun.webp", accent: "var(--club-pathway-sun)" },
} as const satisfies Record<string, PathwayMetadata>;

export type PathwayName = keyof typeof pathways;
export type PathwayValue = string | number | null | undefined;

export function getPathway(value: PathwayValue): PathwayMetadata | undefined {
  return typeof value === "string" && Object.hasOwn(pathways, value) ? pathways[value as PathwayName] : undefined;
}
