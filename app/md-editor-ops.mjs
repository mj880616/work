// MD-편집기: 도구 막대 버튼이 글에 하는 일(순수 함수). DOM이 없어 Node 단위 검사에서 그대로 돈다.
// 모든 함수는 (글, 선택 시작, 선택 끝)을 받아 {from, to, insert, selStart, selEnd}를 돌려준다.
// md-editor.js가 from~to를 insert로 바꾸고(브라우저 기본 되돌리기 기록에 남도록) 선택을 selStart~selEnd로 옮긴다.

export const MERMAID_TEMPLATES = Object.freeze({
  flow: {label: '흐름도', body: 'flowchart TD\n  A[시작] --> B{확인}\n  B -->|예| C[진행]\n  B -->|아니오| D[보완]\n  D --> B'},
  sequence: {label: '순서도', body: 'sequenceDiagram\n  사무국->>위원장: 초안 보고\n  위원장-->>사무국: 수정 요청\n  사무국->>위원장: 수정본 보고'},
  timeline: {label: '타임라인', body: 'timeline\n  title 진행 일정\n  10월 1주 : 초안 작성\n  10월 2주 : 검토 : 수정\n  10월 3주 : 발송'},
});
// 기존 표시(markdown-render.mjs CALLOUTS)와 같은 5종.
export const CALLOUT_KINDS = Object.freeze([['NOTE', '참고'], ['TIP', '팁'], ['IMPORTANT', '중요'], ['WARNING', '경고'], ['CAUTION', '주의']]);
export const TABLE_TEMPLATE = '| 항목 | 내용 | 비고 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |';

const lineStart = (text, at) => text.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (text, at) => { const i = text.indexOf('\n', at); return i === -1 ? text.length : i; };
// The whole lines a selection touches. A selection ending right at the start of a line leaves that line out.
function lineRange(text, s, e) {
  const from = lineStart(text, s);
  const last = e > s && text[e - 1] === '\n' ? e - 1 : e;
  return {from, to: lineEnd(text, Math.max(last, from))};
}

// **굵게**·*기울임*·`코드`: wraps the selection, or unwraps it when the marks are already right outside it.
export function wrapInline(text, s, e, mark, placeholder) {
  const m = mark.length;
  let a = s, b = e;
  // Markdown wants the marks against the words: leave surrounding spaces outside.
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  if (a === b) {
    const insert = mark + placeholder + mark;
    return {from: s, to: e, insert, selStart: s + m, selEnd: s + m + placeholder.length};
  }
  const inner = text.slice(a, b);
  if (text.slice(a - m, a) === mark && text.slice(b, b + m) === mark && !(mark === '*' && text[a - m - 1] === '*' && text[b + m] === '*')) {
    return {from: a - m, to: b + m, insert: inner, selStart: a - m, selEnd: b - m};
  }
  if (inner.length >= 2 * m && inner.startsWith(mark) && inner.endsWith(mark)) {
    const bare = inner.slice(m, -m);
    return {from: a, to: b, insert: bare, selStart: a, selEnd: a + bare.length};
  }
  return {from: a, to: b, insert: mark + inner + mark, selStart: a + m, selEnd: b + m};
}

