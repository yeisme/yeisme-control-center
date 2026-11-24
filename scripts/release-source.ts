import { execFileSync } from "node:child_process";

/**
 * Which source a release candidate was built from, and whether it was clean. Pure helpers plus one git reader, so the dirty-tree
 * rule is testable without a repository: `prepare-intranet-release.ts` refuses to build from a tree whose tracked files differ
 * from HEAD, because the commit it records would not describe the bytes it ships.
 */

/** Tracked changes in `git status --porcelain` output. Untracked ("??") and ignored ("!!") files are not part of the source. */
export function trackedChanges(porcelain: string): string[] {
  return porcelain.split("\n").filter((line) => line.trim() && !line.startsWith("??") && !line.startsWith("!!"));
}

export interface ReviewedSourceEntry {
  path: string;
  state: "tracked" | "untracked";
  sha256: string;
}

/** A reviewed release input may include untracked source, but never private or generated material. */
export function reviewedSourceEntries(porcelain: string, digests: Record<string, string>): ReviewedSourceEntry[] {
  const entries = porcelain.split("\n").filter((line) => line.trim()).map((line) => ({ state: line.startsWith("??") ? "untracked" as const : "tracked" as const, path: line.slice(3).trim() }));
  const denied = /^(?:temp|dist|node_modules|drizzle|design-proposals|docs|openspec|\.pi(?:-bg)?)\/|\.sqlite|config\.json|\.key$|credential|secret/i;
  if (entries.some((entry) => !entry.path || entry.path.includes("..") || denied.test(entry.path) || !digests[entry.path])) throw new Error("reviewed_source_invalid");
  return entries.map((entry) => ({ ...entry, sha256: digests[entry.path] })).sort((a, b) => a.path.localeCompare(b.path));
}

export class DirtyTreeError extends Error {
  constructor(readonly changed: string[]) {
    super("dirty_working_tree");
  }
}

export interface TreeState {
  dirty: boolean;
  changed_files: number;
  /** True when the tree is dirty and `YEISME_RELEASE_ALLOW_DIRTY=1` let the build go on anyway. */
  dirty_allowed: boolean;
}

/** Throws `DirtyTreeError` when tracked files differ from HEAD, unless `YEISME_RELEASE_ALLOW_DIRTY=1`. */
export function releaseTreeState(porcelain: string, env: Record<string, string | undefined> = process.env): TreeState {
  const changed = trackedChanges(porcelain);
  const allowed = env.YEISME_RELEASE_ALLOW_DIRTY === "1";
  if (changed.length && !allowed) throw new DirtyTreeError(changed);
  return { dirty: changed.length > 0, changed_files: changed.length, dirty_allowed: changed.length > 0 && allowed };
}

export interface ReleaseSource {
  source_commit: string;
  /** Raw `git status --porcelain --untracked-files=no`, for `releaseTreeState`. */
  porcelain: string;
}

export function readReleaseSource(cwd: string): ReleaseSource {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { source_commit: git("rev-parse", "HEAD").trim(), porcelain: git("status", "--porcelain", "--untracked-files=no") };
}
