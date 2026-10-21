import { expect, it } from "vitest";
import { densityClass, pageSizes, parseListPreferences } from "../src/app/list-preferences";

it("migrates invalid list preferences to safe defaults and keeps valid pages", () => {
  expect(pageSizes).toEqual([20, 40, 80, 120]);
  expect(parseListPreferences(JSON.stringify({ version: 1, pageSize: 80, density: "compact", pages: { tasks: 3, bad: 0 } }))).toMatchObject({ pageSize: 80, density: "compact", pages: { tasks: 3 } });
  expect(parseListPreferences(JSON.stringify({ version: 0, pageSize: 120 }))).toMatchObject({ pageSize: 40, density: "comfortable", pages: {} });
  expect(densityClass("compact")).toBe("py-2");
  expect(densityClass("comfortable")).toBe("py-3");
  expect(densityClass("spacious")).toBe("py-4");
});
