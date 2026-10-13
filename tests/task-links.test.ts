import { expect, it } from "vitest";
import { clientOrigin, taskTarget } from "../src/task-links";
it("rejects redirect/action injection and duplicate task reference parameters", () => {
  expect(
    taskTarget("#/tasks?connection=s&project=p&family=delegation&ref=r"),
  ).toEqual({ connection: "s", project: "p", family: "delegation", ref: "r" });
  for (const suffix of [
    "&ref=other",
    "&action=generate",
    "&return=https://evil",
  ])
    expect(
      taskTarget(
        "#/tasks?connection=s&project=p&family=delegation&ref=r" + suffix,
      ),
    ).toBeNull();
  expect(taskTarget("#/tasks")).toBeNull();
  expect(clientOrigin("https://studio.test")).toBe("https://studio.test");
  for (const origin of [
    "https://u:p@studio.test",
    "http://public.test",
    "https://studio.test/path",
    "https://studio.test?x=1",
    "https://studio.test#evil",
  ])
    expect(() => clientOrigin(origin)).toThrow();
});

it('accepts only exact instance and project list links', async () => {
  const { taskListHash, taskListTarget } = await import('../src/task-links');
  expect(taskListTarget(taskListHash('sonora-lan', 'lan-media'))).toEqual({ connection: 'sonora-lan', project: 'lan-media' });
  expect(taskListTarget('#/tasks?connection=a&project=p&project=other')).toBeNull();
  expect(taskListTarget('#/tasks?connection=a&project=p&action=cancel')).toBeNull();
});
