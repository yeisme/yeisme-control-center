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
  if (tab === "overview") next.delete("tab");
  else next.set("tab", tab);
  return next;
}
