// MD-내보내기 [한글용 복사](8-11a): 노트·메모의 마크다운을 한글(HWP 프로그램)에 붙여 넣었을 때 노조 문서 번호 체계 자리에 맞게 정돈한다(순수 함수).
// "쓴 대로 나온다 + @1 단축"(명진 선택 C): 직접 쓴 번호 기호(1. 1) (1) ① 가. 가) (가))와 - 글머리는 글자·번호를 바꾸지 않고, 번호를 새로 매기지 않는다.
// 번호 기호 줄의 들여쓰기만 기호 종류의 단계(docs/hwp-style-map.md 3절: 1.=0칸 1)=2칸 (1)=4칸 ①=6칸 가.=8칸 가)=10칸 (가)=12칸)로 정돈한다.
// `* 글`·`> 인용`·강조 상자(`> [!NOTE]`)도 쓴 그대로 둔다. 바꾸는 기호는 단축 입력 @1~@50 → ①~㊿ 하나뿐이다. 글 내용(문체 포함)은 바꾸지 않는다. 결과는 같은 내용의 두 가지다: text(일반 글, text/plain)와 html(굵게·표, text/html).
// 줄 판별 정규식·표 칸 나누기·글 안 꾸밈 규칙은 [텔레그램용 복사](md-telegram.mjs)와 같은 것을 쓴다. 규칙표: docs/markdown-view.md 9절.
import {markedInline, dropBold, tableCells, isTableStart, BOLD_OPEN, BOLD_CLOSE, FENCE, RULE, TASK, BULLET} from './md-telegram.mjs';

export const HANGUL_DIAGRAM = '(도식은 한글에서 보이지 않아 뺐습니다)';
// A written number mark sits at its own level: HANGUL_INDENT spaces per level above it.
export const HANGUL_INDENT = 2;
const LETTERS = '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허';
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

// The mark of an item as the user wrote it, in the order of the 단계표: 1. 1) (1) ① 가. 가) (가). ① needs no space after it.
const MARKS = [
  /^\d+\.(?=\s|$)/, /^\d+\)(?=\s|$)/, /^\(\d+\)(?=\s|$)/, /^[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]/,
  new RegExp(`^[${LETTERS}]\\.(?=\\s|$)`), new RegExp(`^[${LETTERS}]\\)(?=\\s|$)`), new RegExp(`^\\([${LETTERS}]\\)(?=\\s|$)`),
];
// Which level (0-based) a written mark belongs to, or -1.
export const markLevel = text => MARKS.findIndex(re => re.test(text));

function circled(n) {
  if (n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  return String.fromCodePoint(0x32B1 + n - 36);
}
// Shortcut @1..@50 → ①..㊿ outside code spans: not after a letter, digit or "." (e-mail), not inside an address, not @51+ or @01.
export function atShort(text) {
  return String(text).split(/(`+[^`]*`+)/).map((part, i) => i % 2 ? part : part.replace(/\S+/g, token =>
    /:\/\/|^www\./i.test(token) ? token : token.replace(/(?<![A-Za-z0-9.])@([1-9]\d?)(?![0-9A-Za-z])/g, (m, d) => +d <= 50 ? circled(+d) : m))).join('');
}
const inline = text => markedInline(atShort(text));

const width = space => space.replace(/\t/g, '    ').length;
const gap = n => ' '.repeat(n);

// Reads the markdown into blocks: {type:'line', pad, text, strong} | {type:'blank'} | {type:'table', head, rows}.
// text keeps bold as BOLD_OPEN/BOLD_CLOSE marks; strong makes the whole line bold (titles and headings).
function blocks(markdown) {
  // The bold marks are private-use characters; any already in the text are dropped so they cannot open a <b>.
  const lines = String(markdown ?? '').replace(/[]/g, '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  const line = (spaces, text, strong = false) => out.push({type: 'line', pad: spaces, text, strong});
  for (let i = 0; i < lines.length; i++) {
    const raw = atShort(lines[i]).replace(/(?: {2,}|\\)$/, '');
    if (!raw.trim()) { out.push({type: 'blank'}); continue; }
    const fence = FENCE.exec(lines[i]);
    if (fence) {
      // Code keeps its text and spacing as typed (@1 too); only the fence lines go.
      const close = new RegExp('^\\s{0,3}' + fence[1][0] + '{' + fence[1].length + ',}\\s*$'), body = [];
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
      if (fence[2].toLowerCase() === 'mermaid') line('', HANGUL_DIAGRAM);
      else for (const code of body) code.trim() ? out.push({type: 'line', pad: '', text: code, code: true}) : out.push({type: 'blank'});
      i = j; continue;
    }
    if (isTableStart(lines, i)) {
      // A real table: the head row and the body rows, cells keep their bold.
      const head = tableCells(raw, inline), rows = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].includes('|') && lines[j].trim(); j++) rows.push(tableCells(lines[j], inline));
      out.push({type: 'table', head, rows});
      i = j - 1; continue;
    }
    let m = HEADING.exec(raw);
    if (m) {
      // # 제목 is the document title (안건제목); ## and below stay headings. Neither takes a number.
      line('', inline(m[2]), true); continue;
    }
    if (RULE.test(raw)) { out.push({type: 'blank'}); continue; }
    m = TASK.exec(raw);
    if (m) {
      // A check item keeps its written indent and takes no number.
      line(gap(width(m[1])), `${m[2] === ' ' ? '☐' : '☑'} ${inline(m[3])}`); continue;
    }
    const written = raw.trimStart(), level = markLevel(written), bullet = level < 0 && BULLET.exec(raw);
    if (bullet) {
      // - (and +, *) items are not numbered: the mark stays as typed ("* " is the 참고 줄, hwp-style-map 3절) at the written indent.
      line(gap(width(bullet[1])), `${written[0]} ${inline(bullet[2])}`); continue;
    }
    if (level >= 0) {
      // A number mark the user wrote: mark and number stay; only the indent goes to the mark's level.
      const mark = MARKS[level].exec(written)[0];
      line(gap(level * HANGUL_INDENT), mark + inline(written.slice(mark.length))); continue;
    }
    // Plain text keeps its written indent.
    line(gap(width(/^\s*/.exec(raw)[0])), inline(raw.trim()));
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
