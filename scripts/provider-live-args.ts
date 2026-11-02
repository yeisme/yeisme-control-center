/**
 * Arguments of `scripts/test-provider-live.ts`, parsed without side effects so the workflow that calls it and the tests can
 * check the same rules. Budgets are USD, the currency owners cap a live run in, and are handed over unconverted; a CNY flag is
 * refused, never converted. Anything the script does not know is an error: a typo in a paid run must not be ignored.
 */
export const modalities = { eikona: "image", scaena: "video", sonora: "audio" } as const;
export type CanaryOwner = keyof typeof modalities;
export type CanaryModality = (typeof modalities)[CanaryOwner];

/** Flags that take no value. */
export const providerLiveSwitches = ["--confirm-live", "--dry-run"] as const;
/** Flags that take one value, with the value used when the flag is absent. */
export const providerLiveOptions = {
  "--modality": "image,video,audio",
  // The original keys are those of the 2026-10-14 canary: re-running without a label only reconciles those runs.
  "--run-label": "20261014",
  "--total-usd": "0",
  "--image-usd": "0",
  "--video-usd": "0",
  "--audio-usd": "0",
} as const;
export const providerLiveFlags: readonly string[] = [...providerLiveSwitches, ...Object.keys(providerLiveOptions)];

export interface ProviderLiveArgs {
  dryRun: boolean;
  confirmLive: boolean;
  /** Owners whose modality was asked for, in a fixed order. */
  selected: CanaryOwner[];
  label: string;
  total: number;
  caps: Record<CanaryOwner, number>;
  /** The normalised command, recorded in the evidence. */
  command: string;
}

const owners = Object.keys(modalities) as CanaryOwner[];

export function parseProviderLiveArgs(argv: readonly string[]): ProviderLiveArgs {
  const given = new Map<string, string>();
  const switches = new Set<string>();
  // A CNY flag (and its value) is set aside and explained below, rather than reported as an unknown argument.
  let cny = false;
  const tokens = argv.filter((arg) => arg !== "--");
  for (let at = 0; at < tokens.length; at += 1) {
    const arg = tokens[at];
    if (arg.endsWith("-cny")) { cny = true; if (tokens[at + 1] !== undefined && !tokens[at + 1].startsWith("--")) at += 1; continue; }
    if ((providerLiveSwitches as readonly string[]).includes(arg)) { switches.add(arg); continue; }
    if (!(arg in providerLiveOptions)) throw Error(`Unknown argument: ${arg.slice(0, 40)}`);
    const value = tokens[at + 1];
    if (value === undefined || value.startsWith("--")) throw Error(`${arg} requires a value.`);
    if (given.has(arg)) throw Error(`${arg} was given more than once.`);
    given.set(arg, value);
    at += 1;
  }
  const dryRun = switches.has("--dry-run");
  const confirmLive = switches.has("--confirm-live");
  if (!dryRun && !confirmLive) throw Error("Refusing live calls. Re-run with --confirm-live and explicit budget flags.");
  // Owners cap a live run in USD, so budgets are given in USD and handed over unconverted; CNY flags are refused, not converted.
  if (cny) throw Error("Budgets are in USD, the currency owners cap runs in. Use --total-usd and --image-usd/--video-usd/--audio-usd.");
  // An empty budget reads as 0 (not asked for); an empty modality or label is an error, never a quiet fall back to "all modalities".
  const value = (name: keyof typeof providerLiveOptions) => given.get(name) ?? providerLiveOptions[name];
  const requested = value("--modality").split(",");
  if (requested.some((modality) => !(Object.values(modalities) as string[]).includes(modality))) throw Error("--modality takes image, video and audio, separated by commas.");
  const only = new Set(requested);
  const selected = owners.filter((owner) => only.has(modalities[owner]));
  const label = value("--run-label");
  const total = Number(value("--total-usd"));
  const caps = { eikona: Number(value("--image-usd")), scaena: Number(value("--video-usd")), sonora: Number(value("--audio-usd")) };
  if (!selected.length || !/^[a-z0-9-]{4,40}$/.test(label) || !Number.isFinite(total) || total <= 0 || selected.some((owner) => !Number.isFinite(caps[owner]) || caps[owner] <= 0) || selected.reduce((sum, owner) => sum + caps[owner], 0) > total)
    throw Error("Invalid budget. Example: --modality audio --run-label 20261030 --total-usd 0.5 --audio-usd 0.5");
  const command = `bun run test:provider-live -- --confirm-live --modality ${selected.map((owner) => modalities[owner]).join(",")} --run-label ${label} --total-usd ${total} ${selected.map((owner) => `--${modalities[owner]}-usd ${caps[owner]}`).join(" ")}`;
  return { dryRun, confirmLive, selected, label, total, caps, command };
}
