import { useEffect, useRef, useState } from "react";
import { Tabs } from "./ui";
import {
  ArrowUpRight,
  Check,
  Folder,
  Image,
  Link2,
  Pencil,
  ShieldCheck,
  Star,
} from "./icons";
import { Button, Field } from "./ui";
import { CopyReference } from "./workspace";
import { MediaPreview, type Unavailable } from "./media-preview";
import type { LocalKind } from "./media-preview-state";
import { projectName, serviceById, type Asset, type Scenario } from "./data";
import type { AssetLibraryState } from "./asset-library-state";

const assetKinds: Record<string, LocalKind> = {
  图像: "image",
  视频: "video",
  音频: "audio",
  文稿: "text",
};

function previewFor(asset: Asset): {
  kind: LocalKind;
  src?: string;
  unavailable?: Unavailable;
  caption: string;
} {
  if (asset.image)
    return {
      kind: "image",
      src: "./media/" + asset.image,
      caption: "参考摄影 · 非生成成果",
    };
  const kind = assetKinds[asset.type] ?? "file";
  const unavailable: Unavailable =
    kind === "audio"
      ? {
          title: "音频版本已登记",
          body: "真实审听媒体尚未接入，不提供模拟播放。",
          tag: "仅元数据",
        }
      : kind === "text"
        ? {
            title: "文稿版本已登记",
            body: "正文由 Auctra 保存，当前仅展示版本与来源。",
            tag: "仅元数据",
          }
        : {
            title: asset.type + "版本已登记",
            body: "尚未提供可读取的内容字节，不根据引用构造媒体。",
            tag: "仅元数据",
          };
  return {
    kind,
    unavailable,
    caption: "固定版本的引用与内容权限分别保留",
  };
}

