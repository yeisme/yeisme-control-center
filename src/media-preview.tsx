import { useEffect, useRef, useState } from "react";
import { AudioLines, FileText, Image as ImageIcon, Video } from "./icons";
import { Button } from "./ui";
import {
  fitScale,
  formatDuration,
  percent,
  stepZoom,
  widthScale,
  zoomSteps,
  type LocalKind,
  type Size,
} from "./media-preview-state";

type Phase = "loading" | "ready" | "error";
type FitMode = "fit" | "width" | "original";

export interface Unavailable {
  title: string;
  body: string;
  tag: string;
}

const kindIcon = (kind: LocalKind) =>
  kind === "image" ? (
    <ImageIcon />
  ) : kind === "audio" ? (
    <AudioLines />
  ) : kind === "video" ? (
    <Video />
  ) : (
    <FileText />
  );
const kindLabel = (kind: LocalKind) =>
  ({
    image: "图像预览",
    audio: "音频预览",
    video: "视频预览",
    text: "文件预览",
    file: "文件预览",
  })[kind];
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

export function MediaPreview({
  kind,
  src,
  text,
  alt,
  label,
  unavailable,
  local = false,
  caption,
  onChoose,
}: {
  kind: LocalKind;
  src?: string;
  text?: string;
  alt: string;
  label: string;
  unavailable?: Unavailable;
  local?: boolean;
  caption: string;
  onChoose?: () => void;
}) {
  const interactive =
    !unavailable &&
    kind !== "file" &&
    (kind === "text" ? text !== undefined : !!src);
  const [phase, setPhase] = useState<Phase>(
    kind === "text" ? "ready" : "loading",
  );
  const [retrying, setRetrying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [reload, setReload] = useState(0);
  const [natural, setNatural] = useState<Size | null>(null);
  const [meta, setMeta] = useState("");
  const [mode, setMode] = useState<FitMode>("fit");
  const [scale, setScale] = useState(1);
  const [background, setBackground] = useState<"dark" | "checker" | undefined>();
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  const stageRef = useRef<HTMLElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const setMedia = (node: HTMLMediaElement | null) => {
    mediaRef.current = node;
  };

  const imageLoaded = (image: HTMLImageElement) => {
    if (!image.naturalWidth) {
      setPhase("error");
      return;
    }
    const next = { w: image.naturalWidth, h: image.naturalHeight };
    setNatural((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    setPhase("ready");
    setRetrying(false);
  };
  const mediaLoaded = (media: HTMLMediaElement) => {
    const duration = formatDuration(media.duration);
    setMeta(
      media instanceof HTMLVideoElement
        ? `${media.videoWidth} × ${media.videoHeight} · ${duration}`
        : duration,
    );
    setPhase("ready");
  };

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete) imageLoaded(image);
    const media = mediaRef.current;
    if (media && media.readyState >= 1) mediaLoaded(media);
  }, [reload, src]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element || kind !== "image" || !interactive) return;
    const measure = () =>
      setStage({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [kind, interactive]);

  const effective =
    mode === "fit"
      ? fitScale(stage, natural)
      : mode === "width"
        ? widthScale(stage, natural)
        : scale;
  const preset = zoomSteps.find((step) => near(step, scale));
  const zoomValue =
    mode === "fit"
      ? "fit"
      : mode === "original" && preset !== undefined
        ? String(preset)
        : "custom";
  const modeValue =
    mode === "original" && !near(scale, 1) ? "custom" : mode;
  const ready = phase === "ready";
  const step = (direction: 1 | -1) => {
    setMode("original");
    setScale(stepZoom(effective, direction));
  };
  const imageStyle =
    mode === "fit"
      ? { width: "100%", height: "100%" }
      : mode === "width"
        ? { width: "100%", height: "auto" }
        : {
            width: natural ? Math.round(natural.w * scale) : undefined,
            height: "auto",
          };
  const retry = () => {
    setPhase("loading");
    setRetrying(true);
    setReload((value) => value + 1);
  };
  const showsState = interactive && kind !== "text";
  const feedback =
    showsState && phase === "loading"
      ? retrying
        ? "正在重新读取预览…"
        : "正在读取预览…"
      : showsState && phase === "error"
        ? "预览不可用"
        : buffering
          ? "正在缓冲…"
          : "";
  const facts = !interactive
    ? "内容不可用"
    : kind === "text"
      ? "纯文本 · 不执行文件内容"
      : phase === "error"
        ? "未取得媒体信息"
        : phase === "loading"
          ? "等待文件信息"
          : kind === "image" && natural
            ? `${natural.w} × ${natural.h} px`
            : meta;

  return (
    <section className="asset-preview-column" data-od-id="media-preview">
      <div className="preview-controls">
        <span className="preview-type">
          {kindIcon(kind)}
          {kindLabel(kind)}
        </span>
        {kind === "image" && interactive && (
          <div className="row">
            <select
              className="preview-mode"
              aria-label="图片适配方式"
              value={modeValue}
              disabled={!ready}
              onChange={(event) => {
                const value = event.target.value as FitMode;
                setMode(value);
                if (value === "original") setScale(1);
              }}
            >
              <option value="fit">适应窗口</option>
              <option value="width">适应宽度</option>
              <option value="original">原始比例 1:1</option>
              <option value="custom" hidden>
                自定义比例
              </option>
            </select>
            <select
              className="preview-zoom"
              aria-label="图片缩放比例"
              value={zoomValue}
              disabled={!ready}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "fit") setMode("fit");
                else if (value !== "custom") {
                  setMode("original");
                  setScale(Number(value));
                }
              }}
            >
              <option value="fit">
                {natural ? percent(fitScale(stage, natural)) : "适应"}
              </option>
              {zoomSteps.map((value) => (
                <option key={value} value={String(value)}>
                  {percent(value)}
                </option>
              ))}
              <option value="custom" hidden>
                {percent(effective)}
              </option>
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label="缩小预览"
              disabled={!ready || effective <= zoomSteps[0] + 0.005}
              onClick={() => step(-1)}
            >
              −
            </button>
            <output className="sr-only">{percent(effective)}</output>
            <button
              type="button"
              className="icon-button"
              aria-label="放大预览"
              disabled={
                !ready || effective >= zoomSteps[zoomSteps.length - 1] - 0.005
              }
              onClick={() => step(1)}
            >
              +
            </button>
            <Button
              size="sm"
              aria-label="切换图片背景"
              aria-pressed={background === "dark"}
              onClick={() =>
                setBackground((value) => (value === "dark" ? "checker" : "dark"))
              }
            >
              背景
            </Button>
          </div>
        )}
      </div>
      <div className="media-feedback" role="status" aria-live="polite">
        {feedback}
      </div>
      <figure
        ref={stageRef}
        className={
          "media-stage media-" + kind + (interactive ? "" : " media-unavailable")
        }
        data-state={showsState ? phase : "ready"}
        data-zoom={kind === "image" && interactive ? mode : undefined}
        data-background={background}
        data-preview-kind={kind}
      >
        {interactive && kind === "image" && (
          // Remounting on retry re-requests the same reference; it never swaps the source.
          <img
            key={reload}
            ref={imageRef}
            src={src}
            alt={alt}
            style={imageStyle}
            onLoad={(event) => imageLoaded(event.currentTarget)}
            onError={() => setPhase("error")}
          />
        )}
        {interactive && kind === "audio" && (
          <>
            <div className="audio-art">
              {kindIcon("audio")}
              <span>{local ? "本地音频" : "音频"}</span>
              <small>使用下方播放器试听</small>
            </div>
            <audio
              ref={setMedia}
              controls
              preload="metadata"
              src={src}
              aria-label={label}
              onLoadedMetadata={(event) => mediaLoaded(event.currentTarget)}
              onError={() => setPhase("error")}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
            />
          </>
        )}
        {interactive && kind === "video" && (
          <video
            ref={setMedia}
            controls
            playsInline
            preload="metadata"
            src={src}
            aria-label={label}
            onLoadedMetadata={(event) => mediaLoaded(event.currentTarget)}
            onError={() => setPhase("error")}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
          />
        )}
        {interactive && kind === "text" && (
          <pre className="text-preview" tabIndex={0} aria-label="文件文本内容">
            {text || "（空文件）"}
          </pre>
        )}
        {!interactive && unavailable && (
          <div className="media-state">
            {kindIcon(kind)}
            <h3>{unavailable.title}</h3>
            <p>{unavailable.body}</p>
            <span className="media-state-tag">{unavailable.tag}</span>
          </div>
        )}
      </figure>
      <div className="preview-facts">
        <span data-media-metadata>{facts}</span>
        <span>{local ? "仅本机" : "参考素材"}</span>
      </div>
      {showsState && phase === "error" && (
        <div className="media-error" role="alert">
          <strong>未能读取预览</strong>
          <p>文件可能损坏、读取失败，或浏览器不支持此编码。原记录保持不变。</p>
          <div className="row">
            {kind === "image" && (
              <Button size="sm" onClick={retry}>
                重新读取预览
              </Button>
            )}
            {local && onChoose && (
              <Button size="sm" onClick={onChoose}>
                选择其他文件
              </Button>
            )}
          </div>
        </div>
      )}
      <p className="preview-caption">{caption}</p>
    </section>
  );
}
