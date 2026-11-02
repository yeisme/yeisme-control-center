// A process that takes the configuration lock, says so, and keeps it until it is killed. It keeps the handle, too: a handle that
// nothing refers to may be collected, and a collected connection lets go of its lock.
import { acquireConfigLock } from "../../server/config-lock";

const lock = await acquireConfigLock(process.argv[2]);
console.log("locked");
await new Promise((resolve) => setTimeout(resolve, 120_000));
lock.release();
