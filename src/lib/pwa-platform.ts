/** Running as an installed app (home-screen launch) rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/**
 * iPhone/iPad. iPadOS reports itself as a Mac, so a touch-capable "Mac" counts too.
 * Every browser on iOS is WebKit, so this is what decides install and notification rules.
 */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
