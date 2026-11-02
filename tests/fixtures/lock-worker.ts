// A process that takes the configuration lock `rounds` times and records when it is inside, for the tests of mutual exclusion.
import { appendFileSync } from "node:fs";
import { withConfigLock } from "../../server/config-lock";

const [config, log, rounds, hold] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
for (let round = 0; round < Number(rounds); round++) {
  await withConfigLock(config, async () => {
    appendFileSync(log, `enter ${process.pid}\n`);
    await sleep(Number(hold));
    appendFileSync(log, `exit ${process.pid}\n`);
  }, { waitMs: 30_000 });
}
