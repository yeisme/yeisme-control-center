import { useEffect, useRef, useState } from "react";
import { Eye } from "./icons";
import { Button, Modal } from "./ui";
import { MediaPreview, type Unavailable } from "./media-preview";
import {
  formatBytes,
  planLocalFile,
  type LocalKind,
} from "./media-preview-state";

interface LocalFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: LocalKind;
  text?: string;
  unavailable?: Unavailable;
  url: string;
}

/** Browser-local preview: bytes stay in memory as a Blob URL and are never stored, routed or uploaded. */
export function LocalFilePreview({
  notify,
}: {
  notify: (text: string) => void;
}) {
  const [local, setLocal] = useState<LocalFile | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const epoch = useRef(0);
  const url = useRef<string | null>(null);
  const revoke = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  };
  const release = () => {
    epoch.current++;
    revoke();
    setLocal(null);
  };
  useEffect(
    () => () => {
      epoch.current++;
      revoke();
    },
    [],
  );
  const choose = () => picker.current?.click();
  const read = async (file: File) => {
    const plan = planLocalFile(file);
    if (!plan.ok) {
      notify("本地预览支持不超过 64 MB 的文件。");
      return;
    }
    const current = ++epoch.current;
    let text: string | undefined;
    if (plan.readText) {
      try {
        text = await file.text();
      } catch {
        if (current === epoch.current)
          notify("无法读取该本地文件，请重新选择。");
        return;
      }
    }
    if (current !== epoch.current) return;
    const previous = url.current;
    const objectUrl = URL.createObjectURL(file);
    url.current = objectUrl;
    setLocal({
      id: "local-" + current,
      name: file.name,
      mime: file.type || "未提供",
      size: file.size,
      kind: plan.kind,
      text,
      unavailable: plan.unsupported
        ? {
            title: plan.textTooLarge
              ? "文本超过 512 KB 预览限制"
              : "暂不支持内嵌预览",
            body: "文件保留在当前浏览器，可下载后用本机应用打开。",
            tag: "本地文件",
          }
        : undefined,
      url: objectUrl,
    });
    if (previous) URL.revokeObjectURL(previous);
  };
  return (
    <>
      <Button data-od-id="local-file-preview" onClick={choose}>
        <Eye size={15} />
        本地文件预览
      </Button>
      <input
        ref={picker}
        type="file"
        hidden
        aria-label="选择本地预览文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void read(file);
        }}
      />
      {local && (
        <Modal
          open
          close={release}
          title="本地文件预览"
          description="文件仅在本机预览，不上传，也不加入项目资产。"
          wide
        >
          <MediaPreview
            key={local.id}
            kind={local.kind}
            src={local.url}
            text={local.text}
            alt="本地图片，仅在本机预览"
            label={
              local.kind === "audio"
                ? "本地音频预览"
                : local.kind === "video"
                  ? "本地视频预览"
                  : "本地文件预览"
            }
            unavailable={local.unavailable}
            local
            caption="本地预览 · 未上传，不加入项目资产"
            onChoose={choose}
          />
          <dl className="read-fields local-file-facts">
            <div className="read-field">
              <dt>文件名</dt>
              <dd>{local.name}</dd>
            </div>
            <div className="read-field">
              <dt>类型</dt>
              <dd>{local.mime}</dd>
            </div>
            <div className="read-field">
              <dt>大小</dt>
              <dd>{formatBytes(local.size)}</dd>
            </div>
            <div className="read-field">
              <dt>来源</dt>
              <dd>此设备 · 未上传</dd>
            </div>
            <div className="read-field">
              <dt>项目绑定</dt>
              <dd>无 · 不修改当前项目</dd>
            </div>
          </dl>
          <p className="local-preview-note">
            关闭或切换范围后释放预览。最大 64 MB；文本最大 512 KB。浏览器不支持的编码不会自动转换。
          </p>
          <div className="modal-actions">
            <Button onClick={choose}>选择其他文件</Button>
            <a className="button" href={local.url} download={local.name}>
              下载本地副本
            </a>
            <Button onClick={release}>关闭</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
