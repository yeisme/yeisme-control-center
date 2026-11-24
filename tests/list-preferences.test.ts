import { expect, it } from "vitest";
import { densityClass, pageSizes } from "../src/app/list-preferences";

it("keeps the page sizes and density spacing the lists use", () => {
  expect(pageSizes).toEqual([20, 40, 80, 120]);
  expect(densityClass("compact")).toBe("py-2");
  expect(densityClass("comfortable")).toBe("py-3");
  expect(densityClass("spacious")).toBe("py-4");
});
