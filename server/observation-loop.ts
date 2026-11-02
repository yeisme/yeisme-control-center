import type { OpenToolKind, OpenToolProjection } from "../src/shared/open-tools";
import type { TaskSnapshot } from "../src/task-observation";
import type { ScopeBinding, ServerConfig, TaskConnection } from "./contracts";
import type { ControlState } from "./db/control-state";
import { attentionStates, failureFact, type FailureFact, type NotificationStore } from "./notifications";
import { observationBounds, observationSettings } from "./observation-config";
import { advance, failed, restart, settle, startOfScan, type FirstPages, type ListMode, type RollingPosition } from "./observation-scan";
import type { OpenToolService } from "./open-tools/service";
import { baseScopes, reminderRecipients } from "./personal-accounts";
import type { TaskConnections } from "./task-connections";

export { observationProblems, observationSettings } from "./observation-config";

/**
 * Background observation: failed tasks and open-tool runs that need attention become reminders without a browser being
 * open. It reads only the task owners behind configured connections and the open tools (DriveBridge, MCP Gateway),
 * with the credentials those connections already hold. It never calls a Provider, never calls Auctra, never writes to
 * an owner, and never reads a task body: the facts come from pages of each connection's task lists.
 */
export const observationLimits = {
  ...observationBounds,
  /** Owner HTTP requests in one cycle: MCP handshakes, list pages and every request of an open-tool reading all count. */
  callsPerCycle: 40,
  /** Requests reserved for each connection read: page 1 of active and of history and one rolling page, and one more for the MCP handshake of a connection that has no session yet. */
  callsPerConnection: 3,
  /** Spare requests deepen one connection's rolling read up to this many requests in a cycle, handshake and first pages included. */
  maxCallsPerConnection: 8,
  /** Failed reads of one rolling page in a row after which the walk gives that page up. */
  walkPageAttempts: 3,
  /** The first cycle runs this long after start, plus up to `firstCycleJitterMs`, so a restart never reads at once. */
  firstCycleMs: 60_000,
  firstCycleJitterMs: 15_000,
  /** A connection that could not be read waits twice as long after each further failure, up to this. */
  maxBackoffMs: 60 * 60_000,
  /** Failed or unknown runs per open tool that become reminders in one cycle. */
  operationRemindersPerTool: 10,
  /** Tasks last updated before (observation began - this) never open a reminder, so turning the loop on is not a flood. */
  floodWindowMs: 24 * 60 * 60_000,
} as const;

/** The control_state name holding when this stretch of observation began: the first enabling, or the last re-enabling. */
export const enabledAtState = "observation_enabled_at";
/** The control_state name holding when the last cycle began, so a long gap can be told from a short restart. */
export const lastCycleState = "observation_last_cycle_at";
/** What the ledger records as the session of a reminder the loop wrote. */
export const backgroundSession = "background";

/**
 * One credential problem to remind about. `server/observation-credentials.ts` works them out from the credential
 * lifecycle; the loop only delivers them, to every recipient of the scope they were asked for, as category `credential`
 * reminders, and ends the ones that are no longer in the list.
 */
export interface CredentialReminderFact {
  slot: string;
  state: string;
  stage: string;
  title: string;
  owner?: string;
  error_code?: string;
}

/**
 * What a cycle could say about credentials for one scope. `unknown` holds the event keys of reminders about things the
 * control center has no reading of this cycle (a connection not read since the process started, a tool whose only reading
 * got no answer): the loop leaves an open reminder under such a key as it is. Not knowing is not recovery; ending one
 * on a guess, and opening it again at the next refusal, would hand the person back an unread reminder they had handled.
 */
export interface CredentialReading {
  facts: CredentialReminderFact[];
  unknown: string[];
}

/** The event name that makes one credential reminder per slot, state and stage. */
export const credentialEventKey = (fact: Pick<CredentialReminderFact, "slot" | "state" | "stage">) => `credential:${fact.slot}:${fact.state}:${fact.stage}`;

