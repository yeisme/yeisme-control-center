/** Narrow body-free projection of the template-registry catalog contract.
 * This is not a complete template catalog: no detail/resolve calls, registry
 * validation, authorization, or execution are represented here.
 * Unknown wire fields (including owner URLs, slots and actions) never escape.
 */
export type CatalogAvailability =
  | "ready"
  | "needs_contract"
  | "body_forbidden"
  | "stale"
  | "forbidden"
  | "unavailable";

export type TemplateMaturity = "unknown" | "exploratory";

export interface CatalogTemplate {
  readonly ref: string;
  readonly template_kind: string;
  readonly title: string;
  readonly package_id: string;
  readonly version: number;
  readonly version_ref: string;
  readonly digest: string;
  readonly release_state: string;
  readonly source_owner: string;
  readonly preview: { readonly body: "none" };
  // Neither field exists in catalog.v1. Release state is NOT maturity/rights.
  readonly maturity: "unknown";
  readonly rights: "unknown";
  readonly executable: false;
}

export interface SafeTemplateCatalog {
  readonly schema_version: 1;
  readonly contract_version: "template-registry.catalog.v1";
  readonly revision: number;
  readonly observed_at: string;
  readonly items: readonly CatalogTemplate[];
  readonly total_known: number;
  readonly next_cursor?: string;
  // Owner error text is deliberately omitted, even on a successful page.
  readonly degraded_owners?: readonly { readonly owner: string }[];
}

export type TemplateCatalogResult =
  | { readonly availability: "ready"; readonly catalog: SafeTemplateCatalog }
  | { readonly availability: Exclude<CatalogAvailability, "ready"> };

/** Callers provide an HTTP status and optional allowlisted contract code,
 * never an owner's arbitrary error object or message.
 */
export interface TemplateCatalogError {
  readonly status: number;
  readonly code?: string;
}

