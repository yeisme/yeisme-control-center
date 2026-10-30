export function selectProjectTask(params: URLSearchParams, taskKey: string) {
  const next = new URLSearchParams(params);
  next.set("tab", "tasks");
  next.set("task", taskKey);
  return next;
}

export function closeProjectTask(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete("task");
  return next;
}

export function selectProjectTab(params: URLSearchParams, tab: "overview" | "tasks" | "assets" | "review" | "delivery") {
  const next = new URLSearchParams(params);
  next.delete("task");
  next.delete("result");
  next.delete("preview");
  for (const key of ["taskQ", "taskState", "taskStage", "assetQ", "assetKind", "reviewQ", "reviewStatus"]) next.delete(key);
  if (tab === "overview") next.delete("tab");
  else next.set("tab", tab);
  return next;
}

export function selectProjectResult(params: URLSearchParams, resultKey: string | null) {
  const next = new URLSearchParams(params);
  next.set("tab", "assets");
  next.delete("task");
  next.delete("preview");
  if (resultKey) next.set("result", resultKey);
  else next.delete("result");
  return next;
}
