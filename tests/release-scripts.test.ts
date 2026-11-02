import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseProviderLiveArgs, providerLiveFlags, providerLiveOptions } from "../scripts/provider-live-args";
import { DirtyTreeError, readReleaseSource, releaseTreeState, trackedChanges } from "../scripts/release-source";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const temp: string[] = [];
afterAll(() => temp.forEach((path) => rmSync(path, { recursive: true, force: true })));

/** The text of every `run:` step (block or one line) in a workflow file. */
function runBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[at]);
    if (!match) continue;
    if (match[2] && match[2] !== "|") { blocks.push(match[2]); continue; }
    const body: string[] = [];
    for (let next = at + 1; next < lines.length && (lines[next].trim() === "" || lines[next].search(/\S/) > match[1].length); next += 1) body.push(lines[next]);
    blocks.push(body.join("\n"));
  }
  return blocks;
}

describe("provider-live workflow", () => {
  const text = read(".github/workflows/provider-live.yml");
  const dispatch = text.slice(text.indexOf("    inputs:"), text.indexOf("permissions:"));
  const inputs = [...dispatch.matchAll(/^      ([a-z_]+):\s*$/gm)].map((match) => match[1]);
  const blocks = new Map<string, string>();
  let current = "";
  for (const line of dispatch.split("\n")) {
    const match = /^      ([a-z_]+):\s*$/.exec(line);
    if (match) { current = match[1]; blocks.set(current, ""); }
    else if (current) blocks.set(current, blocks.get(current) + line + "\n");
  }
  const block = (name: string) => blocks.get(name) ?? "";
  // The values a run would see, one per input, as the operator would fill them in.
  const sample: Record<string, string> = { CANARY_MODALITY: "audio", CANARY_RUN_LABEL: "20261102a", CANARY_TOTAL_USD: "0.5", CANARY_IMAGE_USD: "0", CANARY_VIDEO_USD: "0", CANARY_AUDIO_USD: "0.5" };

  it("takes USD budgets, a label and a modality, and no CNY input", () => {
    expect(inputs).toEqual(["confirm_live", "modality", "run_label", "total_usd", "image_usd", "video_usd", "audio_usd"]);
    expect(text).not.toMatch(/cny/i);
    for (const required of ["confirm_live", "modality", "run_label", "total_usd"]) expect(block(required), required).toMatch(/required:\s*true/);
    expect(block("modality")).toMatch(/type:\s*choice/);
    for (const option of ["audio", "image", "video"]) expect(block("modality")).toContain(`- ${option}`);
  });

  it("hands every input to the script through the environment, and no step text carries an expression", () => {
    const pairs = [...text.matchAll(/^\s+([A-Z_]+): \$\{\{ inputs\.([a-z_]+) \}\}\s*$/gm)].map((match) => [match[1], match[2]]);
    expect(Object.fromEntries(pairs)).toEqual({ CANARY_MODALITY: "modality", CANARY_RUN_LABEL: "run_label", CANARY_TOTAL_USD: "total_usd", CANARY_IMAGE_USD: "image_usd", CANARY_VIDEO_USD: "video_usd", CANARY_AUDIO_USD: "audio_usd" });
    // confirm_live only gates the job; every other input is passed on.
    expect(pairs.map((pair) => pair[1]).sort()).toEqual(inputs.filter((name) => name !== "confirm_live").sort());
    // `${{ }}` inside a run: block is pasted into the shell as text, so a crafted input could run commands.
    for (const body of runBlocks(text)) expect(body).not.toContain("${{");
    expect(text.match(/\$\{\{ inputs\./g)).toHaveLength(6);
  });

  it("calls the script only with flags it accepts, and with values it accepts", () => {
    const commands = runBlocks(text).flatMap((body) => body.split("\n")).filter((line) => line.includes("test:provider-live"));
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      const flags = [...command.matchAll(/\s(--[a-z-]+)/g)].map((match) => match[1]).filter((flag) => flag !== "--");
      for (const flag of flags) expect(providerLiveFlags, `${flag} in: ${command}`).toContain(flag);
      // Every value flag is passed, from an environment variable the job defines.
      for (const option of Object.keys(providerLiveOptions)) expect(flags, option).toContain(option);
      for (const variable of [...command.matchAll(/"\$([A-Z_]+)"/g)].map((match) => match[1])) expect(Object.keys(sample), variable).toContain(variable);
      // Expand the way the shell does, one argument per quoted variable, and let the script's own parser judge the result.
      const words = command.slice(command.indexOf(" -- ") + 4).trim().split(/\s+/);
      const argv = words.map((word) => word.replace(/^"\$([A-Z_]+)"$/, (_all, name: string) => sample[name]));
      expect(() => parseProviderLiveArgs(argv), argv.join(" ")).not.toThrow();
    }
    expect(commands.some((command) => command.includes("--dry-run"))).toBe(true);
    expect(commands.some((command) => command.includes("--confirm-live"))).toBe(true);
  });

  it("refuses what the old workflow sent, and what a bad input would send", () => {
    const base = ["--confirm-live", "--modality", "audio", "--run-label", "20261102a", "--total-usd", "0.5", "--audio-usd", "0.5"];
    expect(parseProviderLiveArgs(base)).toMatchObject({ selected: ["sonora"], total: 0.5, label: "20261102a", caps: { sonora: 0.5 } });
    expect(parseProviderLiveArgs(["--", ...base]).selected).toEqual(["sonora"]);
    for (const old of [["--confirm-live", "--total-cny", "30", "--image-cny", "15", "--video-cny", "10", "--audio-cny", "5"], ["--confirm-live", "--total-cny", "30"], ["--dry-run", "--total-cny", "30"]])
      expect(() => parseProviderLiveArgs(old), old.join(" ")).toThrow(/USD/);
    const bad: string[][] = [
      ["--modality", "audio", "--run-label", "20261102a", "--total-usd", "0.5", "--audio-usd", "0.5"],
      [...base, "--unknown", "1"], [...base, "--audio-usd", "0.4"], base.slice(0, -1), [...base.slice(0, 3), "--run-label", "--confirm-live", ...base.slice(5)],
      ["--confirm-live", "--modality", "", "--run-label", "20261102a", "--total-usd", "0.5", "--audio-usd", "0.5"],
      ["--confirm-live", "--modality", "audio,music", "--run-label", "20261102a", "--total-usd", "0.5", "--audio-usd", "0.5"],
      ["--confirm-live", "--modality", "audio", "--run-label", "", "--total-usd", "0.5", "--audio-usd", "0.5"],
      ["--confirm-live", "--modality", "audio", "--run-label", "Bad Label", "--total-usd", "0.5", "--audio-usd", "0.5"],
      ["--confirm-live", "--modality", "audio", "--run-label", "20261102a", "--total-usd", "0.5", "--audio-usd", "0"],
      ["--confirm-live", "--modality", "audio", "--run-label", "20261102a", "--total-usd", "0.5", "--audio-usd", ""],
      ["--confirm-live", "--modality", "audio", "--run-label", "20261102a", "--total-usd", "abc", "--audio-usd", "0.5"],
      ["--confirm-live", "--modality", "image,audio", "--run-label", "20261102a", "--total-usd", "0.5", "--image-usd", "0.3", "--audio-usd", "0.3"],
    ];
    for (const argv of bad) expect(() => parseProviderLiveArgs(argv), argv.join(" ")).toThrow();
    // A value that looks like a flag is a missing value, so an input cannot smuggle a second flag.
    expect(() => parseProviderLiveArgs([...base, "--run-label", "--confirm-live"])).toThrow();
    // A modality that was not asked for may have no budget; one that was asked for may not.
    expect(parseProviderLiveArgs([...base, "--image-usd", "0", "--video-usd", ""]).caps).toEqual({ eikona: 0, scaena: 0, sonora: 0.5 });
  });
});

describe("CI workflow", () => {
  const ci = read(".github/workflows/ci.yml");
  const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
  const steps = runBlocks(ci).map((body) => body.trim());

  it("runs the production boot path and the public guide after the production build", () => {
    expect(steps).toContain("bun run test:server-boot");
    expect(steps).toContain("bun run test:public-guide");
    const build = steps.indexOf("bun run build");
    expect(build).toBeGreaterThanOrEqual(0);
    // The public guide is checked against dist/, so it has to come after the build.
    expect(steps.indexOf("bun run test:public-guide")).toBeGreaterThan(build);
    expect(scripts["test:server-boot"]).toBe("bun scripts/verify-server-boot.ts");
    expect(scripts["test:public-guide"]).toBe("bun scripts/verify-public-guide.ts");
  });

  it("only calls package scripts that exist, in every workflow", () => {
    for (const file of ["ci.yml", "provider-live.yml", "release.yml", "owner-compatibility.yml", "owner-live-read.yml"]) {
      for (const body of runBlocks(read(`.github/workflows/${file}`))) {
        for (const match of body.matchAll(/bun run ([a-z][a-z0-9:-]*)/g)) expect(Object.keys(scripts), `${file}: bun run ${match[1]}`).toContain(match[1]);
      }
    }
  });

  it("no longer carries the retired task-visibility gate", () => {
    expect(scripts["test:task-visibility"]).toBeUndefined();
    expect(existsSync(join(root, "scripts/verify-task-visibility.ts"))).toBe(false);
    for (const [name, command] of Object.entries(scripts)) {
      const file = /bun (scripts\/[\w.-]+\.(?:ts|mjs))/.exec(command)?.[1];
      if (file) expect(existsSync(join(root, file)), `${name} → ${file}`).toBe(true);
    }
  });
});

describe("release preparation", () => {
  const porcelain = (...lines: string[]) => lines.join("\n") + "\n";

  it("counts tracked changes only: untracked and ignored files never make a tree dirty", () => {
    expect(trackedChanges(porcelain("?? notes.md", "?? docs/reviews/", "!! dist/"))).toEqual([]);
    expect(trackedChanges(porcelain(" M server/app.ts", "M  server/auth.ts", "A  new.ts", " D gone.ts", "R  a.ts -> b.ts", "UU conflict.ts", "?? untracked.md"))).toHaveLength(6);
    expect(trackedChanges("")).toEqual([]);
  });

  it("refuses a dirty tree unless YEISME_RELEASE_ALLOW_DIRTY=1, and says how many files differ", () => {
    expect(releaseTreeState("", {})).toEqual({ dirty: false, changed_files: 0, dirty_allowed: false });
    expect(releaseTreeState(porcelain("?? only-untracked.md"), {})).toEqual({ dirty: false, changed_files: 0, dirty_allowed: false });
    expect(() => releaseTreeState(porcelain(" M server/app.ts"), {})).toThrow(DirtyTreeError);
    try { releaseTreeState(porcelain(" M a.ts", "?? b.ts", "A  c.ts"), {}); } catch (error) { expect((error as DirtyTreeError).changed).toEqual([" M a.ts", "A  c.ts"]); expect((error as Error).message).toBe("dirty_working_tree"); }
    // Only "1" is the explicit opt-in.
    for (const value of ["0", "", "true", "yes", "1 "]) expect(() => releaseTreeState(porcelain(" M a.ts"), { YEISME_RELEASE_ALLOW_DIRTY: value }), value).toThrow(DirtyTreeError);
    expect(releaseTreeState(porcelain(" M a.ts", " M b.ts"), { YEISME_RELEASE_ALLOW_DIRTY: "1" })).toEqual({ dirty: true, changed_files: 2, dirty_allowed: true });
    // Allowing a dirty tree changes nothing for a clean one.
    expect(releaseTreeState("", { YEISME_RELEASE_ALLOW_DIRTY: "1" })).toEqual({ dirty: false, changed_files: 0, dirty_allowed: false });
  });

  it("reads the commit and the tracked changes from a real repository, ignoring untracked files", () => {
    const repo = mkdtempSync(join(tmpdir(), "release-source-"));
    temp.push(repo);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q");
    writeFileSync(join(repo, "tracked.txt"), "one\n");
    git("add", "tracked.txt");
    git("commit", "-q", "-m", "first");
    const clean = readReleaseSource(repo);
    expect(clean.source_commit).toBe(git("rev-parse", "HEAD").trim());
    expect(clean.source_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(releaseTreeState(clean.porcelain, {}).dirty).toBe(false);
    writeFileSync(join(repo, "untracked.txt"), "not part of the source\n");
    expect(releaseTreeState(readReleaseSource(repo).porcelain, {}).dirty).toBe(false);
    writeFileSync(join(repo, "tracked.txt"), "two\n");
    expect(() => releaseTreeState(readReleaseSource(repo).porcelain, {})).toThrow(DirtyTreeError);
    expect(releaseTreeState(readReleaseSource(repo).porcelain, { YEISME_RELEASE_ALLOW_DIRTY: "1" })).toMatchObject({ dirty: true, dirty_allowed: true });
  });

  it("builds the release itself, from the allowlist, and records what it was built from", () => {
    const prepare = read("scripts/prepare-intranet-release.ts");
    expect(prepare).toContain("['run', 'build']");
    expect(prepare).toContain("releaseTreeState(");
    expect(prepare).toContain("servedEntries");
    expect(prepare).toContain("unservedPaths(");
    expect(prepare).toMatch(/source_commit/);
    expect(prepare).toMatch(/dirty_working_tree/);
    // The build runs before anything is copied from dist/.
    expect(prepare.indexOf("['run', 'build']")).toBeLessThan(prepare.indexOf("for (const entry of servedEntries)"));
    expect(read("scripts/lan-deploy.ts")).toContain("servedEntries");
  });

  it("keeps the source archive and the docs out of the build, the manifest and the checks", () => {
    expect(read("vite.config.ts")).not.toContain("control-center-docs");
    expect(read("vite.config.ts")).toContain("unservedTopLevel");
    expect(read("scripts/release-manifest.mjs")).not.toContain("source.zip");
    expect(read("scripts/check-public-surface.mjs")).toContain("unservedPaths");
    expect(read("scripts/verify-release-component.ts")).toContain("/source.zip");
    expect(read("scripts/verify-release-component.ts")).toContain("/docs/README.md");
  });

  it("verifies a candidate on its own port with the background switch off, never 4313", () => {
    const component = read("scripts/verify-release-component.ts");
    expect(component).toContain("YEISME_RELEASE_VERIFY_PORT || 4380");
    expect(component).not.toMatch(/VERIFY_PORT \|\| 4313/);
    expect(component).toContain('YEISME_CONTROL_BACKGROUND: "off"');
    expect(component).toContain("runLiveReadback");
  });

  it("runs the read-back after activation only when a probe file is configured, and rolls back on a 5xx alone", () => {
    const release = read("scripts/control-release.ts");
    expect(release).toContain("probeFileEnv");
    expect(release).toContain("authenticated_read");
    expect(release).toContain("readbackVerdict(readback).rollback");
    // The credentials are read before the first change, so an unusable file cannot leave a half-verified release behind.
    expect(release.indexOf("loadProbeCredentials(probeFile)")).toBeLessThan(release.indexOf("changed = true"));
  });
});