/** What one cycle did for one observed scope. Counts and codes only. */
export interface ScopeCycle {
  /**
   * Owner HTTP requests made for the scope's connections and open tools, as the budget counts them: handshakes, list
   * pages and open-tool requests. A connection or tool shared by several scopes counts for each of them.
   */
  calls: number;
  /** Task list pages asked for, first pages and rolling pages. */
  pages_read: number;
  /** Rolling pages the walk gave up after repeated failures; a pass that gave one up is not a complete pass. */
  pages_skipped: number;
  reminders_opened: number;
  reminders_recovered: number;
  errors: Record<string, number>;
  /** Task connections whose lists were read; the others were waiting out a backoff or left for the next cycle. */
  connections_read: number;
  connections_skipped: number;
  /** Connections whose rolling read has not yet completed a pass over both lists since the process started, a pass that gave a page up not counted. */
  scan_incomplete: number;
  open_tools_read: boolean;
}

/** What one cycle did, for the process log and, per scope, for `GET /observation/status`: the totals over every scope. */
export interface CycleSummary extends ScopeCycle {
  started_at: string;
  finished_at: string;
  /** The same counts for each observed scope; a session is shown only its own scopes. */
  scopes: Record<string, ScopeCycle>;
  /** Errors that belong to no scope: the config, the credential hook, the cycle itself. Already part of `errors`. */
  shared_errors: Record<string, number>;
}

const emptyScope = (): ScopeCycle => ({ calls: 0, pages_read: 0, pages_skipped: 0, reminders_opened: 0, reminders_recovered: 0, errors: {}, connections_read: 0, connections_skipped: 0, scan_incomplete: 0, open_tools_read: false });

/** The part of the control center the loop needs; `ControlServices` in server/app.ts provides it. */
export interface ObservationServices {
  config: ServerConfig;
  /** Takes the account list from the configuration file when it changed; recipients are read from that list. */
  auth?: { refreshPersonalUsers(): void };
  tasks: TaskConnections;
  openTools: OpenToolService;
  notifications: NotificationStore;
  state: ControlState;
  clock: () => number;
  observation?: ObservationLoop;
}

interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ObservationLoopOptions {
  /** Delay before the first cycle; defaults to 60 s plus up to 15 s of jitter. */
  firstCycleMs?: number;
  random?: () => number;
  timers?: Timers;
  log?: (line: string) => void;
  /**
   * The credential problems of one observed scope, asked once per scope and cycle. It must not call an owner. Nothing by
   * default; when it is given, a credential reminder of that scope that is neither among the facts nor under an unknown
   * key is recovered, and when it throws nothing is opened or recovered for that scope in the cycle.
   */
  credentials?: (nowMs: number, scope: ScopeBinding) => CredentialReading;
}

const systemTimers: Timers = {
  set: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    // The HTTP server keeps the process alive; the loop must not.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const iso = (ms: number) => new Date(ms).toISOString();
const codeOf = (value: unknown) => String(value || "unknown").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64);
const idsOf = (unit: { targets: { scope: { id: string } }[] }) => unit.targets.map((target) => target.scope.id);

interface Unit {
  /** The connection id: a connection is read once per cycle, whatever number of scopes have it. */
  key: string;
  connection: TaskConnection;
  /** The scopes that have the connection and someone to remind, each with its recipients; the owner is read through the first. */
  targets: Target[];
}
interface Target {
  scope: ScopeBinding;
  recipients: string[];
}
/** One page to read: a list of a connection, from the owner's cursor (undefined for page 1). */
interface Probe {
  unit: Unit;
  mode: ListMode;
  from: string | undefined;
}
/**
 * How reading one page went: the connection's state, the owner's cursor for the page after a good one (`next`), the
 * same for a page that failed after the owner answered (`skip`), and the owner requests the read made.
 */
interface Answer {
  ok: boolean;
  state: string;
  next?: string;
  skip?: string;
  requests: number;
}
type Counter = "calls" | "pages_read" | "pages_skipped" | "reminders_opened" | "reminders_recovered" | "connections_read" | "connections_skipped" | "scan_incomplete";
/** Adds to a counter in the cycle totals once and in each of the given scopes. */
type Bump = (scopeIds: string[], field: Counter, n?: number) => void;
/** Counts an error code in the totals and in the scopes it belongs to, or as a shared error when none is named. */
type Fail = (code: unknown, ...scopeIds: string[]) => void;

