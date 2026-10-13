// Decoded HTTP-body budget, independent of advisory Content-Length. This is
// a response guard, not a platform heap limit or an OCR storage limit.
export const NOTE_RESPONSE_BYTES = 16 * 1024 * 1024;
export async function readBoundedJson(response, {maxBytes = NOTE_RESPONSE_BYTES} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !response.body) throw new Error('BOUNDED_JSON_FAILED');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
  const chunks = [];
  let bytes = 0, completed = false;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('BOUNDED_JSON_FAILED');
      chunks.push(decoder.decode(value, {stream: true}));
    }
    chunks.push(decoder.decode());
    const result = JSON.parse(chunks.join(''));
    completed = true;
    return result;
  } catch {
    throw new Error('BOUNDED_JSON_FAILED');
  } finally {
    if (!completed) { try { await reader.cancel(); } catch { /* failed stream */ } }
    reader.releaseLock();
  }
}
