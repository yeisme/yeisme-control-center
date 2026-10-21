const mimeExtensions: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/vorbis": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
  "audio/vnd.wave": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const extensionAliases: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "audio/m4a": ["m4a"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/mpeg": ["mp3"],
  "audio/ogg": ["ogg", "oga"],
  "audio/vorbis": ["ogg", "oga"],
  "audio/wav": ["wav"],
  "audio/x-wav": ["wav"],
  "audio/vnd.wave": ["wav"],
};

function normalizedMime(mime: string | undefined | null) {
  return (mime || "").split(";", 1)[0].trim().toLowerCase();
}

function safeName(value: string) {
  return value
    .replace(/[\\/\x00-\x1f\x7f]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
}

export function mediaExtension(mime: string | undefined | null) {
  return mimeExtensions[normalizedMime(mime)] || "";
}

export function mediaFilename(name: string | undefined | null, mime: string | undefined | null, fallback = "result") {
  const type = normalizedMime(mime);
  const expected = mimeExtensions[type] || "";
  let filename = safeName(name || "") || safeName(fallback) || "result";
  if (!expected) return filename;

  const match = filename.match(/\.([a-z0-9]{1,10})$/i);
  if (!match) return `${filename}.${expected}`;

  const extension = match[1].toLowerCase();
  const accepted = extensionAliases[type] || [expected];
  if (accepted.includes(extension)) return filename;
  return `${filename.slice(0, -match[0].length)}.${expected}`;
}