export class ObservationLoop {
  private timer: unknown;
  private inflight?: Promise<CycleSummary>;
  private started = false;
  private closing = false;
  /** Bumped by every start and stop: a tick that began under an earlier number never schedules anything. */
  private generation = 0;
  private cycles = 0;
  /** Where the next cycle starts among the connections, so a long list is read round-robin. */
  private cursor = 0;
  private last: CycleSummary | null = null;
  private lastErrors = "";
  private next: number | null = null;
  private readonly backoff = new Map<string, { failures: number; until: number }>();
  /** Where each connection's rolling read stands. Memory only: a restart walks the lists again from their start. */
  private readonly positions = new Map<string, RollingPosition>();
  private readonly timers: Timers;
  private readonly random: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly services: ObservationServices, private readonly options: ObservationLoopOptions = {}) {
    this.timers = options.timers ?? systemTimers;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** True between `start()` and `stop()`. */
  get running() {
    return this.started && !this.closing;
  }
  get lastCycle() {
    return this.last;
  }
  /** When the next scheduled cycle runs (ISO), or null when none is scheduled. */
  get nextRunAt() {
    return this.next === null ? null : iso(this.next);
  }
  get cycleCount() {
    return this.cycles;
  }
  get intervalMs() {
    return observationSettings(this.services.config).intervalMinutes * 60_000;
  }

  start() {
    if (this.started && !this.closing) return;
    this.started = true;
    this.closing = false;
    const generation = ++this.generation;
    // Remember when this began even if the process stops before the first cycle; a failed write is retried by the cycle.
    try { this.enabledAt(this.services.clock()); } catch { /* the first cycle records it */ }
    this.schedule(this.options.firstCycleMs ?? observationLimits.firstCycleMs + Math.floor(this.random() * observationLimits.firstCycleJitterMs), generation);
  }

  /** Cancels the timer and waits for a cycle that is already running; that cycle stops at the next round of reads. */
  async stop() {
    this.closing = true;
    // A tick still running belongs to a run that is over: whatever happens next, it must not schedule or overwrite a timer.
    this.generation++;
    this.cancel();
    await this.inflight?.catch(() => undefined);
  }

  /** One cycle now. A cycle already running is returned instead of starting a second. */
  runCycle(): Promise<CycleSummary> {
    if (this.inflight) return this.inflight;
    const work = this.cycle().finally(() => {
      if (this.inflight === work) this.inflight = undefined;
    });
    this.inflight = work;
    return work;
  }

  private cancel() {
    if (this.timer !== undefined) this.timers.clear(this.timer);
    this.timer = undefined;
    this.next = null;
  }

  private schedule(delayMs: number, generation: number) {
    if (this.closing || generation !== this.generation) return;
    // Never two timers: whatever is still pending is replaced.
    this.cancel();
    this.next = this.services.clock() + delayMs;
    this.timer = this.timers.set(() => void this.tick(generation), delayMs);
  }

  private async tick(generation: number) {
    if (generation !== this.generation) return;
    this.timer = undefined;
    this.next = null;
    try {
      await this.runCycle();
    } catch (error) {
      this.log(`[control-center] observation cycle failed: ${codeOf(error instanceof Error ? error.name : "error")}`);
    }
    this.schedule(this.intervalMs, generation);
  }

  /** When this stretch of observation began on this database; tasks older than a day before it never open a reminder. */
  private enabledAt(nowMs: number) {
    const stored = Date.parse(this.services.state.ensure(enabledAtState, iso(nowMs)));
    return Number.isFinite(stored) ? stored : nowMs;
  }

  /**
   * Tasks last updated before the returned time never open a reminder. It is a day before observation began, and that
   * moves: a cycle that starts more than a day (or two intervals, if longer) after the previous one is a re-enabling
   * after the loop was disabled or the server was down, and it begins a new stretch from now, as a first enabling does.
   * Without that, enabling, disabling and enabling again months later would open a reminder for every failure since
   * the first enabling. A loop that keeps running, and a restart of a few minutes, keep their anchor.
   */
  private floodFloor(nowMs: number, intervalMs: number) {
    const { state } = this.services;
    let anchor = this.enabledAt(nowMs);
    const last = Date.parse(state.read(lastCycleState) ?? "");
    if (Number.isFinite(last) && nowMs - last > Math.max(observationLimits.floodWindowMs, 2 * intervalMs)) {
      anchor = nowMs;
      try { state.write(enabledAtState, iso(nowMs)); } catch { /* the next cycle sees the same gap and starts over again */ }
    }
    return anchor - observationLimits.floodWindowMs;
  }

  private targets(): Target[] {
    const { config, auth } = this.services;
    // Accounts added or revoked with personal-config count from this cycle on, with no request needed to notice them.
    try { auth?.refreshPersonalUsers(); } catch { /* the accounts already in memory are used */ }
    return baseScopes(config).flatMap((scope) => {
      const recipients = reminderRecipients(config, scope.id);
      return recipients.length ? [{ scope, recipients }] : [];
    });
  }

  private async cycle(): Promise<CycleSummary> {
    const { tasks, openTools, notifications, clock } = this.services;
    const startedMs = clock();
    const index = this.cycles++;
    const summary: CycleSummary = { ...emptyScope(), started_at: iso(startedMs), finished_at: "", scopes: {}, shared_errors: {} };
    const tally = (scopeId: string) => (summary.scopes[scopeId] ??= emptyScope());
    /** Counts an error code in the totals once and in each scope it belongs to; with no scope it is a shared error. */
    const fail: Fail = (code, ...scopeIds) => {
      const key = codeOf(code);
      summary.errors[key] = (summary.errors[key] || 0) + 1;
      for (const bucket of scopeIds.length ? scopeIds.map((id) => tally(id).errors) : [summary.shared_errors]) bucket[key] = (bucket[key] || 0) + 1;
    };
    const bump: Bump = (scopeIds, field, n = 1) => {
      summary[field] += n;
      for (const id of scopeIds) tally(id)[field] += n;
    };
    try {
      const settings = observationSettings(this.services.config);
      const floor = this.floodFloor(startedMs, settings.intervalMinutes * 60_000);
      const targets = this.targets();
      for (const target of targets) tally(target.scope.id);
      // A recipient named in the config who is no enabled admin bound to any observed scope would silently get nothing.
      const reached = new Set(targets.flatMap((target) => target.recipients));
      for (const identity of settings.recipients) if (!reached.has(identity)) fail("recipient_unresolved");

      // Open tools are read every Nth cycle (a DriveBridge read leaves an audit row there). One reading makes several
      // requests, so the budget keeps the most it can make; a reading served from the cache makes none.
      const kinds = index % settings.openToolsEvery === 0 ? [...new Set(targets.flatMap((target) => openTools.inScope(target.scope)))] : [];
      const scopesOf = (kind: OpenToolKind) => targets.filter((target) => openTools.inScope(target.scope).includes(kind)).map((target) => target.scope.id);
      const listBudget = observationLimits.callsPerCycle - kinds.reduce((sum, kind) => sum + openTools.observeCost(kind), 0);
      const { units, chosen } = this.pick(targets, listBudget, startedMs, fail);
      for (const unit of units) if (!chosen.includes(unit)) bump(idsOf(unit), "connections_skipped");

      const read = await this.readLists(chosen, listBudget, startedMs, bump, fail);
      for (const unit of units) if (!this.positions.get(unit.key)?.passes) bump(idsOf(unit), "scan_incomplete");
      for (const target of targets) {
        // Every row of every connection this scope has, as this scope names them; a shared connection was read once.
        const rows = chosen
          .filter((unit) => unit.targets.includes(target))
          .flatMap((unit) => (unit.targets[0] === target ? read.get(unit.key) ?? [] : tasks.forScope(read.get(unit.key) ?? [], target.scope)))
          .filter((task) => task.task_key);
        if (!rows.length) continue;
        // Each recipient on its own: one that fails costs the others nothing.
        for (const recipient of target.recipients) {
          try {
            const result = this.deliver(target.scope.id, recipient, rows, floor, startedMs);
            bump([target.scope.id], "reminders_opened", result.inserted.length);
            bump([target.scope.id], "reminders_recovered", result.recovered.length);
          } catch {
            fail("reminder_write_failed", target.scope.id);
          }
        }
      }

      // Open tools: runs that failed or ended unknown become `operation` reminders, newest ten per tool.
      const projections = new Map<OpenToolKind, OpenToolProjection>();
      for (const kind of kinds) {
        if (this.closing) break;
        const scopeIds = scopesOf(kind);
        let requests = openTools.observeCost(kind);
        try {
          const result = await openTools.observe(kind);
          requests = result?.requests ?? 0;
          const projection = result?.observation.projection;
          if (projection) {
            projections.set(kind, projection);
            if (projection.state !== "ready" && projection.state !== "degraded") fail(`open_tool_${projection.state}`, ...scopeIds);
          }
        } catch {
          fail("open_tool_unreadable", ...scopeIds);
        }
        bump(scopeIds, "calls", requests);
        summary.open_tools_read = true;
        for (const id of scopeIds) tally(id).open_tools_read = true;
      }
      for (const target of targets) {
        for (const kind of openTools.inScope(target.scope)) {
          const projection = projections.get(kind);
          if (!projection) continue;
          for (const run of projection.operations.attention.slice(0, observationLimits.operationRemindersPerTool)) {
            for (const recipient of target.recipients) {
              const { created } = notifications.openEvent({
                scope: target.scope.id,
                recipient,
                event: `operation:${kind}:${run.ref}:${run.state}`,
                category: "operation",
                title: `${projection.label} ${run.label}${run.state === "unknown" ? "结果未知" : "失败"}`,
                path: "/services",
                owner: kind,
                errorCode: run.error_code || run.native_state,
                taskState: run.state,
                nativeState: run.native_state,
                sessionId: backgroundSession,
                now: iso(startedMs),
              });
              if (created) bump([target.scope.id], "reminders_opened");
            }
          }
        }
      }

      // Credential reminders: the credential lifecycle supplies the facts, the loop delivers them and ends the ones that
      // no longer hold. A scope whose facts could not be worked out is left as it is: not knowing is not recovery.
      const credentials = this.options.credentials;
      if (credentials) for (const target of targets) {
        let reading: CredentialReading;
        try { reading = credentials(startedMs, target.scope); } catch { fail("credentials_unreadable", target.scope.id); continue; }
        const { facts } = reading;
        const keep = [...facts.map(credentialEventKey), ...reading.unknown];
        for (const recipient of target.recipients) {
          try {
            for (const fact of facts) {
              const { created } = notifications.openEvent({
                scope: target.scope.id,
                recipient,
                event: credentialEventKey(fact),
                category: "credential",
                title: fact.title,
                path: "/services",
                owner: fact.owner,
                errorCode: fact.error_code,
                taskState: fact.state,
                sessionId: backgroundSession,
                recurs: true,
                now: iso(startedMs),
              });
              if (created) bump([target.scope.id], "reminders_opened");
            }
            bump([target.scope.id], "reminders_recovered", notifications.recoverEvents({ scope: target.scope.id, recipient, category: "credential", keep, now: iso(startedMs) }).length);
          } catch {
            fail("reminder_write_failed", target.scope.id);
          }
        }
      }
    } catch (error) {
      fail(error instanceof Error ? "cycle_failed" : error);
    }
    summary.finished_at = iso(clock());
    this.last = summary;
    // When this cycle began, for the gap check of the next one that starts after a long pause. A failed write costs nothing.
    try { this.services.state.write(lastCycleState, iso(startedMs)); } catch { /* the flood guard keeps its earlier anchor */ }
    this.report(summary);
    return summary;
  }

  /**
   * The connections to read this cycle, one unit per connection whatever number of scopes have it: round-robin from
   * where the last cycle stopped, skipping those still backing off, as many as the budget reserves for. A connection
   * that has no MCP session yet needs one more request, so it reserves one more.
   */
  private pick(targets: Target[], budget: number, nowMs: number, fail: Fail) {
    const byId = new Map<string, Unit>();
    let listed = true;
    for (const target of targets) {
      try {
        for (const connection of this.services.tasks.connections(target.scope)) {
          const unit = byId.get(connection.id) ?? { key: connection.id, connection, targets: [] };
          unit.targets.push(target);
          byId.set(connection.id, unit);
        }
      } catch (error) {
        listed = false;
        fail(error instanceof Error ? "connections_unreadable" : error, target.scope.id);
      }
    }
    const units = [...byId.values()];
    // What is kept for a connection that left the config goes with it. A scope whose connections could not be listed
    // this time says nothing about what it had, so then nothing is dropped.
    if (listed) for (const kept of [this.backoff, this.positions] as Map<string, unknown>[]) for (const key of [...kept.keys()]) if (!byId.has(key)) kept.delete(key);
    const chosen: Unit[] = [];
    let visited = 0;
    let reserved = 0;
    for (let step = 0; step < units.length; step++) {
      const unit = units[(this.cursor + step) % units.length];
      const wait = this.backoff.get(unit.key);
      if (wait && wait.until > nowMs) {
        visited = step + 1;
        continue;
      }
      const cost = observationLimits.callsPerConnection + (this.services.tasks.needsHandshake(unit.key) ? 1 : 0);
      // The one that does not fit is the first in line next cycle.
      if (reserved + cost > budget) break;
      reserved += cost;
      chosen.push(unit);
      visited = step + 1;
    }
    this.cursor = units.length ? (this.cursor + visited) % units.length : 0;
    return { units, chosen };
  }

  /**
   * Page 1 of both lists for every chosen connection, then rolling pages with the rest of the budget, a round at a
   * time: each round reads one page for every connection that still has some left, so one long list never takes the
   * whole budget, and no connection takes more than `maxCallsPerConnection` requests. The budget counts the owner
   * requests the reads really made. A connection whose first pages fail backs off as a whole and forgets its place in
   * the walk; a rolling page that fails is the walk's trouble alone (see observation-scan.ts), so the connection keeps
   * its first pages every cycle. Returns the rows read, by connection, in the order they were read.
   */
  private async readLists(chosen: Unit[], budget: number, nowMs: number, bump: Bump, fail: Fail) {
    const rows = new Map<string, TaskSnapshot[]>(chosen.map((unit) => [unit.key, []]));
    const first = new Map<string, FirstPages>(chosen.map((unit) => [unit.key, { active: undefined, history: undefined }]));
    const used = new Map<string, number>();
    const bad = new Map<string, string>();
    const finished = new Set<string>();
    let spent = 0;
    const account = (unit: Unit, answer: Answer) => {
      spent += answer.requests;
      used.set(unit.key, (used.get(unit.key) ?? 0) + answer.requests);
      bump(idsOf(unit), "calls", answer.requests);
      bump(idsOf(unit), "pages_read");
    };

    for (const mode of ["active", "history"] as const) {
      if (this.closing) break;
      const answers = await this.round(chosen.map((unit) => ({ unit, mode, from: undefined })), rows);
      chosen.forEach((unit, i) => {
        account(unit, answers[i]);
        first.get(unit.key)![mode] = { ok: answers[i].ok, next: answers[i].next };
        if (!answers[i].ok && !bad.has(unit.key)) bad.set(unit.key, answers[i].state);
      });
    }
    for (const unit of chosen) {
      if (used.has(unit.key)) bump(idsOf(unit), "connections_read");
      const position = this.positions.get(unit.key) ?? this.positions.set(unit.key, startOfScan()).get(unit.key)!;
      if (bad.has(unit.key)) {
        restart(position);
        finished.add(unit.key);
      } else if (settle(position, first.get(unit.key)!)) finished.add(unit.key);
    }

    while (!this.closing && spent < budget) {
      const probes: Probe[] = [];
      for (const unit of chosen) {
        const position = this.positions.get(unit.key)!;
        if (probes.length >= budget - spent || position.cursor === undefined || finished.has(unit.key)) continue;
        if ((used.get(unit.key) ?? 0) >= observationLimits.maxCallsPerConnection) continue;
        probes.push({ unit, mode: position.mode, from: position.cursor });
      }
      if (!probes.length) break;
      const answers = await this.round(probes, rows);
      probes.forEach(({ unit }, i) => {
        const position = this.positions.get(unit.key)!;
        account(unit, answers[i]);
        if (answers[i].ok) {
          if (advance(position, answers[i].next, first.get(unit.key)!)) finished.add(unit.key);
          return;
        }
        // The walk waits for the next cycle whatever happens, and that page is tried again until it has failed enough.
        finished.add(unit.key);
        const outcome = failed(position, answers[i].skip, first.get(unit.key)!, observationLimits.walkPageAttempts);
        fail(outcome.skipped ? "walk_page_skipped" : "walk_page_failed", ...idsOf(unit));
        if (outcome.skipped) bump(idsOf(unit), "pages_skipped");
      });
    }

    for (const unit of chosen) {
      const state = bad.get(unit.key);
      if (state) {
        fail(state, ...idsOf(unit));
        this.penalize(unit.key, nowMs);
      } else this.backoff.delete(unit.key);
    }
    return rows;
  }

  /**
   * One page for each probe. The connections that are read through one scope, for one list, go in one call; a call that
   * throws fails them all. The rows are appended to the connections' lists in the order the probes were given, whichever
   * call answered first.
   */
  private async round(probes: Probe[], rows: Map<string, TaskSnapshot[]>): Promise<Answer[]> {
    const groups = new Map<string, Probe[]>();
    for (const probe of probes) {
      const key = `${probe.unit.targets[0].scope.id}|${probe.mode}`;
      groups.set(key, [...(groups.get(key) ?? []), probe]);
    }
    const answers = new Map<Probe, Answer>();
    const pageRows = new Map<Probe, TaskSnapshot[]>();
    await Promise.all([...groups.values()].map(async (group) => {
      try {
        const pages = await this.services.tasks.scan(group[0].unit.targets[0].scope, group[0].mode, new Map(group.map((probe) => [probe.unit.key, probe.from])));
        for (const probe of group) {
          const page = pages.find((entry) => entry.id === probe.unit.key);
          answers.set(probe, page ? { ok: page.state === "ready", state: page.state, next: page.next, skip: page.skip, requests: page.requests } : { ok: false, state: "unavailable", requests: 0 });
          pageRows.set(probe, page?.rows ?? []);
        }
      } catch {
        for (const probe of group) answers.set(probe, { ok: false, state: "observation_read_failed", requests: 0 });
      }
    }));
    for (const probe of probes) rows.get(probe.unit.key)!.push(...(pageRows.get(probe) ?? []));
    return probes.map((probe) => answers.get(probe)!);
  }

  /**
   * Feeds one recipient's reminders the way a browser sync does: failing tasks as facts, and open failure reminders
   * whose task now shows a non-failing state as recovered. Judged from the list rows alone; no detail is read, and
   * `complete` stays false so a task missing from a page is never marked gone.
   *
   * `rows` is everything the cycle read for the scope, in the order it was read, not yet reduced to one row per task.
   * A task that any of its rows shows failing counts as failing: which row was read last depends on where the walk is
   * and on how the pages came, and a reminder must not open and recover with that. Only a task none of whose rows fails
   * can be recovered.
   */
  private deliver(scopeId: string, recipient: string, rows: TaskSnapshot[], floor: number, nowMs: number) {
    const { notifications } = this.services;
    const seen = new Map<string, { task: TaskSnapshot; fact: FailureFact; failing: boolean }>();
    for (const task of rows) {
      const fact = failureFact(scopeId, task);
      const failing = attentionStates.has(task.state);
      const held = seen.get(fact.task_identity);
      if (!held || failing || !held.failing) seen.set(fact.task_identity, { task, fact, failing });
    }
    const entries = [...seen.values()];
    const candidates = new Set(notifications.recoveryCandidates(scopeId, recipient));
    const recent = entries.filter(({ task, failing }) => failing && Date.parse(task.updated_at || task.created_at || "") > floor);
    return notifications.sync({
      scopeId,
      sessionId: backgroundSession,
      subject: recipient,
      observed: recent.map((entry) => entry.fact),
      presentTaskKeys: rows.map((task) => task.task_key!),
      complete: false,
      recovered: entries.filter(({ fact, failing }) => !failing && candidates.has(fact.task_identity)).map(({ fact }) => fact.task_identity),
      now: iso(nowMs),
    });
  }

  private penalize(key: string, nowMs: number) {
    const failures = (this.backoff.get(key)?.failures ?? 0) + 1;
    this.backoff.set(key, { failures, until: nowMs + Math.min(observationLimits.maxBackoffMs, this.intervalMs * 2 ** failures) });
  }

  /** One log line when something was opened or recovered, or the set of errors changed; quiet otherwise. */
  private report(summary: CycleSummary) {
    const errors = Object.entries(summary.errors).map(([code, n]) => `${code}=${n}`).join(",");
    if (!summary.reminders_opened && !summary.reminders_recovered && errors === this.lastErrors) return;
    this.lastErrors = errors;
    this.log(`[control-center] observation cycle: calls=${summary.calls} opened=${summary.reminders_opened} recovered=${summary.reminders_recovered}${errors ? ` errors=${errors}` : ""}`);
  }
}

