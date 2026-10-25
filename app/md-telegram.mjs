// MD-편집기 [텔레그램용 복사]: 마크다운 기호를 텔레그램에 붙여 넣었을 때 자연스럽게 읽히는 일반 글로 바꾼다(순수 함수).
// 텔레그램은 붙여 넣은 글의 마크다운을 꾸밈으로 바꾸지 않으므로, 꾸밈 기호는 빼고 구조(줄·목록·번호)는 글자로 남긴다.
// 규칙표는 PR·docs/markdown-view.md 8절에 있다. 저장된 원문은 바꾸지 않는다(복사본만).
// 줄 판별 정규식·표 칸 나누기·글 안 꾸밈 규칙은 옛 [한글용 복사]도 함께 썼다(지금 한글용 복사는 ed-text.mjs).

export const TELEGRAM_RULE = '──────────';
export const TELEGRAM_DIAGRAM = '(도식은 텔레그램에서 보이지 않아 뺐습니다)';
export const CALLOUT_NAMES = {NOTE: '참고', TIP: '팁', IMPORTANT: '중요', WARNING: '경고', CAUTION: '주의'};

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|>~<])/g;
// Private-use placeholders keep escaped marks and code spans away from the emphasis rules.
const hold = (store, value) => `${store.push(value) - 1}`;
const release = (text, store) => text.replace(/(\d+)/g, (_, i) => store[+i]);

// MD-내보내기 [한글용 복사]: bold survives as a pair of private-use marks (BOLD_OPEN … BOLD_CLOSE) so the 한글 copy can
// turn it into <b>; Telegram drops the marks, so its text is exactly what it was before the marks existed.
export const BOLD_OPEN = '\uE002', BOLD_CLOSE = '\uE003';
const BOLD_MARKS = /[\uE002\uE003]/g;
export const dropBold = text => String(text).replace(BOLD_MARKS, '');

export function telegramInline(text) {
  return dropBold(markedInline(text));
}

// The shared inline rules: marks go, links and images become "글 (주소)", bold is kept as BOLD_OPEN/BOLD_CLOSE.
export function markedInline(text) {
  const store = [];
  let out = String(text).replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, ticks, code) => hold(store, code.trim() ? code.replace(/^ (.*) $/, '$1') : code));
  out = out.replace(ESCAPABLE, (_, ch) => hold(store, ch));
  out = out
    .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, alt, url) => hold(store, `${alt.trim() || '이미지'} (${url})`))
    .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, label, url) => hold(store, label.trim() === url ? url : `${label} (${url})`))
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, (_, url) => hold(store, url))
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`)
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, `$1${BOLD_OPEN}$2${BOLD_CLOSE}`)
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?![\w*])/g, (m, lead, body) => body === undefined ? m : lead + body)
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])?_(?!\w)/g, (m, lead, body) => body === undefined ? m : lead + body);
  // Single-letter emphasis (*a*) slips past the two rules above.
  out = out.replace(/(^|[^\w*])\*([^\s*])\*(?![\w*])/g, '$1$2');
  return release(release(out, store), store);
}

export const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/;
export const HEADING = /^\s{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
export const RULE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
export const QUOTE = /^\s{0,3}>[ \t]?(.*)$/;
export const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i;
export const TASK = /^(\s*)[-*+][ \t]+\[([ xX])\][ \t]+(.*)$/;
export const BULLET = /^(\s*)[-*+][ \t]+(.*)$/;
export const NUMBER = /^(\s*)(\d+)[.)][ \t]+(.*)$/;
export const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// One table row's cells; inline decides how each cell's marks are read (Telegram: plain, 한글: bold kept).
export const tableCells = (line, inline = telegramInline) => {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map(c => inline(c.trim().replace(/\\\|/g, '|')));
};
const cells = line => tableCells(line);
// A table starts where a line with | is followed by a separator row (| --- |).
export const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-');

function listLine(line) {
  let m = TASK.exec(line);
  if (m) return `${m[1]}${m[2] === ' ' ? '☐' : '☑'} ${telegramInline(m[3])}`;
  m = NUMBER.exec(line);
  if (m) return `${m[1]}${m[2]}. ${telegramInline(m[3])}`;
  m = BULLET.exec(line);
  if (m && !RULE.test(line)) return `${m[1]}• ${telegramInline(m[2])}`;
  return null;
}

export function toTelegram(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      // Code keeps its text as typed; only the fence lines go. Diagrams cannot show in Telegram.
      const close = new RegExp('^\\s{0,3}' + fence[1][0] + '{' + fence[1].length + ',}\\s*$'), body = [];
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
      out.push(...(fence[2].toLowerCase() === 'mermaid' ? [TELEGRAM_DIAGRAM] : body));
      i = j; continue;
    }
    if (isTableStart(lines, i)) {
      // A table becomes one sentence per row: "머리말: 값, 머리말: 값".
      const head = cells(line);
      let j = i + 2;
      for (; j < lines.length && lines[j].includes('|') && lines[j].trim(); j++) {
        const row = cells(lines[j]).map((value, k) => !value ? '' : head[k] ? `${head[k]}: ${value}` : value).filter(Boolean);
        if (row.length) out.push(row.join(', '));
      }
      i = j - 1; continue;
    }
    let m = HEADING.exec(line);
    if (m) { out.push(telegramInline(m[1])); continue; }
    if (RULE.test(line)) { out.push(TELEGRAM_RULE); continue; }
    m = QUOTE.exec(line);
    if (m) {
      // A run of > lines: a callout keeps its name in brackets and drops the marks; a plain quote keeps a bar.
      const run = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) run.push(QUOTE.exec(lines[i])[1]);
      i--;
      const callout = CALLOUT.exec(run[0].trim());
      if (callout) out.push(`[${CALLOUT_NAMES[callout[1].toUpperCase()]}]`);
      for (const inner of callout ? run.slice(1) : run) {
        const text = listLine(inner) ?? telegramInline(inner);
        out.push(callout ? text : text ? `▎ ${text}` : '▎');
      }
      continue;
    }
    const list = listLine(line);
    if (list !== null) { out.push(list); continue; }
    out.push(telegramInline(line.replace(/(?: {2,}|\\)$/, '')));
  }
  return out.map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
