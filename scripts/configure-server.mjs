import fs from "node:fs";
const target = process.argv[2] || ".local/server.json";
if (fs.existsSync(target)) throw Error("Target already exists");
fs.mkdirSync(".local", { recursive: true, mode: 0o700 });
fs.writeFileSync(
  target,
  JSON.stringify(
    { origin: "http://127.0.0.1:4312", port: 4312, principals: [], owners: {} },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(
  "Created unconfigured local server settings; no credentials or grants were provisioned.",
);
