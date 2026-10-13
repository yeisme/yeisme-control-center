import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover } from "./ui";
import {
  ArrowUpRight,
  Bell,
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  Inbox,
  Info,
  X,
} from "./icons";
import { Button } from "./ui";
import type { LibraryNotice } from "./asset-library";

export function NotificationCenter({
  notices,
  onOpenAsset,
  onDismissToast,
  toast,
}: {
  notices: LibraryNotice[];
  onOpenAsset: (id: string) => void;
  toast: string;
  onDismissToast: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<string[]>([]);
  const [tab, setTab] = useState("all");
  const unread = notices.filter((n) => !read.includes(n.id));
  const visible = tab === "unread" ? unread : notices;
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismissToast);
  dismiss.current = onDismissToast;
  useEffect(() => {
    if (!toast) {
      setPaused(false);
      return;
    }
    if (paused) return;
    const timer = setTimeout(() => dismiss.current(), 6500);
    return () => clearTimeout(timer);
  }, [toast, paused]);
  const warning = /失败|不允许|不能|冲突|不可|已不存在/.test(toast);
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className="icon-button notification-trigger"
          aria-label={"通知中心，" + unread.length + " 条未读"}
          data-od-id="notification-center-trigger"
        >
          <Bell size={18} />
          {unread.length > 0 && <span className="notification-dot" />}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="notification-panel"
            align="end"
            sideOffset={12}
            collisionPadding={12}
            data-od-id="notification-center"
          >
            <div className="notification-heading">
              <div>
                <h2>通知中心</h2>
                <p>当前范围 · 演示会话</p>
              </div>
              <Popover.Close className="icon-button" aria-label="关闭通知中心">
                <X size={17} />
              </Popover.Close>
            </div>
            <div className="notification-tabs">
              <div role="tablist" aria-label="通知筛选">
                <button
                  role="tab"
                  aria-selected={tab === "all"}
                  onClick={() => setTab("all")}
                >
                  全部 <span>{notices.length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "unread"}
                  onClick={() => setTab("unread")}
                >
                  未读 <span>{unread.length}</span>
                </button>
              </div>
              <button
                className="mark-all-read"
                disabled={!unread.length}
                onClick={() => setRead(notices.map((n) => n.id))}
              >
                <CheckCheck size={14} />
                全部已读
              </button>
            </div>
            <div
              className="notification-list"
              role="tabpanel"
              aria-label={tab === "all" ? "全部通知" : "未读通知"}
            >
              {visible.map((n) => (
                <article
                  key={n.id}
                  className="notification-item"
                  data-read={read.includes(n.id)}
                  data-od-id={"notification-" + n.id}
                >
                  <div className={"notification-symbol " + n.tone}>
                    {n.tone === "warning" ? (
                      <CircleAlert size={18} />
                    ) : n.tone === "success" ? (
                      <CheckCircle2 size={18} />
                    ) : (
                      <Info size={18} />
                    )}
                  </div>
                  <div className="notification-copy">
                    <h3>
                      {n.title}
                      {!read.includes(n.id) && (
                        <span className="unread-indicator" />
                      )}
                    </h3>
                    <p>{n.text}</p>
                    <div className="notification-actions">
                      {n.asset ? (
                        <button
                          onClick={() => {
                            setRead((v) => [...v, n.id]);
                            setOpen(false);
                            onOpenAsset(n.asset!);
                          }}
                        >
                          查看产物
                          <ArrowUpRight size={13} />
                        </button>
                      ) : (
                        <small>本次会话</small>
                      )}
                      {!read.includes(n.id) && (
                        <button onClick={() => setRead((v) => [...v, n.id])}>
                          标记已读
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
              {!visible.length && (
                <div className="notification-empty">
                  <Inbox size={30} />
                  <strong>
                    {tab === "unread" ? "所有通知都已读" : "暂无通知"}
                  </strong>
                  <p>产物提醒与操作结果会保留在这里。</p>
                </div>
              )}
            </div>
            <div className="notification-footer">
              不连接推送服务 · 切换范围后重新归集
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {toast &&
        document.getElementById("notification-feedback") &&
        createPortal(
          <div
            role="status"
            className={"toast polished-toast " + (warning ? "warning" : "")}
            data-od-id="operation-toast"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setPaused(false);
            }}
          >
            {warning ? <CircleAlert size={20} /> : <CheckCircle2 size={20} />}
            <div>
              <strong>{warning ? "需要留意" : "操作反馈"}</strong>
              <p>{toast}</p>
            </div>
            <Button
              onClick={() => {
                onDismissToast();
                setOpen(true);
              }}
            >
              查看通知
            </Button>
            <button
              className="icon-button"
              aria-label="关闭提示"
              onClick={onDismissToast}
            >
              <X size={16} />
            </button>
          </div>,
          document.getElementById("notification-feedback")!,
        )}
    </>
  );
}
