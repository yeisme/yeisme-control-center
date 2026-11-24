import type { Session } from "./contracts";
import type { CollaborationService } from "./collaboration";

/** Authentication, origin and epoch envelopes remain in the application boundary. */
export function projectCollectionRead(path: string, session: Session, collaboration: CollaborationService): object | null {
  const match = /^\/projects\/([^/]+)\/(collection-binding|collection-binding-options)$/.exec(path);
  if (!match) return null;
  let projectID: string;
  try { projectID = decodeURIComponent(match[1]); } catch { return null; }
  if (match[2] === "collection-binding") return collaboration.collectionBinding(session, projectID);
  return { rows: collaboration.collectionBindingOptions(session, projectID), revision: collaboration.project(session, projectID).revision };
}
