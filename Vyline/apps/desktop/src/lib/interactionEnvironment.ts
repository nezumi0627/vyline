export type InteractionMode = "desktop" | "mobile";

const MOBILE_UA = /android|iphone|ipad|ipod/i;
const DESKTOP_UA = /windows(?: nt)?|win32|win64|macintosh|mac os x|linux|x11|cros/i;

/**
 * Operation semantics are UA-driven, while layout remains CSS/media-query driven.
 *
 * Android must be checked before Linux because Android UAs also contain "Linux".
 * iPadOS Safari can advertise itself as Macintosh, so maxTouchPoints disambiguates it.
 */
export function interactionModeFromUserAgent(
  userAgent: string,
  maxTouchPoints = 0,
): InteractionMode {
  if (MOBILE_UA.test(userAgent)) return "mobile";
  if (/macintosh|mac os x/i.test(userAgent) && maxTouchPoints > 1) return "mobile";
  if (DESKTOP_UA.test(userAgent)) return "desktop";
  // Unknown browser/OS: prefer touch-safe semantics so Enter never sends unexpectedly.
  return "mobile";
}

export function getInteractionMode(): InteractionMode {
  if (typeof navigator === "undefined") return "desktop";
  return interactionModeFromUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

export function isMobileInteraction(): boolean {
  return getInteractionMode() === "mobile";
}

export function isDesktopInteraction(): boolean {
  return getInteractionMode() === "desktop";
}

/**
 * Keep the app attached to the VisualViewport on mobile.
 * This prevents Chromium/Safari from panning the whole chat upward and hiding the
 * conversation header while the software keyboard is open.
 */
export function installInteractionEnvironment(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const root = document.documentElement;
  const mode = getInteractionMode();
  root.dataset.vyInteraction = mode;

  const viewport = window.visualViewport;
  const updateViewport = () => {
    if (mode !== "mobile") {
      root.style.setProperty("--vy-app-height", "100dvh");
      root.style.setProperty("--vy-app-top", "0px");
      return;
    }

    const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
    const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
    root.style.setProperty("--vy-app-height", `${height}px`);
    root.style.setProperty("--vy-app-top", `${offsetTop}px`);
  };

  updateViewport();
  viewport?.addEventListener("resize", updateViewport);
  viewport?.addEventListener("scroll", updateViewport);
  window.addEventListener("orientationchange", updateViewport);
}