export function createObservationLoop(services: ObservationServices, options: ObservationLoopOptions = {}) {
  return new ObservationLoop(services, options);
}

/** What a cycle did in the given scopes only: their counts added together, and the codes that belong to the loop itself. */
function cycleOf(cycle: CycleSummary, scopeIds: string[]) {
  const mine = scopeIds.flatMap((id) => (cycle.scopes[id] ? [cycle.scopes[id]] : []));
  const sum = (field: Counter) => mine.reduce((total, scope) => total + scope[field], 0);
  const errors: Record<string, number> = {};
  for (const bucket of [cycle.shared_errors, ...mine.map((scope) => scope.errors)]) for (const [code, n] of Object.entries(bucket)) errors[code] = (errors[code] || 0) + n;
  return {
    started_at: cycle.started_at,
    finished_at: cycle.finished_at,
    calls: sum("calls"),
    pages_read: sum("pages_read"),
    pages_skipped: sum("pages_skipped"),
    reminders_opened: sum("reminders_opened"),
    reminders_recovered: sum("reminders_recovered"),
    errors,
    connections_read: sum("connections_read"),
    connections_skipped: sum("connections_skipped"),
    scan_incomplete: sum("scan_incomplete"),
    open_tools_read: mine.some((scope) => scope.open_tools_read),
  };
}