export function AssetDetail({
  asset,
  state,
  setState,
  writable,
  scenario,
  onTask,
  onReviews,
  notify,
  onDirty,
  guard,
}: {
  asset: Asset;
  state: AssetLibraryState;
  setState: (value: AssetLibraryState) => void;
  writable: boolean;
  scenario: Scenario;
  onTask: (id: string) => void;
  onReviews: () => void;
  notify: (text: string) => void;
  onDirty: (dirty: boolean, discard?: () => void) => void;
  guard: (action: () => void) => void;
}) {
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(state.notes[asset.id] || "");
  const [error, setError] = useState("");
  const dirtyCallback = useRef(onDirty);
  dirtyCallback.current = onDirty;
  const dirty = editing && note !== (state.notes[asset.id] || "");
  useEffect(() => {
    dirtyCallback.current(dirty, () => {
      setEditing(false);
      setNote(state.notes[asset.id] || "");
      setError("");
    });
    return () => dirtyCallback.current(false);
  }, [dirty, asset.id]);
  const favorite = state.favorites.includes(asset.id);
  const preview = previewFor(asset);
  return (
    <div className="asset-detail" data-od-id="asset-detail-panel">
      <div className="asset-detail-caption">
        <span>
          {asset.type} · {asset.version}
        </span>
        <Button
          onClick={() => {
            setState({
              ...state,
              favorites: favorite
                ? state.favorites.filter((id) => id !== asset.id)
                : [...state.favorites, asset.id],
            });
            notify(favorite ? "已取消收藏。" : "已收藏此产物。");
          }}
          aria-pressed={favorite}
        >
          <Star size={15} fill={favorite ? "currentColor" : "none"} />
          {favorite ? "已收藏" : "收藏"}
        </Button>
      </div>
      <Tabs.Root
        value={tab}
        onValueChange={setTab}
        className="asset-detail-tabs"
      >
        <Tabs.List aria-label="产物详情">
          <Tabs.Trigger value="overview">概览</Tabs.Trigger>
          <Tabs.Trigger value="lineage">来源与版本</Tabs.Trigger>
          <Tabs.Trigger value="handoff">权利与交接</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview">
          <div className="asset-workspace-grid">
            <MediaPreview
              kind={preview.kind}
              src={preview.src}
              alt="参考摄影，非真实生成产物"
              label={asset.name}
              unavailable={preview.unavailable}
              caption={preview.caption}
            />
            <div className="asset-properties">
              <h3>产物信息</h3>
              <dl className="read-fields">
                <div className="read-field">
                  <dt>所属项目</dt>
                  <dd>{projectName(asset.project)}</dd>
                </div>
                <div className="read-field">
                  <dt>生成来源</dt>
                  <dd>{serviceById(asset.owner)?.name}</dd>
                </div>
                <div className="read-field">
                  <dt>版本状态</dt>
                  <dd>{asset.state}</dd>
                </div>
                <div className="read-field">
                  <dt>所在目录</dt>
                  <dd className="asset-folder-value">
                    <Folder size={14} />
                    {state.folders.find((f) => f.id === state.locations[asset.id])
                      ?.name || "未归类"}
                  </dd>
                </div>
                <div className="read-field">
                  <dt>稳定引用</dt>
                  <dd>
                    <CopyReference value={asset.id} />
                  </dd>
                </div>
              </dl>
              <div className="asset-note-heading">
                <h3>整理备注</h3>
                {!editing && (
                  <Button
                    disabled={!writable}
                    onClick={() =>
                      guard(() => {
                        setNote(state.notes[asset.id] || "");
                        setEditing(true);
                      })
                    }
                  >
                    <Pencil size={13} />
                    编辑
                  </Button>
                )}
              </div>
              {editing ? (
                <form
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!writable) {
                      setError("当前身份或服务状态不允许保存备注。");
                      return;
                    }
                    if (note.length > 300) {
                      setError("备注最多 300 个字符。");
                      document.getElementById("asset-note")?.focus();
                      return;
                    }
                    if (scenario === "save_error" || scenario === "conflict") {
                      setError(
                        "保存未完成，原备注和当前草稿均已保留。请重新读取后再修改。",
                      );
                      return;
                    }
                    setState({
                      ...state,
                      notes: { ...state.notes, [asset.id]: note.trim() },
                    });
                    setEditing(false);
                    notify("产物备注已保存到当前演示会话。");
                  }}
                >
                  <Field
                    label="产物备注"
                    error={error}
                    hint="用于团队整理，不会修改生成提示词或原始文件。"
                  >
                    <textarea
                      id="asset-note"
                      data-od-id="asset-note-input"
                      autoFocus
                      value={note}
                      placeholder="记录这个版本的用途、选择理由或待改进之处…"
                      onChange={(event) => {
                        setNote(event.target.value);
                        setError("");
                      }}
                      onBlur={() =>
                        setError(
                          note.length > 300 ? "备注最多 300 个字符。" : "",
                        )
                      }
                    />
                  </Field>
                  <div
                    className="asset-note-counter"
                    data-invalid={note.length > 300}
                  >
                    {note.length} / 300
                  </div>
                  <div className="library-form-actions">
                    <Button onClick={() => guard(() => setEditing(false))}>
                      取消
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!dirty || !writable}
                    >
                      保存备注
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="asset-note-body">
                  {state.notes[asset.id] ||
                    "尚未添加备注。记录用途与选择理由，让后续交接更清楚。"}
                </p>
              )}
            </div>
          </div>
        </Tabs.Content>
        <Tabs.Content value="lineage">
          <h3>可追溯的固定版本</h3>
          <ol className="asset-lineage">
            <li>
              <span>
                <Link2 size={15} />
              </span>
              <div>
                <strong>原始来源</strong>
                <p>{asset.source}</p>
              </div>
            </li>
            <li>
              <span>
                <Check size={15} />
              </span>
              <div>
                <strong>当前固定版本 · {asset.version}</strong>
                <p>{asset.state} · 不自动替换消费方引用</p>
              </div>
            </li>
            <li>
              <span>
                <Image size={15} />
              </span>
              <div>
                <strong>生成参数与提示词</strong>
                <p>当前 owner 未提供，不推断模型、尺寸、时长或生成参数。</p>
              </div>
            </li>
          </ol>
          <p className="asset-detail-limit">
            仅登记当前版本，尚无其他历史版本可供比较。
          </p>
          {asset.operation && (
            <Button onClick={() => onTask(asset.operation!)}>
              查看来源任务
              <ArrowUpRight size={14} />
            </Button>
          )}
        </Tabs.Content>
        <Tabs.Content value="handoff">
          <div className="asset-rights">
            <ShieldCheck size={20} />
            <div>
              <h3>使用边界</h3>
              <p>{asset.rights}</p>
            </div>
          </div>
          <h3>交接状态</h3>
          <p className="asset-handoff-copy">{asset.handoff}</p>
          <p className="asset-detail-limit">
            目录整理与收藏不代表权利批准或生产采用，正式决定由原服务执行。
          </p>
          <Button onClick={onReviews}>
            查看审阅与批准
            <ArrowUpRight size={14} />
          </Button>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
