import { useEffect, useRef, useState } from "react";
import { FileImage, LoaderCircle, FolderClosed } from "./icons";
/** Adapted from Extend UI at a0ddcecd7bb3c92458b148cb0d34cbd5263191d4.
 * Copyright (c) 2026 CrowdView Inc, dba Extend; portions (c) 2023 shadcn.
 * MIT license: docs/third-party/extend-ui-LICENSE.md.
 */
export function ExtendFolder({ small = false }: { small?: boolean }) {
  return (
    <span className={"project-symbol " + (small ? "small" : "")}>
      <FolderClosed size={small ? 20 : 28} aria-hidden="true" />
    </span>
  );
}
/** Adapted from Extend UI at a0ddcecd7bb3c92458b148cb0d34cbd5263191d4.
 * Copyright (c) 2026 CrowdView Inc, dba Extend; portions (c) 2023 shadcn.
 * MIT license: docs/third-party/extend-ui-LICENSE.md.
 */

/** Adapted thumbnail lifecycle: an image is ready only after decoding succeeds. */
export function ExtendThumbnail({
  src,
  small = false,
}: {
  src: string;
  small?: boolean;
}) {
  const image = useRef<HTMLImageElement | null>(null),
    [loaded, setLoaded] = useState(""),
    [failed, setFailed] = useState("");
  const ready = loaded === src,
    error = failed === src;
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth > 0)
      setLoaded(src);
  }, [src]);
  return (
    <span
      className={"extend-thumbnail " + (small ? "small" : "")}
      data-state={error ? "error" : ready ? "ready" : "loading"}
    >
      {!error && (
        <img
          ref={image}
          src={src}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
        />
      )}
      <span className="thumbnail-feedback">
        {error ? (
          <>
            <FileImage size={small ? 15 : 24} />
            {!small && <small>预览不可用</small>}
          </>
        ) : !ready ? (
          <LoaderCircle size={small ? 13 : 19} className="spin" />
        ) : null}
      </span>
    </span>
  );
}
