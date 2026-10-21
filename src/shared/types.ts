// Frozen control-center contract additions (C2, change yeisme-control-center-frontend-backend-v1).
// Additive only; the typed client in shared/api consumes these.

/** Stable error class carried on every control-center error envelope. */
export type ControlCenterErrorClass =
  | "login_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "rate_limited"
  | "expired"
  | "unavailable";

export interface ControlCenterErrorBody {
  error: string;
  class: ControlCenterErrorClass;
}

/**
 * Session-level epoch echoed by the server on /session and every scope-bound
 * GET envelope. A changed epoch means cached scope data and in-flight
 * responses are stale and must be dropped, never rendered.
 */
export interface ScopeEpochTag {
  epoch: number;
}