/**
 * Answers `GET /observation/status` from memory and config: whether the loop is on, how often it runs, what the last
 * cycle did in the given scopes (the asking session's own, never another scope's), when the next one runs, and whether
 * the asking identity receives background reminders in any of them. It never reads an owner, never throws whatever the
 * config holds, and carries no address, path, key or reminder text.
 */
export function observationStatus(services: Pick<ObservationServices, "config" | "observation">, identity: string, askedScopeIds: string[], scope?: string) {
  // A scope the session has under two names (two principals, a repeated id) is still one scope.
  const scopeIds = [...new Set(askedScopeIds)];
  const settings = observationSettings(services.config);
  const loop = services.observation;
  const recipients = (id: string) => {
    try { return reminderRecipients(services.config, id); } catch { return []; }
  };
  const last = loop?.lastCycle ?? null;
  return {
    schema_version: "yeisme.observation_status.v1" as const,
    enabled: settings.enabled,
    /** False when the observation block in the config is malformed; the loop is then off. */
    config_valid: settings.valid,
    running: !!loop?.running,
    interval_minutes: settings.intervalMinutes,
    open_tools_every: settings.openToolsEvery,
    /** The scope asked about, or null when the answer covers all of the session's scopes. */
    scope: scope ?? null,
    /** Someone receives background reminders for at least one of these scopes. */
    observed: scopeIds.some((id) => recipients(id).length > 0),
    recipient: scopeIds.some((id) => recipients(id).includes(identity)),
    last_cycle: last ? cycleOf(last, scopeIds) : null,
    next_run_at: loop?.nextRunAt ?? null,
  };
}
