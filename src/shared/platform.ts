type NavigatorLike = { platform?: string; userAgent?: string; userAgentData?: { platform?: string } };

const currentNavigator = (): NavigatorLike | undefined => typeof navigator === "undefined" ? undefined : navigator as NavigatorLike;

/** Apple keyboards say ⌘ where the others say Ctrl. Without a navigator (tests, server) the answer is "not Apple". */
export function isApplePlatform(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  if (!nav) return false;
  const platform = nav.userAgentData?.platform || nav.platform || "";
  if (platform) return /mac|iphone|ipad|ipod/i.test(platform);
  return /mac os x|iphone|ipad/i.test(nav.userAgent || "");
}

/** The modifier as a keyboard shows it: ⌘ on Apple, Ctrl elsewhere. */
export const modKeyLabel = (apple = isApplePlatform()) => apple ? "⌘" : "Ctrl";

/** "⌘C" or "Ctrl+C", the way each platform writes a shortcut. */
export const shortcutText = (key: string, apple = isApplePlatform()) => apple ? `⌘${key}` : `Ctrl+${key}`;