const HEADING = /^(\s*)#{1,6}[ \t]+/;
const TASK = /^(\s*)[-*+][ \t]+\[[ xX]\][ \t]+/;
const BULLET = /^(\s*)[-*+][ \t]+/;
const NUMBER = /^(\s*)\d+[.)][ \t]+/;
const QUOTE = /^(\s*)>[ \t]?/;
const LINE_KINDS = {
  h1: {has: l => /^\s*#[ \t]/.test(l), strip: HEADING, add: () => '# '},
  h2: {has: l => /^\s*##[ \t]/.test(l), strip: HEADING, add: () => '## '},
  h3: {has: l => /^\s*###[ \t]/.test(l), strip: HEADING, add: () => '### '},
  bullet: {has: l => BULLET.test(l) && !TASK.test(l), strip: [TASK, BULLET, NUMBER], add: () => '- '},
  number: {has: l => NUMBER.test(l), strip: [TASK, BULLET, NUMBER], add: i => `${i + 1}. `},
  task: {has: l => TASK.test(l), strip: [TASK, BULLET, NUMBER], add: () => '- [ ] '},
  quote: {has: l => QUOTE.test(l), strip: QUOTE, add: () => '> '},
};
function stripLine(line, strip) {
  for (const re of [].concat(strip)) { const m = re.exec(line); if (m) return m[1] + line.slice(m[0].length); }
  return line;
}

// 제목·글머리·번호·체크·인용: puts the mark in front of each touched line, or takes it off when every line has it.
export function prefixLines(text, s, e, kind) {
  const rule = LINE_KINDS[kind];
  if (!rule) throw new Error('unknown line kind ' + kind);
  const {from, to} = lineRange(text, s, e);
  const lines = text.slice(from, to).split('\n');
  const used = lines.filter(l => l.trim());
  const remove = used.length > 0 && used.every(rule.has);
  let n = 0;
  const next = lines.map(line => {
    if (remove) return stripLine(line, rule.has(line) ? (kind.startsWith('h') ? HEADING : [TASK, BULLET, NUMBER, QUOTE].find(re => re.test(line))) : []);
    if (!line.trim() && lines.length > 1) return line;
    const bare = stripLine(line, rule.strip), indent = /^\s*/.exec(bare)[0];
    return indent + rule.add(n++) + bare.slice(indent.length);
  });
  const insert = next.join('\n');
  if (s === e && lines.length === 1) {
    // Keep the caret on the same word; on an empty line it lands right after the new mark.
    const pos = Math.min(Math.max(s + insert.length - (to - from), from), from + insert.length);
    return {from, to, insert, selStart: pos, selEnd: pos};
  }
  return {from, to, insert, selStart: from, selEnd: from + insert.length};
}

// Puts a block on its own lines with one blank line around it. Without a selection it goes after the caret's line,
// so a caret in the middle of a sentence never splits it. select = [start, end] inside block.
export function insertBlock(text, s, e, block, select = [block.length, block.length]) {
  const at = s === e ? lineEnd(text, s) : lineEnd(text, e > s && text[e - 1] === '\n' ? e - 1 : e);
  const before = text.slice(0, at), after = text.slice(at);
  const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const insert = lead + block + tail, base = at + lead.length;
  return {from: at, to: at, insert, selStart: base + select[0], selEnd: base + select[1]};
}
// Wraps the touched lines in a block (fence or callout), with a blank line around it.
function wrapLines(text, s, e, open, close, linePrefix = '') {
  const {from, to} = lineRange(text, s, e);
  const body = text.slice(from, to).split('\n').map(l => linePrefix + l).join('\n');
  const before = text.slice(0, from), after = text.slice(to);
  const lead = !before || before.endsWith('\n\n') ? '' : '\n';
  const tail = !after ? '' : after.startsWith('\n\n') || after === '\n' ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const insert = lead + open + '\n' + body + (close ? '\n' + close : '') + tail;
  const start = from + lead.length + open.length + 1;
  return {from, to, insert, selStart: start, selEnd: start + body.length};
}

// 코드: one-line selection → `코드`, otherwise a fenced block.
export function codeFormat(text, s, e) {
  const sel = text.slice(s, e);
  if (sel.trim() && !sel.includes('\n') && !(s === lineStart(text, s) && e === lineEnd(text, e))) return wrapInline(text, s, e, '`', '코드');
  if (!sel.trim()) return insertBlock(text, s, e, '```\n코드\n```', [4, 6]);
  return wrapLines(text, s, e, '```', '```');
}
// 강조 상자: > [!NOTE] 등 5종. A selection becomes the box body.
export function calloutFormat(text, s, e, kind = 'NOTE') {
  const head = `> [!${kind}]`;
  if (!text.slice(s, e).trim()) return insertBlock(text, s, e, `${head}\n> 내용`, [head.length + 3, head.length + 5]);
  return wrapLines(text, s, e, head, '', '> ');
}
export function tableFormat(text, s, e) { return insertBlock(text, s, e, TABLE_TEMPLATE, [2, 4]); }
export function ruleFormat(text, s, e) { return insertBlock(text, s, e, '---'); }
export function mermaidFormat(text, s, e, kind = 'flow') {
  const t = MERMAID_TEMPLATES[kind];
  if (!t) throw new Error('unknown diagram ' + kind);
  const block = '```mermaid\n' + t.body + '\n```';
  return insertBlock(text, s, e, block, [11, 11 + t.body.length]);
}

// NOTE-마크다운선택: 마크다운을 끈 노트에서 글자만으로 되는 버튼(• 목록 '- ', 1. 번호 '1. ', ☐ 체크 '☐ ', 구분선 '────').
// 나머지(제목·굵게·기울임·표·인용·코드·강조 상자·도식)는 마크다운이 있어야 보이므로 여기 없다(md-editor.js가 켤지 묻는다).
export const PLAIN_ACTIONS = Object.freeze(['bullet', 'number', 'task', 'rule']);
const PLAIN_TASK = /^(\s*)☐[ \t]+/;
const PLAIN_RULE = '────';
export function applyPlainAction(text, s, e, action) {
  if (action === 'bullet' || action === 'number') return prefixLines(text, s, e, action);
  if (action === 'rule') return insertBlock(text, s, e, PLAIN_RULE);
  if (action !== 'task') throw new Error('not a plain action ' + action);
  // ☐ in front of each touched line, or off when every written line already has it.
  const {from, to} = lineRange(text, s, e);
  const lines = text.slice(from, to).split('\n'), used = lines.filter(l => l.trim());
  const remove = used.length > 0 && used.every(l => PLAIN_TASK.test(l));
  const insert = lines.map(line => {
    if (remove) return stripLine(line, PLAIN_TASK);
    if (!line.trim() && lines.length > 1) return line;
    const bare = stripLine(line, [TASK, BULLET, NUMBER]), indent = /^\s*/.exec(bare)[0];
    return indent + '☐ ' + bare.slice(indent.length);
  }).join('\n');
  if (s === e && lines.length === 1) {
    const pos = Math.min(Math.max(s + insert.length - (to - from), from), from + insert.length);
    return {from, to, insert, selStart: pos, selEnd: pos};
  }
  return {from, to, insert, selStart: from, selEnd: from + insert.length};
}

// One entry point for the toolbar: action names match data-md-action in md-editor.js.
export function applyAction(text, s, e, action, option) {
  switch (action) {
    case 'heading': return prefixLines(text, s, e, 'h' + (option || '1'));
    case 'bold': return wrapInline(text, s, e, '**', '굵은 글');
    case 'italic': return wrapInline(text, s, e, '*', '기울인 글');
    case 'bullet': case 'number': case 'task': case 'quote': return prefixLines(text, s, e, action);
    case 'code': return codeFormat(text, s, e);
    case 'callout': return calloutFormat(text, s, e, option);
    case 'table': return tableFormat(text, s, e);
    case 'rule': return ruleFormat(text, s, e);
    case 'mermaid': return mermaidFormat(text, s, e, option);
    default: throw new Error('unknown action ' + action);
  }
}
