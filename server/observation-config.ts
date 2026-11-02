import type { ObservationConfig, ServerConfig } from "./contracts";

/** The documented bounds and defaults of the `observation` block in the server config. */
export const observationBounds = {
  defaultIntervalMinutes: 10,
  minIntervalMinutes: 5,
  maxIntervalMinutes: 24 * 60,
  defaultOpenToolsEvery: 3,
  minOpenToolsEvery: 1,
  maxOpenToolsEvery: 1000,
  maxRecipients: 100,
  maxRecipientLength: 200,
} as const;

/**
 * What is wrong with an `observation` block, as short fixed codes (never the offending value). Nothing is wrong with a
 * missing block, or with one that omits optional keys. A block with any problem is treated as switched off, because a
 * half-understood schedule or recipient list is worse than none.
 */
export function observationProblems(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) return ["observation_not_an_object"];
  const block = raw as Record<string, unknown>;
  const problems: string[] = [];
  if (block.enabled !== undefined && typeof block.enabled !== "boolean") problems.push("observation_enabled_not_boolean");
  const minutes = block.interval_minutes;
  if (minutes !== undefined && !(typeof minutes === "number" && Number.isFinite(minutes) && minutes >= observationBounds.minIntervalMinutes && minutes <= observationBounds.maxIntervalMinutes)) problems.push("observation_interval_out_of_range");
  const every = block.open_tools_every;
  if (every !== undefined && !(typeof every === "number" && Number.isInteger(every) && every >= observationBounds.minOpenToolsEvery && every <= observationBounds.maxOpenToolsEvery)) problems.push("observation_open_tools_every_out_of_range");
  const recipients = block.recipients;
  if (recipients !== undefined && !(Array.isArray(recipients) && recipients.length <= observationBounds.maxRecipients && recipients.every((identity) => typeof identity === "string" && identity.length > 0 && identity.length <= observationBounds.maxRecipientLength))) problems.push("observation_recipients_invalid");
  return problems;
}

/**
 * The observation settings with the documented defaults. Total: whatever the config holds, this returns and never
 * throws, so the status route and the recipient lookup cannot fail on a bad block; a bad block reads as disabled with
 * the defaults and `valid: false`.
 */
export function observationSettings(config: Pick<ServerConfig, "observation">) {
  const problems = observationProblems(config.observation);
  const block: Partial<ObservationConfig> | undefined = problems.length ? undefined : (config.observation as ObservationConfig | undefined) ?? undefined;
  return {
    enabled: block?.enabled === true,
    /** False when the block exists but is malformed; the loop is then off. */
    valid: problems.length === 0,
    problems,
    intervalMinutes: block?.interval_minutes ?? observationBounds.defaultIntervalMinutes,
    openToolsEvery: block?.open_tools_every ?? observationBounds.defaultOpenToolsEvery,
    /** Identities named in the config, possibly none; an empty list means the default recipients. */
    recipients: block?.recipients ?? ([] as string[]),
  };
}
