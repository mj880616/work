// MD-내보내기 [한글용 복사](8-11a): 노트·메모의 마크다운을 한글(HWP 프로그램)에 붙여 넣었을 때 노조 문서 번호 체계로 보이게 바꾼다(순수 함수).
// 기준은 docs/hwp-style-map.md 3절이다: 목록 1단계 1. → 2단계 1) → 3단계 (1) → 4단계 ① → 5단계 가. → 6단계 가) → 7단계 이상 (가).
// 클립보드로는 한글 스타일이 넘어가지 않으므로 기호·들여쓰기·굵게·표만 맞추고, 스타일은 한글에서 단축키(Ctrl+1~0)로 입힌다.
// 글 내용(문체 포함)은 바꾸지 않는다. 결과는 같은 내용의 두 가지다: text(일반 글, text/plain)와 html(굵게·표, text/html).
// 줄 판별 정규식·표 칸 나누기·글 안 꾸밈 규칙은 [텔레그램용 복사](md-telegram.mjs)와 같은 것을 쓴다. 규칙표: docs/markdown-view.md 9절.
import {markedInline, dropBold, tableCells, isTableStart, BOLD_OPEN, BOLD_CLOSE, FENCE, RULE, QUOTE, CALLOUT, TASK, NUMBER, BULLET, CALLOUT_NAMES} from './md-telegram.mjs';

export const HANGUL_DIAGRAM = '(도식은 한글에서 보이지 않아 뺐습니다)';
// Each list level steps in by this many spaces (level 1 stays at the margin).
export const HANGUL_INDENT = 2;
const LETTERS = [...'가나다라마바사아자차카타파하', ...'거너더러머버서어저처커터퍼허'];
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

function circled(n) {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32B1 + n - 36);
  return `(${n})`;
}
const letter = n => LETTERS[n - 1] ?? String(n);

// The mark for the n-th item (1-based) at a list level (1-based): 1. 1) (1) ① 가. 가) (가), and (가) again past 7.
export function levelMark(level, n) {
  switch (Math.min(level, 7)) {
    case 1: return `${n}.`;
    case 2: return `${n})`;
    case 3: return `(${n})`;
    case 4: return circled(n);
    case 5: return `${letter(n)}.`;
    case 6: return `${letter(n)})`;
    default: return `(${letter(n)})`;
  }
}

const width = space => space.replace(/\t/g, '    ').length;
const pad = level => ' '.repeat(Math.max(0, level - 1) * HANGUL_INDENT);

