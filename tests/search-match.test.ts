import { describe, expect, it } from "vitest";
import { matchFields, matchScores, matchTerm, mergeRanges, normalizeText, queryTerms } from "../src/shared/search/match";

describe("search match", () => {
  it("folds case and full-width forms", () => {
    expect(normalizeText("ＥＩＫＯＮＡ １２")).toBe("eikona 12");
    expect(matchTerm("Eikona 任务", "ｅｉｋｏｎａ")?.score).toBeGreaterThanOrEqual(matchScores.prefix);
  });

  it("ranks exact over prefix over a word start over anywhere over letters in order", () => {
    const exact = matchTerm("雨停站台", "雨停站台")!.score;
    const prefix = matchTerm("雨停站台 · 远景", "雨停")!.score;
    const word = matchTerm("站台 · 雨停", "雨停")!.score;
    const inside = matchTerm("夜雨停了", "雨停")!.score;
    const loose = matchTerm("雨夜 · 停站", "雨停")!.score;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(loose);
    expect(matchTerm("雨停站台", "晴")).toBeNull();
  });

  it("treats a change from Latin to CJK as a word start", () => {
    expect(matchTerm("ep-01第一集", "第一")!.score).toBeGreaterThanOrEqual(matchScores.wordStart);
  });

  it("never lets letters scattered across a long text match", () => {
    expect(matchTerm("a long title about a big view", "av")).toBeNull();
    expect(matchTerm("x", "xy")).toBeNull();
  });

  it("returns ranges in the original text, even where normalization changed the width", () => {
    expect(matchTerm("任务ＡＢ", "ab")!.ranges).toEqual([[2, 4]]);
    expect(matchTerm("Say Hello", "hello")!.ranges).toEqual([[4, 9]]);
    expect(mergeRanges([[4, 6], [0, 2], [1, 3]])).toEqual([[0, 3], [4, 6]]);
  });

  it("splits a query into terms and keeps quoted phrases whole", () => {
    expect(queryTerms('雨夜 "红色 油纸伞" 「站台 远景」 x')).toEqual(["雨夜", "红色 油纸伞", "站台 远景", "x"]);
  });

  it("needs every term somewhere, and weighs fields", () => {
    const fields = [{ text: "站台 · 人群背景", weight: 2 }, { text: "eikona run-2398" }];
    const both = matchFields(fields, ["人群", "2398"])!;
    expect(both.ranges[0]).toEqual([[5, 7]]);
    expect(both.ranges[1].length).toBe(1);
    expect(matchFields(fields, ["人群", "sonora"])).toBeNull();
    expect(matchFields(fields, [])).toEqual({ score: 0, ranges: [[], []] });
  });
});
