/**
 * Reads a response body and parses it as JSON when the content-type says
 * so. An empty body (204/205, or zero-length text) becomes `undefined`
 * rather than a JSON parse error. A `content-type: application/json` body
 * that fails to parse is handed back as raw text rather than throwing —
 * a malformed body is a server bug the caller should see, not a crash in
 * this client.
 */
export async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;

  const text = await response.text();
  if (text.length === 0) return undefined;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/** Serializes a request body to JSON, or `undefined` for no body at all. */
export function serializeRequestBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  return JSON.stringify(body);
}
