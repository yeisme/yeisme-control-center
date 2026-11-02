// A process that takes the configuration lock, says so, and keeps it until it is killed.
import { withConfigLock } from "../../server/config-lock";

await withConfigLock(process.argv[2], async () => {
  console.log("locked");
  await new Promise((resolve) => setTimeout(resolve, 120_000));
});