export function normalizeTemplateCatalogError(error: TemplateCatalogError): TemplateCatalogResult {
  if (error.status === 409) {
    switch (error.code) {
      case "conflict":
      case "cursor_conflict":
      case "stale_cursor":
        return { availability: "stale" };
      case "release_unavailable":
        return { availability: "unavailable" };
      default:
        return { availability: "needs_contract" };
    }
  }
  switch (error.status) {
    case 403: return { availability: "forbidden" };
    case 404:
    case 405: return { availability: "needs_contract" };
    default: return { availability: "unavailable" };
  }
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const natural = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const token = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
const owner = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const packageID = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 256 &&
  /^[A-Za-z0-9][A-Za-z0-9_-]*(?:[./][A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(value);
const title = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 512 &&
  !/[\u0000-\u001f\u007f]|[a-z][a-z0-9+.-]*:\/\/|file:|(?:^|\s)(?:\/|[A-Za-z]:\\|\\\\)/i.test(value);

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = match[7]!;
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59 &&
    (zone === "Z" || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59)) &&
    Number.isFinite(Date.parse(value));
}

// Cursors are opaque owner tokens. Only bound their size and reject controls.
function validCursor(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function normalizeItem(value: unknown): CatalogTemplate | undefined {
  if (!record(value) || !owner(value.source_owner) || !token(value.template_kind) ||
      !title(value.title) || !packageID(value.package_id) ||
      !natural(value.version) || value.version < 1 || !token(value.version_ref) ||
      !token(value.digest) || !token(value.release_state) ||
      !record(value.preview) || value.preview.body !== "none" || typeof value.ref !== "string") return;
  // Preserve opaque public owner references, never accept filesystem/URL references.
  const reference = /^owner:([a-z][a-z0-9_-]{0,63}):([a-z][a-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_-]{0,255})$/.exec(value.ref);
  if (!reference || reference[1] !== value.source_owner) return;
  return {
    ref: value.ref,
    template_kind: value.template_kind,
    title: value.title,
    package_id: value.package_id,
    version: value.version,
    version_ref: value.version_ref,
    digest: value.digest,
    release_state: value.release_state,
    source_owner: value.source_owner,
    preview: { body: "none" },
    maturity: "unknown",
    rights: "unknown",
    executable: false,
  };
}

/** Accept untrusted decoded JSON. Fail closed; never supply missing counts/data. */
export function normalizeTemplateCatalog(input: unknown): TemplateCatalogResult {
  // Inspect every item before projecting, so a forbidden body cannot survive even
  // when accompanied by an unsupported envelope or malformed adjacent item.
  if (record(input) && Array.isArray(input.items) && input.items.some((item: unknown) =>
    record(item) && record(item.preview) && "body" in item.preview && item.preview.body !== "none")) {
    return { availability: "body_forbidden" };
  }
  const invalid = { availability: "needs_contract" } as const;
  if (!record(input) || input.schema_version !== 1 ||
      input.contract_version !== "template-registry.catalog.v1" ||
      !natural(input.revision) || !validDate(input.observed_at) ||
      !Array.isArray(input.items) || !natural(input.total_known) ||
      input.items.length > input.total_known) return invalid;

  const items: CatalogTemplate[] = [];
  const refs = new Set<string>();
  for (const raw of input.items) {
    const item = normalizeItem(raw);
    if (!item || refs.has(item.ref)) return invalid;
    refs.add(item.ref);
    items.push(item);
  }
  if ("next_cursor" in input && !validCursor(input.next_cursor)) return invalid;
  let degraded: { owner: string }[] | undefined;
  if ("degraded_owners" in input) {
    if (!Array.isArray(input.degraded_owners)) return invalid;
    degraded = [];
    for (const entry of input.degraded_owners) {
      if (!record(entry) || !owner(entry.owner) || typeof entry.reason !== "string") return invalid;
      degraded.push({ owner: entry.owner });
    }
  }
  return {
    availability: "ready",
    catalog: {
      schema_version: 1,
      contract_version: "template-registry.catalog.v1",
      revision: input.revision,
      observed_at: input.observed_at,
      items,
      total_known: input.total_known,
      ...(typeof input.next_cursor === "string" ? { next_cursor: input.next_cursor } : {}),
      ...(degraded ? { degraded_owners: degraded } : {}),
    },
  };
}

export interface TemplateGoalCell {
  readonly id: string;
  readonly title: string;
  readonly maturity: TemplateMaturity;
  readonly catalogAvailability: "needs_contract";
  readonly rights: "unknown";
  readonly plan: {
    readonly referenceOnly: true;
    readonly executable: false;
    readonly description: string;
  };
}

/** Local reference descriptions, not owner evidence, registry entries or commands.
 * Catalog availability is independent of maturity and cannot be unlocked by a
 * successful list response. Matching owner evidence needs a separate contract.
 */
export const templateGoalCells = [
  {
    id: "drama-30-60s-experiment",
    title: "30–60 秒短剧实验",
    maturity: "exploratory",
    catalogAvailability: "needs_contract",
    rights: "unknown",
    plan: {
      referenceOnly: true,
      executable: false,
      description: "仅供参考：讨论短剧目标、时长与验收观察；尚无匹配 owner 证据，不代表可执行计划。",
    },
  },
  {
    id: "drama-single-scene-conflict",
    title: "单场景冲突",
    maturity: "unknown",
    catalogAvailability: "needs_contract",
    rights: "unknown",
    plan: {
      referenceOnly: true,
      executable: false,
      description: "仅供参考：梳理单场景人物诉求与冲突；需匹配 owner 契约及权利证据。",
    },
  },
  {
    id: "drama-character-consistency-demo",
    title: "角色一致性",
    maturity: "unknown",
    catalogAvailability: "needs_contract",
    rights: "unknown",
    plan: {
      referenceOnly: true,
      executable: false,
      description: "仅供参考：讨论角色特征与一致性观察；需匹配 owner 契约及权利证据。",
    },
  },
] as const satisfies readonly TemplateGoalCell[];
