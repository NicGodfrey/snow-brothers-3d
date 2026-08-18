export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

export function formatSse(event: string, data: unknown, id?: string): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  for (const line of payload.split("\n")) lines.push(`data: ${line}`);
  lines.push("", "");
  return lines.join("\n");
}

export function parseSseText(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];

  const flush = (): void => {
    if (data.length === 0 && event === "message" && id === undefined) return;
    if (data.length === 0 && event === "message") return;
    frames.push({ event, data: data.join("\n"), id });
    event = "message";
    id = undefined;
    data.length = 0;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine === "") {
      flush();
      continue;
    }
    if (rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  flush();
  return frames;
}

export async function* parseSseStream(
  stream: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<SseFrame> {
  let buf = "";
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];

  const flush = (): SseFrame | undefined => {
    if (data.length === 0) {
      event = "message";
      id = undefined;
      return undefined;
    }
    const frame = { event, data: data.join("\n"), id };
    event = "message";
    id = undefined;
    data.length = 0;
    return frame;
  };

  for await (const chunk of stream) {
    buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    let idx = buf.indexOf("\n");
    while (idx >= 0) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        const frame = flush();
        if (frame) yield frame;
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
        else if (field === "id") id = value;
      }
      idx = buf.indexOf("\n");
    }
  }
}
