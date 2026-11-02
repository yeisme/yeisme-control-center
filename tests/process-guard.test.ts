import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { AuthError } from "../server/auth";
import { guardRejections, rejectionCode } from "../server/process-guard";

describe("the unhandled-rejection guard", () => {
  it("logs a code for the rejection, never its message, and does not throw", () => {
    const handlers: [string, (reason: unknown) => void][] = [];
    const lines: string[] = [];
    guardRejections({ on: (event: string, handler: (reason: unknown) => void) => { handlers.push([event, handler]); return process; } } as never, (line) => lines.push(line));
    expect(handlers.map(([event]) => event)).toEqual(["unhandledRejection"]);
    const rejected = handlers[0][1];
    rejected(Object.assign(new Error("open /home/a/.config/secret-token: denied"), { code: "EACCES" }));
    rejected(new AuthError("provider_not_configured", 503));
    rejected(new TypeError("Bearer abc.def.ghi"));
    rejected("plain text with a secret");
    rejected(undefined);
    expect(lines).toEqual([
      "[control-center] unhandled_rejection EACCES",
      "[control-center] unhandled_rejection provider_not_configured",
      "[control-center] unhandled_rejection TypeError",
      "[control-center] unhandled_rejection string",
      "[control-center] unhandled_rejection undefined",
    ]);
    expect(lines.join("\n")).not.toMatch(/secret|Bearer|home/);
  });

  it("refuses to echo a code that is not a short identifier", () => {
    expect(rejectionCode({ code: "has spaces and /paths", name: "Error" })).toBe("Error");
    expect(rejectionCode({ code: "x".repeat(65), name: "y z" })).toBe("object");
  });

  it("keeps a real Bun process alive through an unhandled rejection that would otherwise end it", () => {
    const script = `import { guardRejections } from "./server/process-guard"; guardRejections(process); Promise.reject(Object.assign(new Error("secret"), { code: "SQLITE_BUSY" })); setTimeout(() => console.log("still running"), 50);`;
    const guarded = spawnSync("bun", ["-e", script], { encoding: "utf8" });
    expect(guarded.status, guarded.stderr).toBe(0);
    expect(guarded.stdout).toContain("still running");
    expect(guarded.stderr).toContain("unhandled_rejection SQLITE_BUSY");
    expect(guarded.stderr).not.toContain("secret");
    // Without the guard the same rejection ends the process before the timer fires.
    const bare = spawnSync("bun", ["-e", `Promise.reject(new Error("boom")); setTimeout(() => console.log("still running"), 50);`], { encoding: "utf8" });
    expect(bare.status).not.toBe(0);
    expect(bare.stdout).not.toContain("still running");
  });
});
