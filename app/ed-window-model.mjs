// ED③-창: the logic of the new write window with no DOM (Node tests run it as is). Design docs/design/unified-editor.md 11.2~11.5.
//   startDoc({doc, text, convert})      — the saved form the editor starts from: the row's own doc, else the old letters converted
//   isChanged(baseline, now)            — did the person change anything since the editor opened (or since the last save)?
//   prepareSave({value, limit, textOnly}) — what the opener's save gets, or the message why not
// The window never saves by itself: it hands {value, text} to the opener's own save (the opener saves).
import {cleanDoc, isEmptyDoc} from './ed-schema.mjs';
import {plainToDocKeep} from './ed-markdown.mjs';
import {toPlain} from './ed-text.mjs';

// The database check on a saved doc (설계 11.3): octet_length(doc::text) <= 1 MiB. jsonb prints a space after every ":" and ",", which
// JSON.stringify does not, so the size is counted the way jsonb prints it (otherwise a doc just under the limit here is refused there).
export const DOC_MAX_BYTES = 1048576;
const encoder = new TextEncoder();
export function jsonbBytes(value) {
  const count = v => {
    if (v === null) return 4;
    if (typeof v === 'string') return encoder.encode(JSON.stringify(v)).length;
    if (typeof v !== 'object') return String(v).length;
    if (Array.isArray(v)) return 2 + v.reduce((n, x) => n + count(x), 0) + Math.max(0, v.length - 1) * 2;
    const keys = Object.keys(v).filter(k => v[k] !== undefined);
    return 2 + keys.reduce((n, k) => n + encoder.encode(JSON.stringify(k)).length + 2 + count(v[k]), 0) + Math.max(0, keys.length - 1) * 2;
  };
  try { return count(value); } catch { return Infinity; }
}

// doc (a saved form) wins; otherwise the old letters are converted with convert(text) (default: plainToDocKeep, letters unchanged).
// A convert that fails or returns something that is not a document falls back to plainToDocKeep.
export function startDoc({doc = null, text = '', convert = null} = {}) {
  const own = cleanDoc(doc);
  if (own) return own;
  let made = null;
  if (typeof convert === 'function') { try { made = cleanDoc(convert(String(text == null ? '' : text))); } catch { made = null; } }
  return made || plainToDocKeep(text);
}

// Compared as JSON text of the cleaned documents: the editor's own first value is the baseline, so opening and closing alone is "not changed".
export const docKey = value => { const clean = cleanDoc(value); return clean ? JSON.stringify(clean) : ''; };
export const isChanged = (baseline, now) => docKey(baseline) !== docKey(now);

// limit: the most letters (toPlain length) the opener's own field takes (note 100000 · update 20000 · project record 500); 0/null = no limit.
// textOnly: the opener keeps letters only (연결 업데이트 요약): value is null in the result.
// maxBytes: the saved-form size limit (default the database's; the editor's own cleaning already caps text at 200000 letters and 20000 nodes,
// so this is a second guard, and Node tests lower it).
export function prepareSave({value, limit = 0, textOnly = false, maxBytes = DOC_MAX_BYTES} = {}) {
  const clean = cleanDoc(value);
  if (!clean) return {ok: false, message: '글을 읽지 못했어요. 다시 눌러 주세요.'};
  const text = toPlain(clean);
  if (limit > 0 && text.length > limit) {
    return {ok: false, text, message: `글이 너무 길어요. ${limit.toLocaleString('ko-KR')}자까지 저장할 수 있어요(지금 ${text.length.toLocaleString('ko-KR')}자).`};
  }
  if (!textOnly && jsonbBytes(clean) > maxBytes) {
    return {ok: false, text, message: '서식이 너무 많아서 저장할 수 없어요. 표나 서식을 줄여 주세요.'};
  }
  return {ok: true, text, value: textOnly ? null : clean, empty: isEmptyDoc(clean)};
}
