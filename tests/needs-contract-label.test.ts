import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageLabels } from "../src/request-visibility";
import { openToolStateLabels } from "../src/shared/open-tools";
import { readinessMeta } from "../src/pages/capabilities/readiness";
import { railStateInfo } from "../src/shared/read-model/drama";
import { catalogCoverageLabels, needsContractLabel } from "../src/shared/read-model/labels";
import { readStatusLabels } from "../src/shared/read-model/read-state";

describe("the one short label for needs_contract", () => {
  it("says the owner has to add an interface, and is not the word of the not-integrated group", () => {
    expect(needsContractLabel).toBe("待补齐接口");
    // 未接入 is what the services directory calls the entries the control center has no contract for at all.
    expect(needsContractLabel).not.toContain("接入");
  });

  it("is what every label table says for the state", () => {
    expect(coverageLabels.needs_contract).toBe(needsContractLabel);
    expect(readStatusLabels.needs_contract).toBe(needsContractLabel);
    expect(openToolStateLabels.needs_contract).toBe(needsContractLabel);
    expect(catalogCoverageLabels.needs_contract).toBe(needsContractLabel);
    expect(readinessMeta.needs_contract.label).toBe(needsContractLabel);
    expect(railStateInfo.needs_contract.label).toBe(needsContractLabel);
  });

  it("is not spelled another way in any source file", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join(import.meta.dirname, "../src"));
    expect(files.length).toBeGreaterThan(100);
    // The old spellings of this state. (待接入 may still appear in a sentence that explains a gap, so it is not listed.)
    const offenders = files.filter((path) => /待合同|待接口/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
