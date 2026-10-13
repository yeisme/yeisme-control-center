// All browser reads stay on the authenticated, same-origin control surface.
export async function controlRead<T>(path: string, signal?: AbortSignal, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/control-center/v1' + path, {
    credentials: 'same-origin', cache: 'no-store', signal, ...init,
  });
  let value;
  try { value = await response.json(); }
  catch { throw Error('invalid_control_response'); }
  if (!response.ok) throw Error(value.error || 'source_unavailable');
  return value as T;
}
