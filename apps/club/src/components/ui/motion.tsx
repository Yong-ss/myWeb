"use client"

import * as React from "react"
import { createContext, useContext, useState, useSyncExternalStore } from "react"
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react"

import { THEME_EVENT, type MotionPreset } from "../../lib/theme"

// Shared Motion timing. Opening is a little slower than closing: it reads as arrival, and dismissal never makes the
// user wait. CSS-only feedback (hover, press, tooltips) uses the --club-motion-* tokens instead.
export const ease = { enter: [0.16, 1, 0.3, 1], feedback: [0.2, 0, 0.2, 1], drawer: [0.32, 0.72, 0, 1], drawerOut: [0.4, 0, 0.6, 1] } as const
export const enter: Transition = { duration: 0.18, ease: ease.enter }
export const exit: Transition = { duration: 0.12, ease: ease.feedback }
/** Shared-element moves (e.g. the active tab marker): critically damped, so it glides without bouncing. */
export const glide: Transition = { type: "spring", stiffness: 520, damping: 44, mass: 0.9 }

type State = { opacity?: number; x?: number | string; y?: number; scale?: number; height?: number | string }
type Kind = { from: State; to?: State; leave?: State; in: Transition; out?: Transition; keepMovement?: boolean }

/**
 * One entry per kind of interaction; components pick the kind, never their own numbers.
 * `from` is the hidden state before entering, `leave` the state it exits to (defaults to `from`).
 */
const kinds = {
  /** Backdrop dimming: fades a touch longer than the surface above it, so it never "snaps". */
  overlay: { from: { opacity: 0 }, in: { duration: 0.24, ease: ease.feedback }, out: { duration: 0.18, ease: ease.feedback } },
  /** Centred dialogs: settle in with a short rise, sink away faster. */
  surface: { from: { opacity: 0, y: 10, scale: 0.98 }, leave: { opacity: 0, y: 4, scale: 0.99 }, in: { duration: 0.26, ease: ease.enter }, out: { duration: 0.16, ease: ease.feedback } },
  /** Anchored panels (Popover). */
  popover: { from: { opacity: 0, y: -4 }, in: enter, out: exit },
  /** Action menus: a slight scale from the trigger. */
  menu: { from: { opacity: 0, y: -4, scale: 0.97 }, leave: { opacity: 0, y: -2, scale: 0.98 }, in: { duration: 0.2, ease: ease.enter }, out: exit },
  /** Side drawer: iOS-like curve, fast start and long settle; closing accelerates out. The slide is its meaning, so fade presets keep it. */
  drawer: { from: { x: "100%", opacity: 0.6 }, in: { duration: 0.36, ease: ease.drawer }, out: { duration: 0.24, ease: ease.drawerOut }, keepMovement: true },
  /** Collapsible panel height; its content uses `collapseContent`. */
  collapse: { from: { height: 0 }, to: { height: "auto" }, in: { duration: 0.3, ease: ease.drawer }, out: { duration: 0.22, ease: ease.feedback }, keepMovement: true },
  /** Content inside an opening panel: fades in just after the panel starts, fades out first. */
  collapseContent: { from: { opacity: 0, y: -4 }, leave: { opacity: 0, y: -2 }, in: { duration: 0.24, delay: 0.06, ease: ease.feedback }, out: { duration: 0.12, ease: ease.feedback } },
  /** A list row being added or removed: height and opacity together. */
  listItem: { from: { opacity: 0, height: 0 }, to: { opacity: 1, height: "auto" }, in: { duration: 0.26, ease: ease.enter }, out: { duration: 0.2, ease: ease.feedback }, keepMovement: true },
  /** Switching tab panels. */
  content: { from: { opacity: 0, y: 4 }, in: { duration: 0.24, ease: ease.enter } },
  /** A section appearing in place (a result, the next step of a flow). */
  reveal: { from: { opacity: 0, y: 6 }, in: enter },
  /** Moving to the next item of a sequence (e.g. the next row to review). */
  step: { from: { opacity: 0, x: 12 }, in: enter },
  /** Opacity only, for content whose position must not move. */
  fade: { from: { opacity: 0 }, in: enter },
} satisfies Record<string, Kind>

export type MotionKind = keyof typeof kinds

const rest = (state: State): State => Object.fromEntries(Object.keys(state).map(key => [key, key === "opacity" || key === "scale" ? 1 : key === "height" ? "auto" : 0]))
const still = ({ x, y, scale, ...state }: State): State => (void x, void y, void scale, state)

const readPreset = (): MotionPreset => document.documentElement.dataset.motion === "fade" ? "fade" : "rise"
const subscribe = (change: () => void) => { window.addEventListener(THEME_EVENT, change); return () => window.removeEventListener(THEME_EVENT, change) }
/** The motion preset of the current theme (src/lib/theme.ts). */
export function useMotionPreset(): MotionPreset {
  return useSyncExternalStore(subscribe, readPreset, () => "rise")
}

/** With reduced motion every Motion transition is instant: state changes, nothing moves or fades. */
export function useMotion(transition: Transition): Transition {
  return useReducedMotion() ? { duration: 0 } : transition
}

/** Motion props for one interaction kind, after the theme preset and reduced motion are applied. Spread onto a motion element. */
export function useMotionKind(name: MotionKind): { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition } {
  const kind: Kind = kinds[name]
  const reduce = useReducedMotion(), preset = useMotionPreset()
  const shape = (state: State) => preset === "fade" && !kind.keepMovement ? still(state) : state
  const instant = { duration: 0 }
  return {
    initial: shape(kind.from),
    animate: { ...shape(kind.to ?? rest(kind.from)), transition: reduce ? instant : kind.in },
    exit: { ...shape(kind.leave ?? kind.from), transition: reduce ? instant : kind.out ?? kind.in },
  }
}

type RevealProps = { kind?: Extract<MotionKind, "reveal" | "step" | "fade" | "content">; as?: "div" | "section" } & Omit<React.ComponentProps<"div">, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd">

/** Plays an appear animation when it mounts (re-key it to replay). For pages, so they never hand-write Motion values. */
export function Reveal({ kind = "reveal", as = "div", ...props }: RevealProps) {
  const animation = useMotionKind(kind)
  const Element = as === "section" ? motion.section : motion.div
  return <Element {...animation} {...props} />
}

/**
 * Overlay content stays mounted while it animates out (Radix `forceMount` inside Motion `AnimatePresence`), so it
 * reads the open state from its Root. Radix still owns focus trapping and return, Escape, outside clicks and scroll
 * lock; once `open` is false it stops trapping focus and blocking the page, and the exiting layer ignores pointers.
 */
const OpenContext = createContext(false)
export const useOpen = () => useContext(OpenContext)

type RootProps = { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }

/** Wraps a Radix Root so its animated content knows whether it is open (works controlled and uncontrolled). */
export function withOpenState<P extends RootProps>(Root: React.ComponentType<P>, slot: string) {
  function OpenStateRoot({ open, defaultOpen = false, onOpenChange, ...props }: P) {
    const [inner, setInner] = useState(defaultOpen)
    const current = open ?? inner
    const change = (next: boolean) => { if (open === undefined) setInner(next); onOpenChange?.(next) }
    return <OpenContext.Provider value={current}><Root data-slot={slot} {...(props as unknown as P)} open={current} onOpenChange={change} /></OpenContext.Provider>
  }
  return OpenStateRoot
}
