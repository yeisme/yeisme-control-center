import { accessSync, constants, statSync } from "node:fs";

/**
 * The rule every credential file has to pass, shared by `secret()` (which refuses to read a bad file) and the
 * credential status view (which reports one). Only the file's metadata and whether this process may read it are
 * looked at, never its content.
 */
export type CredentialFileReason = "missing" | "not_file" | "permissions" | "empty";

/** The part of `fs.Stats` the rule needs; tests inject their own. */
export interface CredentialFileStat {
  isFile(): boolean;
  mode: number;
  size: number;
  /** False when this process may not read the file although its mode allows the owner (it belongs to another user). */
  readable?: boolean;
}
export type CredentialStat = (ref: string) => CredentialFileStat | null;

const canRead = (ref: string) => {
  try {
    accessSync(ref, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

/** A path that cannot be reached at all (absent, or behind a directory the server cannot enter) is null. */
export const statCredentialFile: CredentialStat = (ref) => {
  try {
    const found = statSync(ref);
    return { isFile: () => found.isFile(), mode: found.mode, size: found.size, readable: canRead(ref) };
  } catch {
    return null;
  }
};

/**
 * Why a credential file may not be used, or null when it may: it has to exist, be a regular file, carry no group or
 * other permission bit, be readable by this process (a 0600 file of another user is not) and not be empty.
 */
export function credentialFileProblem(ref: string, stat: CredentialStat = statCredentialFile): CredentialFileReason | null {
  const found = stat(ref);
  if (!found) return "missing";
  if (!found.isFile()) return "not_file";
  if (found.mode & 0o077 || found.readable === false) return "permissions";
  if (found.size === 0) return "empty";
  return null;
}

/** The reason `secret()` attached to its `credential_unreadable` error, if this is one. */
export function credentialReasonOf(error: unknown): CredentialFileReason | undefined {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return reason === "missing" || reason === "not_file" || reason === "permissions" || reason === "empty" ? reason : undefined;
}
