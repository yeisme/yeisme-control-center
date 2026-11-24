/** Only event names and cursor ids cross the browser boundary, never upstream data. */
export function gatewayEventStream(upstream: ReadableStream<Uint8Array>, signal: AbortSignal, authorized: () => boolean): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buffer = ""; let closed = false;
  const stop = () => { closed = true; void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  return new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          if (closed || signal.aborted || !authorized()) { stop(); signal.removeEventListener("abort", stop); controller.close(); return; }
          const boundary = /\r?\n\r?\n/.exec(buffer);
          if (boundary) {
            const frame = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
            const event = /^event: ?([a-z_]+)\r?$/m.exec(frame)?.[1];
            const id = /^id: ?([0-9]{1,20})\r?$/m.exec(frame)?.[1];
            if (!event || !["ready", "gateway_event", "heartbeat", "cursor_gap"].includes(event)) continue;
            if (!authorized()) { stop(); controller.close(); return; }
            controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: {}\n\n`)); return;
          }
          const chunk = await reader.read();
          if (chunk.done) { stop(); signal.removeEventListener("abort", stop); controller.close(); return; }
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 65536) throw new Error("gateway_event_frame_limit");
        }
      } catch { stop(); signal.removeEventListener("abort", stop); controller.close(); }
    },
    cancel() { signal.removeEventListener("abort", stop); stop(); },
  });
}
