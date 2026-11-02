/**
 * Bun ends the process on a promise rejection nobody handled, and a detached background task (a status poll, a loop cycle)
 * can reject long after the request that started it. One such failure must not take the control center down, so the
 * process installs this handler: it records that a rejection happened and keeps running.
 */

/** A short code for a rejected value, for the log. The message is left out on purpose: it may carry a path, a token or a request body. */
export function rejectionCode(reason: unknown): string {
  const safe = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : undefined);
  if (reason && typeof reason === "object") return safe((reason as { code?: unknown }).code) ?? safe((reason as { name?: unknown }).name) ?? "object";
  return typeof reason;
}

export function guardRejections(target: Pick<NodeJS.Process, "on">, log: (line: string) => void = console.error) {
  target.on("unhandledRejection", (reason) => {
    log(`[control-center] unhandled_rejection ${rejectionCode(reason)}`);
  });
}
