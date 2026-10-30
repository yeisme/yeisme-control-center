import { useNavigate } from "react-router-dom";
import { Clock3, Unplug } from "../icons";
import { useTasks } from "../app/tasks-context";
import { InlineNotice, NoticeAction } from "./ui";
import { sourceLine, sourceStatus } from "../shared/source-status";

/**
 * A page's one line about missing or old task data. The top bar's source status carries the per-connection details;
 * this line says what the page lacks and reaches 服务与连接 in one step. `noun` names what the page lists.
 * `partial={false}` leaves partial reads to pages that already list the blocked sources, such as the work queue.
 */
export function SourceStatusLine({ noun, partial = true }: { noun: string; partial?: boolean }) {
  const tasks = useTasks();
  const navigate = useNavigate();
  const status = sourceStatus(tasks);
  const line = sourceLine(status, noun);
  if (!line || (!partial && status.kind === "partial")) return null;
  return <InlineNotice
    tone="warning"
    role="status"
    icon={status.kind === "stale" ? <Clock3 /> : <Unplug />}
    actions={<>
      {line.retry && <NoticeAction onClick={tasks.refresh}>重新读取</NoticeAction>}
      <NoticeAction onClick={() => navigate("/services")}>服务与连接</NoticeAction>
    </>}
  >{line.text}</InlineNotice>;
}
