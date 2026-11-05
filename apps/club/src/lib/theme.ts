// Theme registry: which themes exist and which motion preset each uses. Colours, fonts, shape and effects live in
// styles/tokens.css (default) and styles/themes.css (others, keyed by <html data-theme>).
export const themes = {
  default: { label: "默认（暗色维多利亚）", motion: "rise" },
  test: { label: "测试主题", motion: "fade" },
} as const;

export type ThemeId = keyof typeof themes;
export type MotionPreset = (typeof themes)[ThemeId]["motion"];

export const THEME_KEY = "club-theme";
export const THEME_EVENT = "club-theme-change";

const motionOf = Object.fromEntries(Object.entries(themes).map(([id, theme]) => [id, theme.motion]));

/** Inlined in <head> by the root layout: applies the remembered theme before first paint (no flash of the default). */
export const themeBootScript = `(function(){try{var m=${JSON.stringify(motionOf)},t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t&&m.hasOwnProperty(t)&&t!=="default"){var d=document.documentElement;d.dataset.theme=t;d.dataset.motion=m[t];}}catch(e){}})()`;

export function isTheme(value: unknown): value is ThemeId {
  return typeof value === "string" && Object.hasOwn(themes, value);
}

/** The applied theme, read from <html>; the default theme sets no attribute. */
export function currentTheme(): ThemeId {
  const value = typeof document === "undefined" ? undefined : document.documentElement.dataset.theme;
  return isTheme(value) ? value : "default";
}

/** Explicit choice: apply now and remember it for the next load. */
export function setTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === "default") { delete root.dataset.theme; delete root.dataset.motion; }
  else { root.dataset.theme = id; root.dataset.motion = themes[id].motion; }
  try { if (id === "default") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, id); } catch { /* private mode: applies for this visit only */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}
