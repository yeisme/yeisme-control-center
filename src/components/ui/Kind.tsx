import { AudioLines, FileText, Image, Video } from "../../icons";
import { cx } from "./cx";

export type MediaKind = "image" | "video" | "audio" | "text";

export function kindOf(mime: string | null | undefined, fallback?: string): MediaKind {
  const value = (mime || "").toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  if (fallback === "image" || fallback === "video" || fallback === "audio") return fallback;
  return "text";
}

const labels: Record<MediaKind, string> = { image: "图像", video: "视频", audio: "音频", text: "文本" };
export function kindLabel(kind: MediaKind) {
  return labels[kind];
}

const tones: Record<MediaKind, string> = {
  image: "bg-kind-image-soft text-kind-image",
  video: "bg-kind-video-soft text-kind-video",
  audio: "bg-kind-audio-soft text-kind-audio",
  text: "bg-kind-text-soft text-kind-text",
};

const icons = { image: Image, video: Video, audio: AudioLines, text: FileText };

export function KindBadge({ kind, size = "md", className }: { kind: MediaKind; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = icons[kind];
  return <span aria-label={labels[kind]} className={cx("grid shrink-0 place-items-center", tones[kind], size === "sm" ? "size-7 rounded-[7px] [&>svg]:size-3.5" : size === "lg" ? "size-11 rounded-[11px] [&>svg]:size-5" : "size-9 rounded-[9px] [&>svg]:size-[17px]", className)}>
    <Icon aria-hidden="true" />
  </span>;
}
