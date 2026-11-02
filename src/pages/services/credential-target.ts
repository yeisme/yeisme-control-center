import { credentialNeedsAttention, type CredentialStatus } from "../../shared/credentials";

/** The credential row a deep link names, and where it sits in the panel. */
export interface CredentialTarget {
  id: string;
  /** It is among the healthy rows, which the panel folds away: that group has to be open for the row to be seen. */
  folded: boolean;
}

/**
 * The row that `#/services?ref=<slot>` points at: the one whose slot id is exactly `ref`, or nothing. The work queue's
 * renewal items link here with the slot of the credential they are about. A missing, unknown or near-miss slot names no
 * row (no prefix, case-folding or trimming), so the page then simply opens as it always does.
 */
export function credentialTarget(rows: readonly CredentialStatus[], ref: string | null | undefined): CredentialTarget | null {
  if (!ref) return null;
  const row = rows.find((candidate) => candidate.id === ref);
  return row ? { id: row.id, folded: !credentialNeedsAttention(row) } : null;
}
