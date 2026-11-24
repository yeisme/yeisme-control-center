/** Local evidence runs may write their disposable index, never an owner's business state. */
export function readOnlyRequestAllowed(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD") return true;
  if (method !== "POST") return false;
  return ["/auth/personal", "/auth/logout", "/auctra/collection/sync"].includes(path)
    || /^\/requests\/(aigora|scaena|eikona|sonora)\/[^/]+(?:\/attachments\/[^/]+)?\/content:read$/.test(path)
    || /^\/tasks\/[^/]+\/(?:prompt:read|artifacts\/[^/]+\/access)$/.test(path)
    || /^\/episode-production\/(?:artifacts|references)\/[^/]+\/access$/.test(path)
    || /^\/prompts\/(eikona|sonora|scaena)\/[^/]+\/content:read$/.test(path);
}
