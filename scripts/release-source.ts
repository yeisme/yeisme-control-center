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