// Reads the markdown into blocks: {type:'line', pad, text, strong} | {type:'blank'} | {type:'table', head, rows}.
// text keeps bold as BOLD_OPEN/BOLD_CLOSE marks; strong makes the whole line bold (titles and headings).
function blocks(markdown) {
  // The bold marks are private-use characters; any already in the text are dropped so they cannot open a <b>.
  const lines = String(markdown ?? '').replace(/[]/g, '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  // Open list levels: indent (spaces) of each level's items, the list kind and the last number used.
  let stack = [], afterBlank = false;
  const resetList = () => { stack = []; };
  const line = (spaces, text, strong = false) => out.push({type: 'line', pad: spaces, text, strong});
  // Which level an item with this indent belongs to; deeper levels close.
  function levelFor(indent) {
    while (stack.length && indent < stack.at(-1).indent) stack.pop();
    if (!stack.length || indent > stack.at(-1).indent) stack.push({indent, kind: null, count: 0});
    return stack.length;
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/(?: {2,}|\\)$/, '');
    if (!raw.trim()) { out.push({type: 'blank'}); afterBlank = true; continue; }
    const wasBlank = afterBlank; afterBlank = false;
    const fence = FENCE.exec(raw);
    if (fence) {
      // Code keeps its text and spacing as typed; only the fence lines go.
      resetList();
      const close = new RegExp('^\\s{0,3}' + fence[1][0] + '{' + fence[1].length + ',}\\s*$'), body = [];
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
      if (fence[2].toLowerCase() === 'mermaid') line('', HANGUL_DIAGRAM);
      else for (const code of body) code.trim() ? out.push({type: 'line', pad: '', text: code, code: true}) : out.push({type: 'blank'});
      i = j; continue;
    }
    if (isTableStart(lines, i)) {
      // A real table: the head row and the body rows, cells keep their bold.
      resetList();
      const head = tableCells(raw, markedInline), rows = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].includes('|') && lines[j].trim(); j++) rows.push(tableCells(lines[j], markedInline));
      out.push({type: 'table', head, rows});
      i = j - 1; continue;
    }
    let m = HEADING.exec(raw);
    if (m) {
      // # 제목 is the document title (안건제목); ## and below stay headings. Neither takes a number.
      resetList(); line('', markedInline(m[2]), true); continue;
    }
    if (RULE.test(raw)) { resetList(); out.push({type: 'blank'}); continue; }
    m = QUOTE.exec(raw);
    if (m) {
      // Quotes and callouts become 참고 줄 (* …), the 세부 참고사항 style; a callout keeps its name on the first line.
      resetList();
      const run = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) run.push(QUOTE.exec(lines[i])[1]);
      i--;
      const callout = CALLOUT.exec(run[0].trim()), body = (callout ? run.slice(1) : run).filter(t => t.trim());
      const name = callout ? `[${CALLOUT_NAMES[callout[1].toUpperCase()]}]` : '';
      if (!body.length && name) line('', `* ${name}`);
      body.forEach((t, k) => line('', `* ${k === 0 && name ? name + ' ' : ''}${markedInline(t.trim())}`));
      continue;
    }
    m = TASK.exec(raw);
    if (m) {
      // A check item sits at its level without a number.
      const level = levelFor(width(m[1]));
      line(pad(level), `${m[2] === ' ' ? '☐' : '☑'} ${markedInline(m[3])}`); continue;
    }
    const number = NUMBER.exec(raw), bullet = !number && BULLET.exec(raw);
    if (bullet && raw.trimStart()[0] === '*') {
      // "* " is the union document's 참고 줄 (hwp-style-map 3절): it stays a * line and takes no number.
      const spaces = stack.length ? pad(levelFor(width(bullet[1]))) : '';
      line(spaces, `* ${markedInline(bullet[2])}`); continue;
    }
    if (number || bullet) {
      // 1. and - items both take the level's mark. An ordered list starts at its first number; a level restarts when
      // the list kind changes there; going back up closes the deeper levels.
      const [, space, start, rest] = number || [null, bullet[1], null, bullet[2]];
      const level = levelFor(width(space)), entry = stack[level - 1], kind = number ? 'ordered' : 'bullet';
      if (entry.kind !== kind) { entry.kind = kind; entry.count = number ? Number(start) - 1 : 0; }
      entry.count++;
      line(pad(level), `${levelMark(level, entry.count)} ${markedInline(rest)}`); continue;
    }
    // Plain text: inside a list an indented line (or a line right under an item) is that item's body and keeps the
    // numbering; otherwise the list ends.
    const indent = width(/^\s*/.exec(raw)[0]);
    if (stack.length && (indent > 0 || !wasBlank)) {
      // The deepest open item it is indented under (a line right under an item without indent belongs to that item).
      let level = stack.length;
      if (indent > 0) while (level > 1 && indent <= stack[level - 1].indent) level--;
      line(pad(level) + ' '.repeat(HANGUL_INDENT), markedInline(raw.trim())); continue;
    }
    resetList();
    line('', markedInline(raw.trim()));
  }
  // Blank-line runs shrink to one; none at the ends.
  const tidy = [];
  for (const b of out) if (b.type !== 'blank' || (tidy.length && tidy.at(-1).type !== 'blank')) tidy.push(b);
  while (tidy.at(-1)?.type === 'blank') tidy.pop();
  return tidy;
}

const ESC = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ESC[c]);
// Escapes the text, then turns the bold marks into <b>…</b> (an unclosed mark closes at the end).
function htmlInline(text) {
  let open = false;
  const html = escapeHtml(text).replace(/[]/g, mark => {
    if (mark === BOLD_OPEN && !open) { open = true; return '<b>'; }
    if (mark === BOLD_CLOSE && open) { open = false; return '</b>'; }
    return '';
  });
  return open ? html + '</b>' : html;
}
const nbsp = spaces => '&nbsp;'.repeat(spaces.length);
const P = '<p style="margin:0">';
const CELL = 'border:1px solid #000;padding:2pt 4pt';

// Plain text: marks gone, tables as tab-separated rows (한글 [표 만들기]로 다시 표가 됨).
function plainOf(list) {
  return list.map(b => {
    if (b.type === 'blank') return '';
    if (b.type === 'table') return [b.head, ...b.rows].map(row => row.map(dropBold).join('\t')).join('\n');
    return (b.pad + dropBold(b.text)).replace(/[ \t]+$/, '');
  }).join('\n');
}

// HTML: one margin-less paragraph per line, leading spaces as &nbsp;, bold as <b>, tables as a bordered <table>.
function htmlOf(list) {
  return list.map(b => {
    if (b.type === 'blank') return `${P}<br></p>`;
    if (b.type === 'table') {
      const row = (cells, tag) => `<tr>${cells.map(c => `<${tag} style="${CELL}">${htmlInline(c) || '<br>'}</${tag}>`).join('')}</tr>`;
      return `<table style="border-collapse:collapse">${row(b.head, 'th')}${b.rows.map(r => row(r, 'td')).join('')}</table>`;
    }
    if (b.code) return `${P}${escapeHtml(b.text).replace(/^[ \t]+/, s => nbsp(s.replace(/\t/g, '    ')))}</p>`;
    const body = htmlInline(b.text);
    return `${P}${nbsp(b.pad)}${b.strong ? `<b>${body.replace(/<\/?b>/g, '')}</b>` : body}</p>`;
  }).join('');
}

// The 한글 copy of a note or memo: {text, html}. The stored text is never changed (this is only the copy).
export function toHangul(markdown) {
  const list = blocks(markdown);
  return {text: plainOf(list), html: list.length ? htmlOf(list) : ''};
}
