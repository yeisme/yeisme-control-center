// A process that tries to take the configuration lock once, for a short wait, and says what happened: `acquired`, `busy` or `error:<name>`.
import { ConfigBusyError, acquireConfigLock } from "../../server/config-lock";

try {
  const lock = await acquireConfigLock(process.argv[2], { waitMs: Number(process.argv[3] ?? 300), pollMs: 20 });
  console.log("acquired");
  lock.release();
} catch (error) {
  console.log(error instanceof ConfigBusyError ? "busy" : `error:${(error as Error).name}`);
}
