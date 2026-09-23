const DEFAULT_MAX_JSON_BYTES = 32 * 1024;

type JsonBody =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };

/** Read public API input with a real byte cap, including chunked requests. */
export async function readJsonBody(request: Request, maxBytes = DEFAULT_MAX_JSON_BYTES): Promise<JsonBody> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, response: Response.json({ error: "Ожидается JSON" }, { status: 415 }) };
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) {
    return { ok: false, response: Response.json({ error: "Запрос слишком большой" }, { status: 413 }) };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, response: Response.json({ error: "Пустой запрос" }, { status: 400 }) };

  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, response: Response.json({ error: "Запрос слишком большой" }, { status: 413 }) };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object");
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, response: Response.json({ error: "Неверный JSON" }, { status: 400 }) };
  } finally {
    reader.releaseLock();
  }
}
