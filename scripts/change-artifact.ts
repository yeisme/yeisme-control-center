import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";

// Write human-authored artifacts only inside a CLI-initialized local change.
const [change, artifact] = process.argv.slice(2);
if (!change || !/^[a-z0-9-]+$/.test(change) || !artifact || !/^(proposal\.md|design\.md|specs\/[a-z0-9-]+\/spec\.md)$/.test(artifact))
  throw new Error("Usage: bun scripts/change-artifact.ts <change> <proposal.md|design.md|specs/name/spec.md> < content.md");
const root = resolve(import.meta.dirname, "../openspec/changes");
const directory = realpathSync(resolve(root, change));
if (relative(root, directory) !== change) throw new Error("change_outside_owner");
readFileSync(resolve(directory, ".openspec.yaml"));
const content = readFileSync(0, "utf8");
if (!content.trim() || content.includes("\0")) throw new Error("invalid_artifact_content");
const target = resolve(directory, artifact);
mkdirSync(dirname(target), { recursive: true });
if (relative(directory, realpathSync(dirname(target))).startsWith("..")) throw new Error("artifact_outside_change");
try { if (realpathSync(target) !== target) throw new Error("artifact_symlink_denied"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`);
console.log("artifact_written");
