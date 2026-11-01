/** Applies a multiplier to text targets without changing rem-based layout dimensions. */
export function applyFontScale(root: HTMLElement, value: number): void {
  const scale = Number.isFinite(value) ? value : 1;
  root.style.setProperty("--vy-font-scale", String(scale));
}
