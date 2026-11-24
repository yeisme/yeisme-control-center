export type MediaKind = "image" | "video" | "audio" | "text";

/** A result's kind from its media type, falling back to the owner's own kind; anything else reads as text. */
export function kindOf(mime: string | null | undefined, fallback?: string): MediaKind {
  const value = (mime || "").toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  if (fallback === "image" || fallback === "video" || fallback === "audio") return fallback;
  return "text";
}

/** What each owner makes when a result does not say its own media type. */
export const ownerModality: Record<string, MediaKind> = { eikona: "image", scaena: "video", sonora: "audio", anatomia: "video" };
