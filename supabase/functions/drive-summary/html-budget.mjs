const encoder = new TextEncoder();
export function createHtmlBudget(limit, suffix = "") {
  const reserved = encoder.encode(suffix).length, chunks = [];
  let bytes = 0;
  return {
    discard() {
      chunks.length = 0;
      bytes = 0;
    },
    append(text) {
      const size = encoder.encode(text).length;
      if (bytes + size + reserved > limit) return false;
      bytes += size;
      chunks.push(text);
      return true;
    },
    finish() {
      const html = chunks.join("") + suffix;
      if (encoder.encode(html).length !== bytes + reserved) {
        throw Error("HTML_BYTE_MISMATCH");
      }
      return html;
    },
  };
}
export function* escapedChunks(value, pre = false) {
  const text = String(value ?? "");
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 4096, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    let chunk = text.slice(start, end).replace(
      /[&<>"']/g,
      (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c]),
    );
    if (pre) chunk = chunk.replace(/\r/g, "&#13;");
    yield chunk;
    start = end;
  }
}
