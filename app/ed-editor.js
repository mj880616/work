// ED-통합편집기 ①a: the one rich-text editor part (블로그 글쓰기형, docs/design/unified-editor.md 2.3), built on the vendored
// ProseMirror bundle (app/editor-lib, loaded only when an editor opens). It edits one document in one box and saves nothing:
// the opener reads getValue() (the cleaned saved form {v:'ed1', doc}) and stores it its own way.
// Button row (small 28px buttons, 44px press area; a phone swipes the one row sideways with [⌄] kept at its right end;
// wider than a phone, buttons that do not fit move under [⌄], so no sideways scroll bar). ED-서식줄펼침 (2026-10-23 사용자
// 11:06~11:10): every button that opens choices carries a small ▾ and opens a small popover right under itself (overlaying the
// text, closed by a press outside or Esc, kept inside the screen); [⌄] ([⌃] while open) is the only button that opens a
// full-width row (the less used buttons). ED-기본기보강 (2026-10-22 사용자
// 19:24~19:33, 대조표 docs/design/unified-editor.md 9절): the often-used buttons stay on the row, the rest are under [⋯]:
//   [본문 2 ▾] | 굵게 기울임 밑줄 | 글자색 ▾ 형광펜 ▾ | 정렬 ▾ | 목록 ▾ 번호 ▾ | 표 ▾ 링크 | · ※ → ① (each ▾) | ↶ ↷ | ⌄
//   ⌄ = 취소선 인용 구분선 들여쓰기 내어쓰기 서식 지우기 지금 시각 서식 없이 붙여넣기 「」 (그리고 폭이 모자라 옮겨진 버튼)
// NOTE-노션편집 ①(가) (2026-11-25 명진 03:24 "모바일 편집툴 ui는 좋음 / Pc는 기능이 산개돼있는 느낌"): every width now uses the phone's
// grouped row below — the same groups, the same order, the same names. There is no [⌄] row any more (the old PC layout above is history).
// Wider than a phone a group's first buttons also stand on the row right before their group button (PC_OUT), and the group's list
// holds the rest, so reading the row then each list gives the same sequence on every width. When the row is too narrow for them,
// they go back into their group from the right end (the last group first). Shortcuts show in each button's tooltip (SHORTCUTS).
// ED-서식줄묶음 (2026-10-23 사용자 13:16): on a phone (max-width 760px) the same buttons are grouped so the row fits on one line:
//   [본문 2 ▾] [굵게] [· ▾] | [글자 ▾] [문단 ▾] [넣기 ▾] [기호 ▾] | ([⋮⋮] where the opener gives blocks) [↶] [↷]   (no [⌄]; every button is still there, in a group popover)
//   글자 ▾ = 기울임 밑줄 취소선 글자색 형광펜 서식 지우기 / 문단 ▾ = 정렬 목록 번호 들여쓰기 내어쓰기 인용 구분선
//   넣기 ▾ = 표 사진 링크 지금 시각 서식 없이 붙여넣기 / 기호 ▾ = ※ → ① 「」 ([· ▾] is one button as on a wider screen: its list starts with ·)
// The grouped buttons are the same nodes (moved, so their commands and state stay); a button that opens choices (글자색, 정렬, 목록…)
// opens its own popover under itself, over the group popover. Wider than a phone nothing changes.
// [표] opens a grid to pick rows × columns; a table cell's right-click (a phone's long press) menu adds and removes rows and
// columns, merges and splits cells; column edges drag (saved on the cells, read the same by every reader); a double click on
// an edge fits that column to its letters; Tab goes to the next cell (the last cell's Tab adds a row). A table, rule or photo
// is never a dead end: the text always ends with an empty line, and a gap cursor lets one type before or after any of them.
// Backspace on the line below a table first selects the table, a second press removes it (↶ brings it back).
// [사진] (ED-②) exists only where the opener passes `photos` (share pages: share-photos.js keeps each photo in a private bucket
// and gives a short address to show it). Without `photos` there is no button, and a dropped or pasted picture or file is not put
// in (a short note says so). A saved photo place (src null) still shows as a place.
// Decisions (2026-10-22 사용자, 설계 0절): no format while typing (no input rules: "1. " "- " "# " stay letters) — except where the
// opener asks for shortcuts (ED③ 노트, 2026-10-24 결정 2: see createDocEditor's shortcuts); a paste of
// plain letters goes in as typed, one paragraph per line, and when it looks like markdown that pasted part is converted right
// away, as its own undo step (ED-폰마크다운붙여넣기 2026-10-28: [↶] once puts the letters back). A phone's copy often brings a
// formatted copy (text/html) that only wraps the same letters, signs and all, and a keyboard's clipboard row puts the letters in
// as typed text with no paste at all: both count as a markdown paste. A text that is only plain lines looking like markdown (one
// pasted as letters before) gets a small [서식으로 바꾸기] that converts the whole text once (undo puts it back). [①] opens ①~⑩ (the next number after the nearest one is marked).
// S48-21 (요청함 10/22 09:33·19:27, 10/23 11:08):
//   - (the [⌄] row and its remembered open state were retired by NOTE-노션편집 ①(가): every width is the grouped row.)
//   - [파일] exists only where the opener passes `files` (notes: the note's own attachments) or `onFiles` (update windows: the chosen files
//     go to the window's own attachment row, NOTE-파일그림넣기 ④). With `files` a file goes in as a small card
//     (name · size); its [열기] opens it (files.open). A dropped or pasted file that is not a picture goes the same way.
//   - 사진 나란히: a photo dragged onto another photo's left or right half joins it on one line (photo_row, up to PHOTO_ROW_MAX); a chosen
//     photo shows a small row [옆 사진과 나란히] [따로 놓기]; several photos picked at once go in side by side without asking (S52-05 A,
//     rows of PHOTO_ROW_MAX); one of them goes back to a line of its own with [따로 놓기] or by dragging it out.
//     The row's photos are as high as each other; a phone wraps a row of three or four (ed-doc.css).
// 한글 IME: nothing here changes the document while a composition is running. A button pressed during one lets the press blur
// the box first (that ends the composition), then runs and puts focus back.
import {mountBlocks, gripIcon, phoneTouchMedia} from './ed-blocks.js';
import {mountGtasks, gtaskDedupe} from './ed-gtasks.js';
// FIX-main시험(이슈 3284): 편집기가 화면에 뜬 뒤 늦게 불러오면 그 사이 친 '[['를 놓친다 — 편집기와 함께 불러온다.
import {mountNoteLink} from './ed-note-link.js';
import {TEXT_STYLES, DEFAULT_BODY, BODY_STYLES, TEXT_COLORS, HIGHLIGHTS, LIMITS, PHOTO_ROW_MAX, fileSizeText, cleanDoc, emptyDoc, safeHref, nextCircled, CHECK_MARKER,
  circled, widthsOfRow, tableLayout, scaleWidths, stepWidths, evenWidths, BULLET_MARKERS, ORDER_MARKERS, autoMarker, bulletGlyph, orderedLabel} from './ed-schema.mjs';
import {looksLikeMarkdown} from './note-markdown.mjs';
import {markdownToDoc, markdownLettersOf} from './ed-markdown.mjs';
import {toPlain} from './ed-text.mjs';
import {nowText} from './ed-now-text.mjs';
import {slotLoading, slotShown, slotFailed} from './img-slot.js';
import {clipboardFiles, namePasted} from './paste-files.mjs';
import {keepLetterBreaks, splitBlankLines} from './ed-paste.mjs';
import {splitPictures} from './picture-file.mjs';
// UI-올리기진행표시: [넣기] 사진·파일이 올라가는 동안 도구줄 아래 공용 올리는 줄(사진은 흐린 미리보기 위 막대 + %).
import {mountUploadRows, watchUploads, isUploading, announceDock, uploadJobs} from './upload-progress.js';

const LIB = './editor-lib/pm-ed1-1.2.0/prosemirror.min.mjs';
const MARKDOWN_IT = './markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
let pmPromise = null, mdPromise = null;
export const loadEditorLib = () => (pmPromise ||= import(LIB));
// The editor's markdown-it (html off, safe links only). Exported for ED③ 노트: an old markdown note opens through the same conversion.
export const loadMarkdownIt = () => (mdPromise ||= import(MARKDOWN_IT).then(({default: MarkdownIt}) => {
  const md = new MarkdownIt({html: false, linkify: true, breaks: true, typographer: false});
  md.linkify.set({fuzzyEmail: false});
  md.validateLink = url => !!safeHref(url);
  return md;
}));

const ALIGN_NAMES = ['center', 'right', 'justify'];
const styleOf = el => (/\bed-(body[123])\b/.exec(el.className || '') || [])[1] || DEFAULT_BODY;
const alignOf = el => {
  const css = el.style?.textAlign;
  if (ALIGN_NAMES.includes(css)) return css;
  return ALIGN_NAMES.find(a => new RegExp(`\\bed-${a}\\b`).test(el.className || '')) || null;
};
const indentOf = el => { const m = /\bed-indent-([1-8])\b/.exec(el.className || ''); return m ? +m[1] : 0; };
const headingLevel = el => { const m = /\bed-h([123])\b/.exec(el.className || ''); return m ? +m[1] : Math.min(3, +el.tagName.slice(1)); };
const blockClass = (cls, attrs) => [cls, attrs.align ? `ed-${attrs.align}` : '', attrs.indent ? `ed-indent-${attrs.indent}` : ''].filter(Boolean).join(' ');
const COLOR_KEYS = TEXT_COLORS.map(([v]) => v), HIGHLIGHT_KEYS = HIGHLIGHTS.map(([v]) => v);
const nameFrom = (el, prefix, list) => { const m = new RegExp(`\\b${prefix}-([a-z]+)\\b`).exec(el.className || ''); return m && list.includes(m[1]) ? m[1] : null; };

function buildSchema(pm) {
  const tables = pm.tableNodes({tableGroup: 'block', cellContent: 'block+', cellAttributes: {}});
  return new pm.Schema({
    nodes: {
      doc: {content: 'block+'},
      paragraph: {group: 'block', content: 'inline*', attrs: {style: {default: DEFAULT_BODY}, align: {default: null}, indent: {default: 0}},
        parseDOM: [{tag: 'p', getAttrs: el => ({style: styleOf(el), align: alignOf(el), indent: indentOf(el)})}],
        toDOM: n => ['p', {class: blockClass(`ed-p ed-${n.attrs.style}`, n.attrs)}, 0]},
      heading: {group: 'block', content: 'inline*', defining: true, attrs: {level: {default: 2}, align: {default: null}, indent: {default: 0}},
        parseDOM: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(tag => ({tag, getAttrs: el => ({level: headingLevel(el), align: alignOf(el), indent: indentOf(el)})})),
        toDOM: n => [`h${n.attrs.level + 1}`, {class: blockClass(`ed-h ed-h${n.attrs.level}`, n.attrs)}, 0]},
      blockquote: {group: 'block', content: 'block+', defining: true, parseDOM: [{tag: 'blockquote'}], toDOM: () => ['blockquote', {class: 'ed-quote'}, 0]},
      // ED-서식줄펼침: `marker` is a shape name (ed-schema.mjs BULLET_MARKERS·ORDER_MARKERS) or null = automatic by nesting depth.
      bullet_list: {group: 'block', content: 'list_item+', attrs: {marker: {default: null}},
        parseDOM: [{tag: 'ul', getAttrs: el => ({marker: nameFrom(el, 'ed-ul', [...BULLET_MARKERS, CHECK_MARKER])})}],
        toDOM: n => ['ul', {class: `ed-ul ed-ul-${n.attrs.marker || 'auto'}`}, 0]},
      ordered_list: {group: 'block', content: 'list_item+', attrs: {order: {default: 1}, marker: {default: null}},
        parseDOM: [{tag: 'ol', getAttrs: el => ({order: el.hasAttribute('start') ? (+el.getAttribute('start') || 1) : 1, marker: nameFrom(el, 'ed-ol', ORDER_MARKERS)})}],
        toDOM: n => ['ol', n.attrs.order === 1 ? {class: `ed-ol ed-ol-${n.attrs.marker || 'auto'}`} : {class: `ed-ol ed-ol-${n.attrs.marker || 'auto'}`, start: n.attrs.order}, 0]},
      // NOTE-노션편집 ①(나) 할 일 체크: checked draws a ticked box in a 'check' list (a press on the box ticks it: ed-editor click below).
      // S69-97: gtask = 연결한 구글 할 일 id(ed-gtasks.js). 화면에는 표시만(id는 그리지 않음) — 붙여넣기로 다른 곳에 따라가지 않는다.
      list_item: {content: 'paragraph block*', defining: true, attrs: {checked: {default: false}, gtask: {default: null}},
        parseDOM: [{tag: 'li', getAttrs: el => ({checked: el.getAttribute('data-checked') === 'true'})}],
        toDOM: n => {
          const a = {}, cls = [];
          if (n.attrs.checked) { a['data-checked'] = 'true'; cls.push('ed-done'); }
          if (n.attrs.gtask) { a['data-gtask'] = String(n.attrs.gtask).startsWith('wait:') ? 'wait' : 'on'; cls.push('ed-gtask'); }
          if (cls.length) a.class = cls.join(' ');
          return ['li', a, 0];
        }},
      // NOTE-노션편집 ①(나) 접기: the first paragraph is the ▸ line; open false folds the rest (saved). Drawn by toggleView in the editor.
      toggle: {group: 'block', content: 'paragraph block*', defining: true, attrs: {open: {default: true}},
        parseDOM: [{tag: 'div.ed-toggle', contentElement: '.ed-toggle-body', getAttrs: el => ({open: !el.classList.contains('is-closed')})},
          {tag: 'details', getAttrs: el => ({open: el.hasAttribute('open')})}],
        toDOM: n => ['div', {class: n.attrs.open ? 'ed-toggle' : 'ed-toggle is-closed'}, ['div', {class: 'ed-toggle-body'}, 0]]},
      horizontal_rule: {group: 'block', parseDOM: [{tag: 'hr'}], toDOM: () => ['hr', {class: 'ed-hr'}]},
      code_block: {group: 'block', content: 'text*', marks: '', code: true, defining: true,
        parseDOM: [{tag: 'pre', preserveWhitespace: 'full'}], toDOM: () => ['pre', {class: 'ed-code'}, ['code', 0]]},
      // Our own photo (a place until ②). Pasted <img> never becomes one: transformPastedHTML turns it into letters first.
      // S48-21: a photo drags (to set it beside another photo: handleDrop).
      image: {group: 'block', atom: true, selectable: true, draggable: true,
        attrs: {src: {default: null}, alt: {default: ''}, align: {default: null}},
        parseDOM: [{tag: 'figure.ed-photo', getAttrs: el => ({src: null, alt: el.getAttribute('data-alt') || ''})}],
        toDOM: n => ['figure', {class: 'ed-photo is-place ed-center', 'data-alt': n.attrs.alt, contenteditable: 'false'},
          ['span', {class: 'ed-photo-mark'}, '사진 자리'], ['figcaption', {class: 'ed-photo-cap'}, n.attrs.alt || '사진은 다음 단계부터 넣을 수 있어요']]},
      // S48-21 사진 나란히: 2..PHOTO_ROW_MAX photos on one line (rowsPlugin unwraps a row left with one photo).
      photo_row: {group: 'block', content: 'image+', parseDOM: [{tag: 'div.ed-photo-row'}], toDOM: () => ['div', {class: 'ed-photo-row'}, 0]},
      // S48-21 [파일]: a file card (our own id, name and size). Pasted HTML never makes one (no parseDOM).
      file: {group: 'block', atom: true, selectable: true, draggable: false,
        attrs: {src: {default: null}, name: {default: ''}, size: {default: null}},
        toDOM: n => ['div', {class: 'ed-file', contenteditable: 'false'}, ['span', {class: 'ed-file-name'}, n.attrs.name || '파일']]},
      ...tables,
      text: {group: 'inline'},
      hard_break: {group: 'inline', inline: true, selectable: false, leafText: () => '\n', parseDOM: [{tag: 'br'}], toDOM: () => ['br']},
    },
    marks: {
      strong: {parseDOM: [{tag: 'strong'}, {tag: 'b', getAttrs: el => el.style.fontWeight !== 'normal' && null},
        {style: 'font-weight', getAttrs: v => /^(bold(er)?|[6-9]\d{2})$/.test(v) && null}], toDOM: () => ['strong', 0]},
      em: {parseDOM: [{tag: 'i'}, {tag: 'em'}, {style: 'font-style=italic'}], toDOM: () => ['em', 0]},
      underline: {parseDOM: [{tag: 'u'}, {style: 'text-decoration', getAttrs: v => /underline/.test(v) && null}], toDOM: () => ['u', 0]},
      strike: {parseDOM: [{tag: 's'}, {tag: 'del'}, {tag: 'strike'}, {style: 'text-decoration', getAttrs: v => /line-through/.test(v) && null}], toDOM: () => ['s', 0]},
      link: {attrs: {href: {}}, inclusive: false,
        parseDOM: [{tag: 'a[href]', getAttrs: el => { const href = safeHref(el.getAttribute('href')); return href ? {href} : false; }}],
        toDOM: m => ['a', {href: m.attrs.href, rel: 'noopener noreferrer', target: '_blank', class: 'ed-link'}, 0]},
      // 글자색·형광펜: names only (ed-schema.mjs TEXT_COLORS·HIGHLIGHTS), drawn by ed-doc.css from theme tokens. Pasted colors
      // from elsewhere are not kept (allowlist); a pasted <mark> becomes the yellow highlight.
      color: {attrs: {color: {}}, parseDOM: [{tag: 'span.ed-c', getAttrs: el => { const c = nameFrom(el, 'ed-c', COLOR_KEYS); return c ? {color: c} : false; }}],
        toDOM: m => ['span', {class: `ed-c ed-c-${m.attrs.color}`}, 0]},
      highlight: {attrs: {color: {}}, parseDOM: [{tag: 'mark', getAttrs: el => ({color: nameFrom(el, 'ed-hl', HIGHLIGHT_KEYS) || 'yellow'})}],
        toDOM: m => ['mark', {class: `ed-hl ed-hl-${m.attrs.color}`}, 0]},
    },
  });
}

// ED-폰마크다운붙여넣기: a formatted copy (text/html) whose own letters still show the markdown signs ("## 공통" in a <p>) only
// wraps the letters — a phone's copy brings one with almost any text. Then the letters are the paste, not the wrapper.
function htmlShowsMarkdown(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const el of doc.querySelectorAll('script,style,template')) el.remove();
    for (const br of doc.querySelectorAll('br')) br.replaceWith('\n');
    for (const el of doc.body.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,pre,blockquote')) el.append('\n');
    return looksLikeMarkdown(doc.body.textContent || '');
  } catch { return false; }
}

// Pasted HTML: outside pictures become "이미지: 설명 (주소)" letters, scripts and styles go (parsed inert, nothing loads).
// NOTE-붙여넣기문단사라짐: line breaks written as letters (a chat answer's pre-wrap box) become <br> (ed-paste.mjs); plain is
// the same copy's own letters. A copy from this editor itself (data-pm-slice) is read as it is.
function cleanPastedHtml(html, plain = '') {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!/data-pm-slice/.test(html)) keepLetterBreaks(doc, plain);
    for (const el of doc.querySelectorAll('script,style,template,iframe,object,embed,svg,math,link,meta')) el.remove();
    for (const img of doc.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      img.replaceWith(doc.createTextNode(`이미지: ${img.getAttribute('alt') || '설명 없음'}${/^https?:/i.test(src) ? ` (${src})` : ''}`));
    }
    return doc.body.innerHTML;
  } catch { return ''; }
}

// The row: [key, label, aria, group]. Under [⋯]: MORE.
const BUTTONS = [
  ['style', '본문 2 ▾', '글 단계 선택', 'style'],
  ['strong', '굵게', null, 'mark'], ['em', '기울임', null, 'mark'], ['underline', '밑줄', null, 'mark'],
  ['color', '글자색 ▾', '글자색 선택', 'paint'], ['highlight', '형광펜 ▾', '형광펜 선택', 'paint'],
  ['align', '왼쪽 ▾', '정렬 선택', 'align'],
  ['bullet', '목록 ▾', '글머리 목록 선택', 'list'], ['ordered', '번호 ▾', '번호 목록 선택', 'list'],
  ['table', '표 ▾', '표 넣기', 'insert'], ['photo', '사진', '사진 넣기', 'insert'], ['scan', '문서 스캔', '문서 스캔해 넣기', 'insert'], ['file', '파일', '파일 넣기', 'insert'], ['link', '링크', '링크 넣기', 'insert'],
  ['symDot', '· ▾', '점 기호 선택', 'sym'], ['symNote', '※ ▾', '참고 기호 선택', 'sym'], ['symArrow', '→ ▾', '화살표 선택', 'sym'], ['symCircled', '① ▾', '동그라미 번호 선택', 'sym'],
  ['undo', '↶', '되돌리기', 'history'], ['redo', '↷', '다시하기', 'history'],
  // NOTE-노션편집 ①(나): 블록 편집 켜기·끄기 (only where the opener gives `blocks`). Pressed = on (손잡이 ⋮⋮).
  // NOTE-블록모드찾기(2026-11-25): a small icon button on the row itself (PHONE_ORDER, before ↶), not inside [문단 ▾] — every width the same place.
  ['blocks', '블록 모드', '블록 모드', 'blocks'],
  // S69-97 노트 안 할 일: 커서 줄의 체크칸을 구글 할 일로 연결(다시 누르면 연결 풀기). only where the opener gives `tasks` (notes); in [문단 ▾].
  ['gtask', '구글 할 일로', '체크칸을 구글 할 일로 연결', 'gtask'],
];
const PLAIN_PASTE_HINT = '복사한 글의 색·크기·표는 빼고 글자만 붙여요 (Ctrl+Shift+V)';
const MORE = [
  ['strike', '취소선', null], ['quote', '인용', null], ['rule', '구분선', null],
  ['indent', '들여쓰기', null], ['outdent', '내어쓰기', null], ['clear', '서식 삭제', null],
  ['nowStamp', '지금 시각', null], ['plainPaste', '서식 없이 붙여넣기', null], ['symBracket', '「」 ▾', '괄호·단위 기호 선택'],
  // S71-65 노트 서식: [넣기 ▾] 안 [서식] (only where the opener gives `forms`: a new note's window). It opens the opener's own picker.
  ['form', '서식', '서식 넣기'],
];
const ALIGNS = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['justify', '양쪽']];
// Signs that open a row of similar signs (사용자 19:33: 비슷한 기호 펼치기). The first one is the button's own sign.
const SYMBOLS = {
  symDot: ['·', '•', '◦', '○', '●', '□', '■', '◇', '◆', '▶', '▷', '★', '☆'],
  symNote: ['※', '☞', '◎', '▣', '☐', '☑', '✓', '✗', '!', '?'],
  symArrow: ['→', '←', '↑', '↓', '↔', '⇒', '⇔', '↗', '↘', '➝'],
  symBracket: ['「」', '『』', '〈〉', '《》', '【】', '“”', '~', '℃', '㎡', '㎞', '%', '㈜', '☎'],
};
const CIRCLED_PICK = Array.from({length: 10}, (_, i) => circled(i + 1));
const TABLE_TOOLS = [
  ['rowBefore', '위에 줄', '위에 줄 넣기'], ['rowAfter', '아래에 줄', '아래에 줄 넣기'],
  ['colBefore', '왼쪽에 칸', '왼쪽에 칸 넣기'], ['colAfter', '오른쪽에 칸', '오른쪽에 칸 넣기'],
  ['rowDel', '줄 삭제', null], ['colDel', '칸 삭제', null], ['merge', '칸 합치기', null], ['split', '칸 나누기', null],
  ['head', '머리줄', null], ['fit', '글자에 맞추기', '표 폭을 글자에 맞추기'], ['select', '표 선택', '표 전체 선택'], ['tableDel', '표 삭제', null],
];
const GRID = {rows: 6, cols: 8};
// ED-서식줄묶음: [key, label, aria, items (button keys, in order)] — a phone's grouped row (see the top of this file).
const GROUPS = [
  ['gText', '글자 ▾', '글자 서식 선택', ['em', 'underline', 'strike', 'color', 'highlight', 'clear']],
    // S69-97: [구글 할 일로] is the last of 문단, only where the opener gives tasks.
  ['gPara', '문단 ▾', '문단 서식 선택', ['align', 'bullet', 'ordered', 'indent', 'outdent', 'quote', 'rule', 'gtask']],
  // S69-98 NOTE-에버노트 ⑥: [문서 스캔] (only where the opener's photos say scan: notes) sits after [링크] (PC_OUT stays a prefix), inside [넣기 ▾] on a PC too.
  // S71-65: [서식] (only where the opener gives forms) is the last of 넣기, inside the list at every width.
  ['gInsert', '넣기 ▾', '넣을 것 선택', ['table', 'photo', 'file', 'link', 'scan', 'nowStamp', 'plainPaste', 'form']],
  ['gSym', '기호 ▾', '기호 선택', ['symNote', 'symArrow', 'symCircled', 'symBracket']],
];
const GROUP_KEYS = GROUPS.map(g => g[0]);
// UI-화면정리 C(2026-10-28 명진 요청 20:03 B④): 폰도 PC와 같은 [· ▾] 한 칸(따로 있던 [·][▾] 두 칸은 하나로). 점은 펼친 목록 맨 앞.
const PHONE_ORDER = ['style', 'strong', 'symDot', ...GROUP_KEYS, 'blocks', 'undo', 'redo'];
// NOTE-노션편집 ①(가): wider than a phone, each group's first buttons (a prefix of its list, in its order) stand on the row before the group button.
export const PC_OUT = {
  gText: ['em', 'underline', 'strike', 'color', 'highlight'],
  gPara: ['align', 'bullet', 'ordered'],
  gInsert: ['table', 'photo', 'file', 'link'],
  gSym: ['symNote', 'symArrow', 'symCircled'],
};
// The keyboard shortcut of a button, shown in its tooltip ("굵게 (Ctrl+B)"). The keys themselves are the keymap below (unchanged).
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const keyText = k => (MAC ? k.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧') : k);
export const SHORTCUTS = {
  strong: 'Ctrl+B', em: 'Ctrl+I', underline: 'Ctrl+U', link: 'Ctrl+K', clear: 'Ctrl+\\',
  indent: 'Tab', outdent: 'Shift+Tab', plainPaste: 'Ctrl+Shift+V', undo: 'Ctrl+Z', redo: 'Ctrl+Y',
};

// A button's text. A label that ends in " ▾" gets a small caret of its own (hidden from screen readers).
function setLabel(b, text) {
  if (b.dataset.edLabel === text) return;
  b.dataset.edLabel = text;
  const m = /^(.*?) ?▾$/.exec(text);
  if (!m) { b.textContent = text; return; }
  const caret = document.createElement('span');
  caret.className = 'ed-caret'; caret.setAttribute('aria-hidden', 'true'); caret.textContent = m[1] ? ' ▾' : '▾';
  b.replaceChildren(m[1], caret);
}
function btn(label, data, aria) {
  const b = document.createElement('button');
  b.type = 'button'; setLabel(b, label);
  Object.assign(b.dataset, data);
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}
// popover: a small box placed under its button (placePop), not a full-width row.
function panel(className, label, popover = false) {
  const p = document.createElement('div');
  p.className = `ed-menu ${popover ? 'ed-pop ' : ''}${className}`; p.hidden = true; p.setAttribute('role', 'group'); p.setAttribute('aria-label', label);
  return p;
}
const checkMark = () => { const c = document.createElement('span'); c.className = 'ed-check'; c.setAttribute('aria-hidden', 'true'); c.textContent = '✓'; return c; };
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
// ED-사진링크아이콘: [사진] [링크] are icons on the row and icon + letters inside the phone's [넣기 ▾] list (the stylesheet hides the letters
// on the row). Drawn in the site's own icon style (the 24-box stroke icons of the bottom menu: currentColor, round ends), shown at 16px.
const ICON_PATHS = {
  photo: [['path', {d: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5'}], ['circle', {cx: '9', cy: '9.5', r: '1.3'}]],
  link: [['path', {d: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'}]],
  // S48-21 [파일]: a paper clip.
  file: [['path', {d: 'M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8'}]],
};
const toolIcon = key => {
  const svg = svgEl('svg', {viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'});
  svg.classList.add('ed-tool-icon');
  for (const [tag, attrs] of ICON_PATHS[key]) svg.append(svgEl(tag, attrs));
  return svg;
};
// A 정렬 icon: four lines, each as long and as far over as the alignment puts it.
const ALIGN_LINES = {left: [[1, 13], [1, 9], [1, 13], [1, 7]], center: [[1, 13], [3, 11], [1, 13], [4, 10]], right: [[1, 13], [5, 13], [1, 13], [7, 13]], justify: [[1, 13], [1, 13], [1, 13], [1, 13]]};
const alignIcon = v => { const svg = svgEl('svg', {viewBox: '0 0 14 12', width: '14', height: '12', 'aria-hidden': 'true', focusable: 'false'}); ALIGN_LINES[v].forEach(([a, b], i) => svg.append(svgEl('path', {d: `M${a} ${1.5 + i * 3}H${b}`, stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round'}))); return svg; };

// Mounts an editor into host. value: a saved form (or null for an empty one). onChange(value): after each change.
// label: the text box's accessible name. head: an optional node put between the button row and the text box (a title).
// lead: an optional node put above the button row (the note edit's 제목 칸). It is moved in at mount and put back where it was on destroy.
// NOTE-제목서식줄고정(S61-16 ②): lead · button row · head are one band (.ed-stick) that stays at the top while the text scrolls
// (ed-doc.css: under the PC top line on a page, at the top of the window's own scroll in the big window).
// Returns {getValue(), getText(), isEmpty(), focus(), destroy(), view, root}.
// getText() is the letters for raw_text (ed-text.mjs toPlain): the opener saves structure and letters together (설계 3.1).
// onFiles: null, or (files) => void — the opener's own attachment row, used when photos/files are not given (UPD-그림붙여넣기).
// photos: null, or {add(file) -> {src}, url(src) -> address|null, max, note?, scan?} (share pages, ED-②; notes; the diary S67-20). scan: true adds
//   [문서 스캔] (notes, S69-98). note: the words
//   said after photos went in (default: share pages' '저장해야 받는 사람에게 보여요.' where there is no files option).
// files: null, or {add(file) -> {src, name, size}, open(src)} (S48-21 [파일]; notes).
// onBox(open): ED③-창 — told (once per change, after the current event) when a small box (a button row panel, the 글자색·표 크기 list, the table cell menu)
// opens or the last one closes, so a window can give the phone's back button to the box first. closeBoxes() closes them all and returns true when one was open.
// shortcuts: ED③ 노트 (2026-10-24 명진 결정 2) — true turns on the engine's own markdown shortcuts (prosemirror-inputrules) at the start of a
// line: "## " "### " → 제목 2·3, "- " "* " → 목록, "1. " → 번호 목록, "> " → 인용, and **글자** → 굵게. One undo (Backspace right after, or ↶)
// puts the typed marks back. The engine does not run a rule while a 한글 composition is going on (it waits for the composed text). Off
// by default: the share page editor stays as before (결정 2 가 there: no format while typing).
// noteLinks: S69-98 NOTE-에버노트 ⑧ — null, or {notes(), self(), hidden(note), titleOf(note), base()} (notes): typing '[[' lists notes to link.
// lineWidth: NOTE-글폭(S61-21) — true keeps the text lines about 40 letters wide (tables and photos may go wider) with a thin handle at the
// lines' right end to drag the width (line-width.js; one width for notes, the diary and the big windows, kept on the server). Off by default
// (the share page editor stays as before).
// blocks: NOTE-노션편집 ①(나) — null, or {on, onToggle(on)}: the block handle ⋮⋮ (drag to move, press for the block menu) and a [블록] switch on the
//   row. on = start with it on; onToggle is told when the switch is pressed (the opener keeps the choice on the server). Off = the plain text.
// slash: '/' on an empty line opens the list of blocks to put in (default: where shortcuts are on — notes and their big window).
// forms: S71-65 — null, or {pick(anchor)}: [넣기 ▾] › [서식] calls pick with the [넣기 ▾] button (the opener puts the chosen form in).
// READ-수정한창(2026-11-28 사용자 "문단별로 창을 구분하지 말고 걍 원문 전체를 노트처럼"): two options for an opener whose saved form holds
// letters only (읽을 거리 원문: 문단·소제목·인용·사진 블록, now-detail.js):
// pictures: null, or {url(src) -> Promise<address|null>} — photos already in the text are shown (read-only: no [사진] button, nothing new put in;
//   a photo can still be chosen and removed). Ignored where photos is given (photos.url is used).
// tools: false leaves the button row out (the letters are the whole edit; the notes it shows go above the text box). Default true.
export async function createDocEditor({host, value = null, onChange = null, label = '본문', placeholder = '', head = null, lead = null, photos = null, files = null, onFiles = null, onBox = null, shortcuts = false, lineWidth = false, blocks = null, slash = shortcuts, noteLinks = null, tasks = null, forms = null, pictures = null, tools: showTools = true} = {}) {
  const pm = await loadEditorLib();
  const schema = buildSchema(pm);
  const N = schema.nodes, M = schema.marks;
  const start = cleanDoc(value) || emptyDoc();
  let doc;
  try { doc = pm.Node.fromJSON(schema, start.doc); doc.check(); } catch { doc = pm.Node.fromJSON(schema, emptyDoc().doc); }

  // ── button row and its panels ──
  const root = document.createElement('div');
  root.className = 'ed-editor';
  const bar = document.createElement('div'), tools = document.createElement('div');
  bar.className = 'ed-bar';
  tools.className = 'ed-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', '서식');
  const buttons = {};
  const OPENS = {style: 'style', color: 'color', highlight: 'highlight', align: 'align', bullet: 'bullet', ordered: 'ordered', table: 'grid', link: 'link',
    symDot: 'symDot', symNote: 'symNote', symArrow: 'symArrow', symCircled: 'symCircled', symBracket: 'symBracket',
    gText: 'gText', gPara: 'gPara', gInsert: 'gInsert', gSym: 'gSym'};
  let lastGroup = null;
  for (const [key, text, aria, group] of BUTTONS) {
    if (key === 'photo' && !photos) continue;
    if (key === 'scan' && !photos?.scan) continue;
    // NOTE-파일그림넣기 ④: where the opener has its own attachment row (onFiles: the update windows), [파일] puts the chosen files in that row.
    if (key === 'file' && !files && !onFiles) continue;
    if (key === 'blocks' && !blocks) continue;
    if (key === 'gtask' && !tasks) continue;
    const b = btn(text, {edCmd: key, edGroup: group}, aria);
    if (lastGroup && group !== lastGroup) b.classList.add('ed-gap');
    lastGroup = group;
    if (OPENS[key]) { b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); }
    if (key === 'style') b.classList.add('ed-style');
    if (ICON_PATHS[key]) {
      const word = document.createElement('span'); word.className = 'ed-tool-word'; word.textContent = text;
      b.replaceChildren(toolIcon(key), word); b.classList.add('ed-icon-btn'); b.title = aria;
    }
    if (group === 'mark' || group === 'list' || group === 'blocks') b.setAttribute('aria-pressed', 'false');
    if (key === 'blocks') { const word = document.createElement('span'); word.className = 'ed-tool-word'; word.textContent = text; b.replaceChildren(gripIcon(), word); b.classList.add('ed-icon-btn', 'ed-blocks-btn'); }
    buttons[key] = b; tools.append(b);
  }
  // ED-서식줄묶음: the phone's group buttons. They sit outside the row until a phone needs them.
  for (const [key, text, aria] of GROUPS) {
    const b = btn(text, {edCmd: key, edGroup: 'phone'}, aria);
    b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
    buttons[key] = b;
  }
  const panels = {};
  for (const [key, text, aria] of MORE) {
    if (key === 'form' && !forms) continue;
    const b = btn(text, {edCmd: key}, aria);
    if (OPENS[key]) { b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); }
    if (key === 'strike' || key === 'quote') b.setAttribute('aria-pressed', 'false');
    if (key === 'plainPaste') { b.title = PLAIN_PASTE_HINT; b.setAttribute('aria-description', PLAIN_PASTE_HINT); }
    buttons[key] = b;
  }
  // Tooltips: the button's name, and its shortcut when it has one.
  for (const [key, b] of Object.entries(buttons)) {
    const name = (b.getAttribute('aria-label') || b.dataset.edLabel || '').replace(/ ?▾$/, '');
    if (SHORTCUTS[key]) b.title = `${name} (${keyText(SHORTCUTS[key])})`;
    else if (!b.title && b.getAttribute('aria-label')) b.title = name;
  }
  // Popovers (ed-pop): a vertical list with a ✓ on the current choice (글 단계·정렬·목록·번호), or a small block of swatches
  // and signs (글자색·형광펜·기호·표 격자). Each opens right under the button that was pressed.
  // The group popovers hold the grouped buttons as a vertical list (filled by layoutTools).
  for (const [key, , aria] of GROUPS) { panels[key] = panel('ed-group-menu', aria.replace(/ (?:고르기|선택)$/, ''), true); panels[key].dataset.edPanel = key; }
  panels.style = panel('ed-style-menu', '글 단계', true);
  for (const [v, text] of TEXT_STYLES) { const b = btn(text, {edStyle: v}); b.append(checkMark()); panels.style.append(b); }
  panels.color = panel('ed-color-menu', '글자색', true);
  { const b = btn('색 없음', {edColor: ''}); b.append(checkMark()); panels.color.append(b); }
  for (const [v, text] of TEXT_COLORS) { const b = btn('', {edColor: v}, `글자색 ${text}`); b.append(Object.assign(document.createElement('span'), {className: `ed-c ed-c-${v}`, textContent: '가'}), ` ${text}`, checkMark()); panels.color.append(b); }
  panels.highlight = panel('ed-highlight-menu', '형광펜', true);
  { const b = btn('형광펜 없음', {edHighlight: ''}); b.append(checkMark()); panels.highlight.append(b); }
  for (const [v, text] of HIGHLIGHTS) { const b = btn('', {edHighlight: v}, `형광펜 ${text}`); b.append(Object.assign(document.createElement('mark'), {className: `ed-hl ed-hl-${v}`, textContent: text}), checkMark()); panels.highlight.append(b); }
  panels.align = panel('ed-align-menu', '정렬', true);
  for (const [v, text] of ALIGNS) { const b = btn('', {edAlign: v}, `${text} 정렬`); b.append(alignIcon(v), Object.assign(document.createElement('span'), {className: 'ed-opt-text', textContent: text}), checkMark()); panels.align.append(b); }
  // 목록 ▾ / 번호 ▾: each choice shows two lines of what it will look like; [목록 풀기] takes the item out of the list.
  for (const kind of ['bullet', 'ordered']) {
    panels[kind] = panel(`ed-list-menu ed-${kind}-menu`, kind === 'bullet' ? '글머리 목록' : '번호 목록', true);
    for (const marker of kind === 'bullet' ? BULLET_MARKERS : ORDER_MARKERS) {
      const sign = n => kind === 'bullet' ? bulletGlyph(marker, 0) : orderedLabel(marker, 0, n);
      const b = btn('', {edListKind: kind, edListMarker: marker}, `${kind === 'bullet' ? '글머리' : '번호'} ${sign(1)}`);
      const prev = document.createElement('span'); prev.className = 'ed-list-prev';
      for (const n of [1, 2]) { const line = document.createElement('span'); line.textContent = `${sign(n)} 항목`; prev.append(line); }
      b.append(prev, checkMark());
      panels[kind].append(b);
    }
    const off = btn('목록 풀기', {edListOff: kind}); off.classList.add('ed-list-off');
    panels[kind].append(off);
  }
  for (const key of ['symDot', 'symNote', 'symArrow', 'symBracket']) {
    panels[key] = panel('ed-sym-menu', buttons[key].getAttribute('aria-label').replace(/ (?:고르기|선택)$/, ''), true);
    for (const sign of SYMBOLS[key]) panels[key].append(btn(sign, {edSym: sign}, `${sign} 넣기`));
  }
  panels.symCircled = panel('ed-sym-menu', '동그라미 번호', true);
  for (const sign of CIRCLED_PICK) panels.symCircled.append(btn(sign, {edSym: sign}, `${sign} 넣기`));
  // [표]: a grid of rows × columns; the picked size shows beside it.
  panels.grid = panel('ed-grid-menu', '표 크기 선택', true);
  const grid = document.createElement('div'); grid.className = 'ed-grid';
  grid.style.setProperty('--ed-grid-cols', String(GRID.cols));
  for (let r = 1; r <= GRID.rows; r++) for (let c = 1; c <= GRID.cols; c++) grid.append(btn('', {edGridR: String(r), edGridC: String(c)}, `${r}줄 ${c}칸 표`));
  const gridSize = document.createElement('span'); gridSize.className = 'ed-grid-size'; gridSize.textContent = '2 × 2';
  panels.grid.append(grid, gridSize);
  // [링크]: one address box.
  // Its address box is put in only while the row is open (no hidden input sits in the page otherwise).
  panels.link = panel('ed-link-menu', '링크', true);
  const linkInput = Object.assign(document.createElement('input'), {type: 'url', className: 'ed-link-input', placeholder: 'https://…', autocomplete: 'off'});
  linkInput.setAttribute('aria-label', '링크 주소'); linkInput.spellcheck = false;
  const linkOk = btn('넣기', {edLinkOk: ''}, '링크 넣기 확인'), linkOff = btn('링크 빼기', {edLinkOff: ''});
  const tableRow = panel('ed-table-tools', '표 수정');
  for (const [key, text, aria] of TABLE_TOOLS) tableRow.append(btn(text, {edTable: key}, aria));
  // S48-21 사진 나란히: shown while one photo is chosen (like the table tools row).
  const photoTools = panel('ed-photo-tools', '사진 놓기');
  const photoJoin = btn('옆 사진과 나란히', {edPhoto: 'join'}), photoApart = btn('따로 놓기', {edPhoto: 'apart'});
  photoTools.append(photoJoin, photoApart);
  const suggest = document.createElement('div');
  suggest.className = 'ed-suggest'; suggest.hidden = true; suggest.setAttribute('role', 'status');
  const suggestText = document.createElement('span'); suggestText.textContent = '마크다운 기호가 보여요.';
  const convert = btn('서식으로 바꾸기', {edConvert: ''}), dismiss = btn('×', {edDismiss: ''}, '그대로 두기');
  suggest.append(suggestText, convert, dismiss);
  const note = document.createElement('div');
  note.className = 'ed-note'; note.hidden = true; note.setAttribute('role', 'status');
  // UI-올리기진행표시: 글 안에 넣는 사진·파일의 올리는 줄(그 파일이 올라가는 동안만 보임, 글 칸 바로 위). 사진은 흐린 미리보기 위 막대 + %.
  const uploads = document.createElement('div');
  uploads.className = 'ed-uploads'; uploads.hidden = true;
  const upFiles = new Set(), upGoing = new Set(), upPreview = new Map();
  const upRows = mountUploadRows(uploads, {has: job => upFiles.has(job.file), preview: job => upPreview.get(job.file) || null});
  const forgetUploads = () => {
    for (const file of [...upFiles]) {
      if (upGoing.has(file) || isUploading(file)) continue;
      upFiles.delete(file);
      const url = upPreview.get(file); if (url) { URL.revokeObjectURL(url); upPreview.delete(file); }
    }
  };
  const stopUploads = watchUploads(forgetUploads);
  const uploadStarts = (file, picture) => {
    upFiles.add(file); upGoing.add(file);
    if (picture && !upPreview.has(file)) { try { upPreview.set(file, URL.createObjectURL(file)); } catch { /* 미리보기 없이 줄만 */ } }
  };
  const uploadEnds = file => { upGoing.delete(file); forgetUploads(); };
  const status = document.createElement('p');
  status.className = 'ed-status a11y-only'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const PANEL_ORDER = [...GROUP_KEYS, 'style', 'color', 'highlight', 'align', 'bullet', 'ordered', 'symDot', 'symNote', 'symArrow', 'symCircled', 'symBracket', 'grid', 'link'];
  // The full-width rows (table tools, offers, notes) sit in the flow; popovers are placed on the screen.
  bar.append(tools, tableRow, photoTools, suggest, note, ...PANEL_ORDER.map(k => panels[k]));
  const box = document.createElement('div');
  box.className = 'ed-box';
  // The table cell menu (right click, a phone's long press): a small floating list, closed by Esc or a press outside.
  const ctx = document.createElement('div');
  ctx.className = 'ed-ctx'; ctx.hidden = true; ctx.setAttribute('role', 'menu'); ctx.setAttribute('aria-label', '표 칸 메뉴');
  for (const [key, text, aria] of TABLE_TOOLS) { const b = btn(text, {edTable: key}, aria); b.setAttribute('role', 'menuitem'); ctx.append(b); }
  // ED-폰표칸버튼: one small row "열 너비 · [넓게][좁게][고르게]" (a phone cannot drag a column edge).
  const colRow = document.createElement('div'); colRow.className = 'ed-ctx-cols'; colRow.setAttribute('role', 'group'); colRow.setAttribute('aria-label', '열 너비');
  const colLabel = document.createElement('span'); colLabel.textContent = '열 너비 ·'; colRow.append(colLabel);
  for (const [key, text, aria] of [['wider', '넓게', '열 넓게'], ['narrower', '좁게', '열 좁게'], ['even', '고르게', '열 너비 고르게']]) {
    const b = btn(text, {edColw: key}, aria); b.setAttribute('role', 'menuitem'); colRow.append(b);
  }
  ctx.append(colRow);
  const measure = document.createElement('div');
  measure.className = 'ed-doc ed-measure'; measure.setAttribute('aria-hidden', 'true');
  const band = document.createElement('div'); band.className = 'ed-stick';
  const leadAt = lead ? {parent: lead.parentNode, next: lead.nextSibling} : null;
  // Moving a node takes the focus off it: the 제목 칸 the opener focused keeps it (with its cursor).
  const leadFocus = lead && lead.contains(document.activeElement) ? document.activeElement : null;
  const leadSel = leadFocus && 'selectionStart' in leadFocus ? [leadFocus.selectionStart, leadFocus.selectionEnd] : null;
  band.append(...(lead ? [lead] : []), ...(showTools ? [bar] : []), ...(head ? [head] : []));
  if (!showTools) bar.removeChild(note);
  root.append(band, ...(showTools ? [] : [note]), uploads, box, status, ctx, measure);
  host.append(root);
  if (leadFocus?.isConnected) { leadFocus.focus({preventScroll: true}); if (leadSel) try { leadFocus.setSelectionRange(...leadSel); } catch {} }

  // ── plugins ──
  // The pasted part of a plain-letter paste, kept (mapped through later steps) until it is converted or dismissed.
  const pasteKey = new pm.PluginKey('edPaste');
  // Inside a code block letters stay letters (no markdown paste there).
  const inCode = st => !!st.selection.$from.parent.type.spec.code;
  const pastePlugin = new pm.Plugin({
    key: pasteKey,
    state: {
      init: () => null,
      apply(tr, prev) {
        const meta = tr.getMeta(pasteKey);
        if (meta !== undefined) return meta;
        if (!prev) return null;
        // Typing elsewhere keeps the offer; typing inside the pasted part ends it (it is no longer only the paste).
        const from = tr.mapping.map(prev.from, 1), to = tr.mapping.map(prev.to, -1);
        if (to <= from) return null;
        let touched = false;
        tr.mapping.maps.forEach(map => map.forEach((s, e) => { if (s < prev.to && e > prev.from) touched = true; }));
        return touched && !tr.getMeta('paste') ? null : {...prev, from, to};
      },
    },
  });
  // The text always ends with a line one can type on (after a table, rule, photo, list or quote at the end).
  const endsOpen = d => { const last = d.lastChild; return !!last && (last.type === N.paragraph || last.type === N.heading); };
  const endLinePlugin = new pm.Plugin({
    appendTransaction(trs, old, st) {
      if (!trs.some(tr => tr.docChanged) || endsOpen(st.doc)) return null;
      return st.tr.insert(st.doc.content.size, N.paragraph.create({style: DEFAULT_BODY}));
    },
  });
  // S48-21: a photo row holds 2..PHOTO_ROW_MAX photos. One left (the others were taken out or deleted) is that photo again; an empty one goes.
  const rowsPlugin = new pm.Plugin({
    appendTransaction(trs, old, st) {
      if (!trs.some(tr => tr.docChanged)) return null;
      const bad = [];
      st.doc.descendants((node, pos) => { if (node.type === N.photo_row) { if (node.childCount < 2 || node.childCount > PHOTO_ROW_MAX) bad.push({node, pos}); return false; } return true; });
      if (!bad.length) return null;
      const tr = st.tr;
      for (const {node, pos} of bad.reverse()) {
        const pics = []; node.forEach(p => pics.push(p));
        const parts = [];
        for (let i = 0; i < pics.length; i += PHOTO_ROW_MAX) { const part = pics.slice(i, i + PHOTO_ROW_MAX); parts.push(part.length === 1 ? part[0] : N.photo_row.create(null, part)); }
        tr.replaceWith(pos, pos + node.nodeSize, parts);
      }
      return tr;
    },
  });
  // Column widths: before a column edge drag starts, every column gets its shown width (so nothing jumps), and when it
  // ends, a table wider than the text is scaled down to fit (the saved widths are what every reader shows, as shares).
  const textWidth = () => {
    const cs = getComputedStyle(view.dom);
    return Math.max(120, view.dom.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  };
  // The table around pos (or right after it) in a state or a document.
  const tableAt = (stOrDoc, pos) => {
    const d0 = stOrDoc.doc || stOrDoc, $p = d0.resolve(pos);
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type === N.table) return {node: $p.node(d), pos: $p.before(d), start: $p.start(d)};
    const after = d0.nodeAt(pos);
    return after && after.type === N.table ? {node: after, pos, start: pos + 1} : null;
  };
  function shownWidths(t) {
    const dom = view.nodeDOM(t.pos);
    const tableEl = dom && (dom.tagName === 'TABLE' ? dom : dom.querySelector?.('table'));
    const row = tableEl?.querySelector('tr');
    const out = [];
    if (!row) return out;
    for (const cell of row.children) { const span = +cell.getAttribute('colspan') || 1; for (let i = 0; i < span; i++) out.push(Math.round(cell.getBoundingClientRect().width / span)); }
    return out;
  }
  // Sets the columns' widths (px, one per column) on every cell of the table at t.
  function setWidths(tr, t, widths) {
    const map = pm.TableMap.get(t.node), seen = new Set();
    for (let i = 0; i < map.map.length; i++) {
      const pos = map.map[i];
      if (seen.has(pos)) continue;
      seen.add(pos);
      const cell = t.node.nodeAt(pos), rect = map.findCell(pos);
      const colwidth = [];
      for (let c = rect.left; c < rect.right; c++) colwidth.push(Math.max(0, Math.min(LIMITS.colWidth, Math.round(widths[c] || 0))));
      if (JSON.stringify(cell.attrs.colwidth) !== JSON.stringify(colwidth)) tr.setNodeMarkup(t.start + pos, null, {...cell.attrs, colwidth});
    }
    return tr;
  }
  const widthsOf = t => { const first = t.node.firstChild; const cells = []; first.forEach(c => cells.push(c.attrs)); return widthsOfRow(cells); };
  function freezeColumns(t) {
    const widths = widthsOf(t);
    if (widths.length && widths.every(w => w > 0)) return false;
    const shown = shownWidths(t);
    if (shown.length !== widths.length) return false;
    view.dispatch(setWidths(view.state.tr, t, widths.map((w, i) => w || shown[i])).setMeta('addToHistory', false));
    return true;
  }
  function fitToText(tr, t) {
    const widths = widthsOf(t), total = widths.reduce((a, b) => a + b, 0), room = textWidth();
    if (!total || total <= room) return tr;
    return setWidths(tr, t, widths.map(w => Math.max(24, Math.floor(w * room / total))));
  }
  // Double click on a column edge: that column as wide as its longest line (others keep their width).
  function fitColumn(handlePos) {
    const t = tableAt(view.state, handlePos);
    if (!t) return;
    freezeColumns(t);
    const tt = tableAt(view.state, handlePos), map = pm.TableMap.get(tt.node);
    const col = map.colCount(handlePos - tt.start) + tt.node.nodeAt(handlePos - tt.start).attrs.colspan - 1;
    let widest = 0;
    for (let r = 0; r < map.height; r++) {
      const pos = map.map[r * map.width + col], dom = view.nodeDOM(tt.start + pos);
      if (!dom) continue;
      measure.textContent = '';
      for (const child of dom.childNodes) measure.append(child.cloneNode(true));
      widest = Math.max(widest, measure.getBoundingClientRect().width);
    }
    measure.textContent = '';
    const widths = widthsOf(tt);
    widths[col] = Math.max(40, Math.ceil(widest) + 24);
    const tr = setWidths(view.state.tr, tt, widths);
    view.dispatch(fitToText(tr, tableAt(tr.doc, tt.pos + 1) || tt));
  }
  const resizePlugin = new pm.Plugin({
    props: {
      handleDOMEvents: {
        mousedown(v, event) {
          const rs = pm.columnResizingPluginKey.getState(v.state);
          if (!rs || rs.activeHandle < 0 || rs.dragging || event.button !== 0 || event.detail > 1) return false;
          const t = tableAt(v.state, rs.activeHandle);
          if (t) freezeColumns(t);
          return false;
        },
        dblclick(v, event) {
          const rs = pm.columnResizingPluginKey.getState(v.state);
          if (!rs || rs.activeHandle < 0) return false;
          event.preventDefault();
          fitColumn(rs.activeHandle);
          return true;
        },
      },
    },
    appendTransaction(trs, old, st) {
      const ended = trs.some(tr => { const m = tr.getMeta(pm.columnResizingPluginKey); return m && 'setDragging' in m && m.setDragging === null; });
      if (!ended) return null;
      const was = pm.columnResizingPluginKey.getState(old);
      const t = was && was.activeHandle > -1 ? tableAt(st, Math.min(was.activeHandle, st.doc.content.size)) : null;
      if (!t) return null;
      const tr = fitToText(st.tr, t);
      return tr.docChanged ? tr : null;
    },
  });
  // ED-표크기끌기: a small handle at the table's bottom right corner. Dragging it with the mouse scales every column by the
  // same factor (shares stay; the table is as wide as the columns' sum, never wider than the text, never under MIN_COL per
  // column), the border follows while dragging, and letting go saves the new colwidths (one undo step). The saved size is
  // the cells' colwidth, which every reader already draws, so nothing else changes. Fingers do not drag it (see the report).
  const MIN_COL = 32;
  function paintWidths(tv, widths) {
    const lay = tableLayout(widths);
    [...tv.colgroup.children].forEach((col, i) => { col.style.width = lay ? lay.cols[i] : ''; });
    tv.table.style.width = lay ? `${lay.width}px` : '';
  }
  function startTableResize(tv, event) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    let t = tableAt(view.state, view.posAtDOM(tv.contentDOM, 0));
    if (!t) return;
    freezeColumns(t);
    t = tableAt(view.state, view.posAtDOM(tv.contentDOM, 0));
    const start = widthsOf(t), startTotal = start.reduce((a, b) => a + b, 0), startX = event.clientX;
    if (!start.length || !startTotal) return;
    const room = Math.max(textWidth(), startTotal);
    let latest = {widths: start, total: startTotal};
    tv.dom.classList.add('is-resizing');
    tv.resizer.setPointerCapture?.(event.pointerId);
    const move = e => {
      latest = scaleWidths(start, startTotal + (e.clientX - startX), {min: MIN_COL, max: room});
      paintWidths(tv, latest.widths);
    };
    const finish = save => {
      tv.resizer.removeEventListener('pointermove', move);
      tv.resizer.removeEventListener('pointerup', up);
      tv.resizer.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc, true);
      tv.dom.classList.remove('is-resizing');
      try { tv.resizer.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
      const now = tableAt(view.state, view.posAtDOM(tv.contentDOM, 0));
      if (save && now && latest.widths.join() !== start.join()) { view.dispatch(setWidths(view.state.tr, now, latest.widths)); say('표 크기를 바꿨어요.'); }
      else tv.layout();
    };
    const up = () => finish(true), cancel = () => finish(false);
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
    tv.resizer.addEventListener('pointermove', move);
    tv.resizer.addEventListener('pointerup', up);
    tv.resizer.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', esc, true);
  }

  // The table as drawn in the editor: the same layout readers use (ed-render.mjs, ed-schema.mjs tableLayout), plus a small
  // grip at its top left corner that selects the whole table and a handle at its bottom right corner that resizes it.
  const touchPhone = phoneTouchMedia(), tableViews = new Set();
  const syncTableGrips = () => { for (const t of tableViews) t.syncGrip(); };
  touchPhone?.addEventListener?.('change', syncTableGrips);
  class TableView {
    constructor(node) {
      this.node = node;
      this.dom = document.createElement('div'); this.dom.className = 'tableWrapper ed-table-wrap';
      this.grip = document.createElement('span'); this.grip.className = 'ed-table-grip'; this.grip.contentEditable = 'false';
      this.grip.setAttribute('aria-hidden', 'true'); this.grip.title = '표 전체 선택';
      this.box = document.createElement('div'); this.box.className = 'ed-table-box';
      this.resizer = document.createElement('span'); this.resizer.className = 'ed-table-resize'; this.resizer.contentEditable = 'false';
      this.resizer.setAttribute('aria-hidden', 'true');
      this.resizer.addEventListener('pointerdown', e => startTableResize(this, e));
      this.table = document.createElement('table'); this.table.className = 'ed-table';
      this.colgroup = this.table.appendChild(document.createElement('colgroup'));
      this.contentDOM = this.table.appendChild(document.createElement('tbody'));
      this.box.append(this.table, this.resizer);
      this.dom.append(this.box);
      tableViews.add(this); this.syncGrip();
      this.layout();
    }
    // NOTE-블록꾹눌러잡기(S71-66 ④): a phone (finger, ≤760px) has no corner grip — too small for a finger. There a table is chosen with
    // [표 선택] in the table row, and held by its outer edge for its block menu (notes). Not a hidden grip: it is not in the table at all.
    syncGrip() {
      if (touchPhone?.matches) this.grip.remove();
      else if (!this.grip.isConnected) this.dom.prepend(this.grip);
    }
    destroy() { tableViews.delete(this); }
    layout() {
      const cells = []; this.node.firstChild?.forEach(c => cells.push(c.attrs));
      const widths = widthsOfRow(cells), lay = tableLayout(widths);
      while (this.colgroup.childElementCount > widths.length) this.colgroup.lastChild.remove();
      while (this.colgroup.childElementCount < widths.length) this.colgroup.append(document.createElement('col'));
      [...this.colgroup.children].forEach((col, i) => { col.style.width = lay ? lay.cols[i] : ''; });
      this.table.classList.toggle('ed-fixed', !!lay);
      this.table.style.minWidth = '';
      this.table.style.width = lay ? `${lay.width}px` : '';
    }
    update(node) { if (node.type !== this.node.type) return false; this.node = node; this.layout(); return true; }
    ignoreMutation(record) { return (record.type === 'childList' && record.target === this.dom) || record.type === 'attributes' && (record.target === this.dom || record.target === this.box || record.target === this.table || this.colgroup.contains(record.target) || this.resizer.contains(record.target)) || this.grip.contains(record.target) || this.resizer.contains(record.target); }
    stopEvent(event) { return this.grip.contains(event.target) || this.resizer.contains(event.target); }
  }

  // ── keys ──
  const paragraphAttrs = node => node.type === N.paragraph ? {type: N.paragraph, attrs: {style: node.attrs.style, align: node.attrs.align, indent: node.attrs.indent}} : null;
  const enter = pm.chainCommands(pm.splitListItem(N.list_item), pm.newlineInCode, pm.createParagraphNear, pm.liftEmptyBlock,
    pm.splitBlockAs((node, atEnd) => (atEnd && node.type === N.heading) ? {type: N.paragraph, attrs: {style: DEFAULT_BODY, align: node.attrs.align, indent: node.attrs.indent}} : paragraphAttrs(node)));
  const hardBreak = pm.chainCommands(pm.exitCode, (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView()); return true; });
  // Tab in a table: the next cell; in the last cell a new row first.
  const nextCellOrRow = (state, dispatch) => {
    if (!pm.isInTable(state)) return false;
    if (pm.goToNextCell(1)(state, dispatch)) return true;
    if (!dispatch) return true;
    pm.addRowAfter(state, tr => {
      const next = state.apply(tr);
      const rect = pm.selectedRect(next), cellPos = rect.tableStart + rect.map.map[(rect.bottom) * rect.map.width];
      tr.setSelection(pm.TextSelection.near(tr.doc.resolve(cellPos + 1))).scrollIntoView();
      dispatch(tr);
    });
    return true;
  };
  const indentBy = step => (state, dispatch) => {
    const blocks = textblocksInSelection(state).filter(b => b.node.type === N.paragraph || b.node.type === N.heading);
    if (!blocks.length) return false;
    const tr = state.tr;
    for (const {node, pos} of blocks) tr.setNodeAttribute(pos, 'indent', Math.max(0, Math.min(LIMITS.indent, (node.attrs.indent || 0) + step)));
    if (dispatch && tr.docChanged) dispatch(tr);
    return true;
  };
  // A whole table chosen (all of its cells, or the table node): Backspace/Delete removes it.
  const wholeTable = st => {
    const sel = st.selection;
    if (sel instanceof pm.NodeSelection && sel.node.type === N.table) return true;
    return sel instanceof pm.CellSelection && sel.isRowSelection() && sel.isColSelection();
  };
  const removeWholeTable = (state, dispatch) => wholeTable(state) ? pm.deleteTable(state, dispatch) : false;
  // On the line just after (Backspace) or before (Delete) a table, rule or photo: choose that block first, so a press never
  // removes a table without showing it.
  const chooseNeighbour = dir => (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof pm.TextSelection) || !sel.empty) return false;
    const $c = sel.$cursor, parent = $c.parent;
    if (!parent.isTextblock || (dir < 0 ? $c.parentOffset !== 0 : $c.parentOffset !== parent.content.size)) return false;
    const $edge = state.doc.resolve(dir < 0 ? $c.before() : $c.after());
    const other = dir < 0 ? $edge.nodeBefore : $edge.nodeAfter;
    if (!other || !(other.type === N.table || other.type === N.image || other.type === N.photo_row || other.type === N.file || other.type === N.horizontal_rule)) return false;
    if (!dispatch) return true;
    // An empty line between a block and the end goes first only when it is not the last line (the end line always stays).
    const at = dir < 0 ? $edge.pos - other.nodeSize : $edge.pos;
    if (other.type === N.table) {
      const map = pm.TableMap.get(other);
      dispatch(state.tr.setSelection(pm.CellSelection.create(state.doc, at + 1 + map.map[0], at + 1 + map.map[map.map.length - 1])).scrollIntoView());
    } else dispatch(state.tr.setSelection(pm.NodeSelection.create(state.doc, at)).scrollIntoView());
    say(other.type === N.table ? '표를 선택했어요. 한 번 더 누르면 삭제해요.' : '선택했어요. 한 번 더 누르면 삭제해요.');
    return true;
  };
  // ↑ in a table's first row / ↓ in its last row: out of the table. When no line is there (the table starts the text, or
  // sits next to another table, rule or photo) the cursor becomes a gap cursor there, and typing makes a line.
  const leaveTable = dir => (state, dispatch, v) => {
    const sel = state.selection;
    if (!(sel instanceof pm.TextSelection) || !sel.empty || !pm.isInTable(state)) return false;
    if (v && !v.endOfTextblock(dir < 0 ? 'up' : 'down')) return false;
    const $c = sel.$from;
    let depth = -1;
    for (let d = $c.depth; d > 0; d--) if ($c.node(d).type === N.table) { depth = d; break; }
    if (depth < 0) return false;
    const table = $c.node(depth), map = pm.TableMap.get(table), start = $c.start(depth);
    const cellPos = $c.before(depth + 2) - start, rect = map.findCell(cellPos);
    if (dir < 0 ? rect.top !== 0 : rect.bottom !== map.height) return false;
    const edge = dir < 0 ? $c.before(depth) : $c.after(depth), $edge = state.doc.resolve(edge);
    const other = dir < 0 ? $edge.nodeBefore : $edge.nodeAfter;
    if (other && other.isTextblock) {
      dispatch?.(state.tr.setSelection(pm.TextSelection.create(state.doc, dir < 0 ? edge - 1 : edge + 1)).scrollIntoView());
      return true;
    }
    if (!pm.GapCursor.valid($edge)) return false;
    dispatch?.(state.tr.setSelection(new pm.GapCursor($edge)).scrollIntoView());
    return true;
  };
  const keys = {
    ArrowUp: leaveTable(-1), ArrowDown: leaveTable(1),
    Enter: enter, 'Shift-Enter': hardBreak, 'Mod-Enter': () => false,
    'Mod-z': pm.undo, 'Mod-y': pm.redo, 'Shift-Mod-z': pm.redo,
    'Mod-b': pm.toggleMark(M.strong), 'Mod-i': pm.toggleMark(M.em), 'Mod-u': pm.toggleMark(M.underline),
    'Mod-k': () => { openPanel('link'); return true; },
    Escape: () => { if (!openName) return false; closePanels(); return true; },
    'Mod-\\': (st, d) => clearFormat(st, d),
    Tab: pm.chainCommands(nextCellOrRow, pm.sinkListItem(N.list_item), indentBy(1)),
    'Shift-Tab': pm.chainCommands(pm.goToNextCell(-1), pm.liftListItem(N.list_item), indentBy(-1)),
    Backspace: pm.chainCommands(removeWholeTable, chooseNeighbour(-1)),
    Delete: pm.chainCommands(removeWholeTable, chooseNeighbour(1)),
    'Mod-Backspace': removeWholeTable,
  };
  // ED③ 노트 shortcuts (only with shortcuts: true). Headings and lists stay what the buttons make (body style, automatic markers).
  // A list or quote is not started inside a table cell, a list item or a code block (only a plain top-level line).
  const topLine = $s => $s.depth === 1 && $s.parent.type === N.paragraph;
  const onlyTop = rule => { const handler = rule.handler; rule.handler = (st, match, from, to) => topLine(st.doc.resolve(from)) ? handler(st, match, from, to) : null; return rule; };
  const shortcutRules = shortcuts ? [
    onlyTop(pm.textblockTypeInputRule(/^(#{2,3})\s$/, N.heading, m => ({level: m[1].length}))),
    onlyTop(pm.wrappingInputRule(/^\s*([-*])\s$/, N.bullet_list)),
    onlyTop(pm.wrappingInputRule(/^(1)\.\s$/, N.ordered_list, m => ({order: +m[1]}), (m, node) => node.childCount + node.attrs.order === +m[1])),
    onlyTop(pm.wrappingInputRule(/^\s*>\s$/, N.blockquote)),
    new pm.InputRule(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, (st, match, from, to) => {
      const text = match[1], tr = st.tr;
      tr.replaceWith(from, to, st.schema.text(text, [...st.doc.resolve(from).marks(), M.strong.create()]));
      return tr.removeStoredMark(M.strong);
    }),
  ] : [];
  // One undo after a shortcut (Backspace right after it, Ctrl+Z or [↶]) gives the typed marks back as letters, "## " included.
  const shortcutKeys = shortcuts ? {Backspace: pm.undoInputRule, 'Mod-z': pm.chainCommands(pm.undoInputRule, pm.undo)} : null;
  // NOTE-노션편집 ①(나): the '/' list and the folded ▸ line take their keys before the editor's own keymap.
  let blockPart = null, gtaskPart = null;
  const blockKeys = new pm.Plugin({props: {handleKeyDown: (v, e) => !!blockPart && blockPart.handleKey(v, e)}});
  // S69-98 NOTE-에버노트 ⑧: the '[[' note list (ed-note-link.js) takes its keys first while it is open.
  let noteLinkPart = null;
  const noteLinkKeys = new pm.Plugin({props: {handleKeyDown: (v, e) => !!noteLinkPart && noteLinkPart.handleKey(v, e)}});
  const plugins = [noteLinkKeys, blockKeys, resizePlugin, pm.columnResizing({handleWidth: 6, cellMinWidth: 32, defaultCellMinWidth: 48, View: TableView}),
    pm.history(), ...(shortcuts ? [pm.inputRules({rules: shortcutRules}), pm.keymap(shortcutKeys)] : []),
    pm.keymap(keys), pm.keymap(pm.baseKeymap), pm.gapCursor(), pm.tableEditing(), pastePlugin, endLinePlugin, rowsPlugin, gtaskDedupe(pm, N)];
  let state = pm.EditorState.create({doc, plugins});
  const fix = pm.fixTables(state);
  if (fix) state = state.apply(fix.setMeta('addToHistory', false));
  if (!endsOpen(state.doc)) state = state.apply(state.tr.insert(state.doc.content.size, N.paragraph.create({style: DEFAULT_BODY})).setMeta('addToHistory', false));

  let pendingPaste = null, pastingLetters = false, pointerHeld = false;
  // NOTE-붙여넣기문단사라짐: the paste being read (set by the paste event, before the reader; cleared by handlePaste).
  let outsidePaste = null;
  // The letters of a paste are only the names of the files that came with it (one per line, a path's last part counts).
  const onlyFileNames = (data, text) => {
    const names = new Set(clipboardFiles(data).map(file => file.name).filter(Boolean));
    const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return names.size > 0 && lines.length > 0 && lines.every(line => names.has(line) || names.has(line.split(/[\\/]/).pop()));
  };
  const isFileTransfer = data => !!data && ([...(data.types || [])].includes('Files') || (data.files && data.files.length > 0));
  // 편집기 만들기 안에는 await(노트 연결 부품 불러오기)가 있어, 그 사이에 브라우저 선택·입력 알림이 오면 dispatchTransaction이 먼저 불린다.
  // 그때 paint는 아직 만들어지지 않은 도구 줄 부품(inNode 등)을 쓰므로, 만들기가 끝나기 전에는 paint를 부르지 않는다(끝에서 한 번 그린다).
  let built = false;
  const view = new pm.EditorView(box, {
    state,
    nodeViews: {image: node => photoView(node), file: node => fileView(node), toggle: (node, v, getPos) => toggleView(node, v, getPos)},
    attributes: {class: 'ed-doc ed-input', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'false',
      ...(placeholder ? {'data-placeholder': placeholder} : {})},
    transformPastedHTML: html => cleanPastedHtml(html, outsidePaste?.text || ''),
    // A whole table copied from this editor (all cells chosen) comes as an open slice that only fits inside a table; outside
    // one it goes in as a table of its own.
    transformPasted(slice, v) {
      // NOTE-붙여넣기문단사라짐: a formatted copy from outside: a blank line (two or more line breaks) splits the paragraph.
      if (outsidePaste?.html) {
        const json = slice.toJSON();
        const at = v.state.selection.$from.parent;
        const split = json && splitBlankLines(json, {style: at.type === N.paragraph ? at.attrs.style : DEFAULT_BODY});
        if (split && split !== json) slice = pm.Slice.fromJSON(schema, split);
      }
      const only = slice.content.childCount === 1 && slice.content.firstChild;
      if (!only || only.type !== N.table || (slice.openStart === 0 && slice.openEnd === 0) || pm.isInTable(v.state)) return slice;
      return new pm.Slice(slice.content, 0, 0);
    },
    // Plain letters: one paragraph per line, blank lines kept, nothing read as format.
    clipboardTextParser(text, $context) {
      const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
      if ($context.parent.type.spec.code) return new pm.Slice(pm.Fragment.from(schema.text(text)), 0, 0);
      const style = $context.parent.type === N.paragraph ? $context.parent.attrs.style : DEFAULT_BODY;
      const nodes = lines.map(line => N.paragraph.create({style}, line ? schema.text(line) : null));
      return new pm.Slice(pm.Fragment.from(nodes), 1, 1);
    },
    handlePaste(v, event) {
      outsidePaste = null;
      const data = event.clipboardData;
      const text = data?.getData('text/plain') || '';
      const html = data?.getData('text/html') || '';
      // A copied picture or file (no letters with it): photos go to [사진], other files to [파일] (where the opener gives them).
      // S52-21 ④: a phone's copy of a photo (gallery, keyboard clipboard) can carry the file's name as its letters (e.g. 20261107_161200.jpg)
      // or only a picture tag: that is still the photo, never the name typed into the text.
      if (isFileTransfer(data) && (!text.trim() || onlyFileNames(data, text))) { void filesFrom(onFiles ? namePasted(clipboardFiles(data)) : data.files); return true; }
      if (pastingLetters) return false;
      // Decide after the paste lands: mark its range when the letters look like markdown and no formatted copy came with them,
      // or the formatted copy only wraps the same letters (signs and all; a phone's copy). Then those letters are pasted.
      const md = !inCode(v.state) && looksLikeMarkdown(text) && (!html || htmlShowsMarkdown(html));
      pendingPaste = md ? {text, before: v.state.selection.from} : null;
      if (md && html) { pasteLetters(v, text, event); return true; }
      return false;
    },
    handleDrop(v, event, slice, moved) {
      // S48-21: a photo of this text dropped on another photo's left or right half goes beside it (one line).
      if (moved) return dropBeside(v, event, slice);
      if (!isFileTransfer(event.dataTransfer)) return false;
      event.preventDefault();
      void filesFrom(event.dataTransfer.files, v.posAtCoords({left: event.clientX, top: event.clientY})?.pos);
      return true;
    },
    handleDOMEvents: {
      // NOTE-붙여넣기문단사라짐: what came with this paste, for the reader that runs before handlePaste (transformPastedHTML, transformPasted).
      paste(v, event) {
        const data = event.clipboardData, html = data?.getData('text/html') || '';
        outsidePaste = html && !/data-pm-slice/.test(html) ? {html, text: data.getData('text/plain') || ''} : null;
        return false;
      },
      // Letters typed at a gap cursor (before or after a table, rule or photo) start a new line there. The gapcursor plugin
      // covers a composition starting there; this covers plain text input (a pasted word, a keyboard without composition).
      beforeinput(v, event) {
        // A keyboard's clipboard row (Samsung keyboard, Gboard) puts copied letters in as typed text: no paste event comes.
        // Several lines at once that look like markdown are that paste (typing, a word picked from the keyboard or dictation
        // is one line; a composition is not this input type). One line of letters stays as typed ("# 새 메모" typed in a note).
        if (event.inputType === 'insertText' || event.inputType === 'insertReplacementText') {
          const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
          if (/\n/.test(text) && !v.composing && !inCode(v.state) && looksLikeMarkdown(text)) {
            event.preventDefault();
            pendingPaste = {text, before: v.state.selection.from};
            pasteLetters(v, text);
            return true;
          }
        }
        if (event.inputType !== 'insertText' || !event.data || !(v.state.selection instanceof pm.GapCursor)) return false;
        event.preventDefault();
        v.dispatch(v.state.tr.insertText(event.data).scrollIntoView());
        return true;
      },
      contextmenu(v, event) {
        const cell = event.target.closest?.('td,th');
        if (!cell || !v.dom.contains(cell)) return false;
        const pos = v.posAtDOM(cell, 0);
        // Right click inside a chosen group of cells keeps the group (to merge them); elsewhere the cursor goes there.
        const sel = v.state.selection;
        const inChosen = sel instanceof pm.CellSelection && pos >= sel.from && pos <= sel.to;
        if (!inChosen) v.dispatch(v.state.tr.setSelection(pm.TextSelection.near(v.state.doc.resolve(pos))));
        event.preventDefault();
        openCtx(event.clientX, event.clientY);
        return true;
      },
    },
    dispatchTransaction(tr) {
      const before = view.state.doc;
      const next = view.state.apply(tr);
      if (pendingPaste && tr.getMeta('paste') && tr.docChanged) {
        const to = tr.selection.to, from = tr.mapping.map(pendingPaste.before, -1);
        view.updateState(next);
        pendingPaste = null;
        if (to > from) {
          view.dispatch(view.state.tr.setMeta(pasteKey, {from, to, auto: true}).setMeta('addToHistory', false));
          void convertPasted();
        }
      } else view.updateState(next);
      if (tr.docChanged) onChange?.(getValue());
      if (tr.docChanged) gtaskPart?.changed(before, tr, view.state.doc);
      if (built) paint();
      blockPart?.update();
      noteLinkPart?.update();
    },
  });
  // NOTE-노션편집 ①(나) 할 일 체크: a press on an item's box (left of its text) ticks or unticks it — on or off 블록 편집, one undo step.
  view.dom.addEventListener('click', e => {
    const li = e.target.closest?.('li');
    if (!li || !view.dom.contains(li) || !li.parentElement?.classList.contains('ed-ul-check')) return;
    const first = li.firstElementChild, r = (first || li).getBoundingClientRect();
    if (e.clientX >= r.left - 2) return;
    let at; try { at = view.posAtDOM(li, 0); } catch { return; }
    const $p = view.state.doc.resolve(at);
    for (let d = $p.depth; d > 0; d--) {
      const node = $p.node(d);
      if (node.type !== N.list_item) continue;
      e.preventDefault();
      view.dispatch(view.state.tr.setNodeMarkup($p.before(d), null, {...node.attrs, checked: !node.attrs.checked}));
      return;
    }
  });
  // NOTE-노션편집 ①(나): the block parts (handle ⋮⋮ and its menu, the '/' list). Made for the openers that ask (notes); none elsewhere.
  if (blocks || slash) {
    blockPart = mountBlocks({pm, view, schema, root, box, bar, handles: !!blocks?.on, grab: !!blocks, slash,
      insert: {block: node => insertBlock(node), table: () => insertBlock(newTable(2, 2)), photo: photos ? () => pickPhotos() : null},
      changed: () => { syncBox(); syncBlocksButton(); }, onPhone: () => syncBlocksButton()});
    root.classList.add('ed-has-blocks');
  }
  // S69-97 노트 안 할 일: the notes opener's provider (its own Google connection only). Its first read starts after the first paint (below).
  if (tasks) {
    gtaskPart = mountGtasks({view, N, provider: tasks, say: text => showNote(text), makeCheckList: () => setListStyle('bullet', CHECK_MARKER)});
  }
  // S69-98 NOTE-에버노트 ⑧ 노트 연결: '[[' → 노트 고르기 목록 → 그 노트 링크. 노트(noteLinks를 주는 곳)에만 붙는다.
  // 편집기와 같은 차례에 붙는다(늦게 오는 모듈 없음): 보이는 순간부터 친 '[['가 목록을 연다.
  if (noteLinks) {
    noteLinkPart = mountNoteLink({pm, view, schema, bar, noteLinks, changed: () => syncBox()});
  }
  // NOTE-글폭(S61-21): 글 줄 폭 묶음은 바로(.line-w), 손잡이는 부품을 불러온 뒤 붙인다(공유 페이지 편집기는 부르지 않음).
  let lineGrip = null, lineGone = false;
  if (lineWidth) {
    box.classList.add('line-w', 'line-w-host');
    import('./line-width.js').then(({mountLineWidth}) => { if (!lineGone) lineGrip = mountLineWidth({host: box, target: box}); }).catch(() => { /* 손잡이 없이 기본 폭 */ });
  }

  // ── commands ──
  function textblocksInSelection(st) {
    const out = [], sel = st.selection;
    const take = (from, to) => st.doc.nodesBetween(from, to, (node, pos, parent, index) => {
      if (node.isTextblock) { out.push({node, pos, parent, index}); return false; }
      return true;
    });
    if (sel instanceof pm.CellSelection) sel.forEachCell((cell, pos) => take(pos + 1, pos + cell.nodeSize - 1));
    else take(sel.from, sel.to);
    if (!out.length) { const $f = sel.$from; if ($f.parent.isTextblock) out.push({node: $f.parent, pos: $f.before(), parent: $f.node($f.depth - 1), index: $f.index($f.depth - 1)}); }
    return out;
  }
  function setTextStyle(value) {
    const st = view.state, tr = st.tr;
    const heading = /^h[123]$/.test(value), type = heading ? N.heading : N.paragraph;
    for (const {node, pos, parent, index} of textblocksInSelection(st)) {
      if (node.type === N.code_block) continue;
      if (!parent.canReplaceWith(index, index + 1, type)) continue;
      const keep = {align: node.attrs.align ?? null, indent: node.attrs.indent || 0};
      tr.setNodeMarkup(tr.mapping.map(pos), type, heading ? {level: +value[1], ...keep} : {style: value, ...keep});
    }
    if (tr.docChanged) view.dispatch(tr.scrollIntoView());
  }
  function setAlign(align) {
    const st = view.state, tr = st.tr, v = ALIGN_NAMES.includes(align) ? align : null;
    for (const {node, pos} of textblocksInSelection(st)) if (node.type === N.paragraph || node.type === N.heading) tr.setNodeAttribute(pos, 'align', v);
    if (st.selection instanceof pm.NodeSelection && st.selection.node.type === N.image) tr.setNodeAttribute(st.selection.from, 'align', v === 'center' ? 'center' : null);
    if (tr.docChanged) view.dispatch(tr);
  }
  // A mark with a name (글자색·형광펜): replaces the same mark on the selection; '' removes it. With no selection the next
  // letters typed get it.
  function setNamedMark(type, name) {
    const st = view.state, {from, to, empty} = st.selection;
    if (empty) {
      const marks = type.removeFromSet(st.storedMarks || st.selection.$from.marks());
      view.dispatch(st.tr.setStoredMarks(name ? type.create({color: name}).addToSet(marks) : marks));
      return;
    }
    const tr = st.tr;
    const ranges = st.selection instanceof pm.CellSelection ? st.selection.ranges.map(r => [r.$from.pos, r.$to.pos]) : [[from, to]];
    for (const [a, b] of ranges) { tr.removeMark(a, b, type); if (name) tr.addMark(a, b, type.create({color: name})); }
    view.dispatch(tr);
  }
  // 서식 지우기: letters keep their words and links; bold·italic·underline·strike·color·highlight, alignment and indent go.
  function clearFormat(st, dispatch) {
    const tr = st.tr, sel = st.selection;
    const ranges = sel instanceof pm.CellSelection ? sel.ranges.map(r => [r.$from.pos, r.$to.pos]) : [[sel.from, sel.to]];
    for (const [a, b] of ranges) for (const type of [M.strong, M.em, M.underline, M.strike, M.color, M.highlight]) tr.removeMark(a, b, type);
    for (const {node, pos} of textblocksInSelection(st)) if (node.type === N.paragraph || node.type === N.heading) {
      if (node.attrs.align) tr.setNodeAttribute(pos, 'align', null);
      if (node.attrs.indent) tr.setNodeAttribute(pos, 'indent', 0);
    }
    if (sel.empty) tr.setStoredMarks([]);
    dispatch?.(tr);
    return true;
  }
  const inNode = (st, type) => { const $f = st.selection.$from; for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === type) return d; return -1; };
  // 목록 ▾ / 번호 ▾: puts the cursor's lines into a list of this kind with this marker shape. In a list of the same kind only
  // the shape changes; in a list of the other kind the list changes in place (nesting stays). Items nested later (Tab) get no
  // saved shape, so they follow the automatic order by depth (1. → 1) → (1) → ①, • → ◦ → ▪).
  function setListStyle(kind, marker) {
    const st = view.state, type = kind === 'ordered' ? N.ordered_list : N.bullet_list, depth = inNode(st, N.list_item);
    if (depth > 0) {
      const $f = st.selection.$from, list = $f.node(depth - 1), at = $f.before(depth - 1);
      if (list.type === type) {
        if (list.attrs.marker !== marker) view.dispatch(st.tr.setNodeMarkup(at, null, {...list.attrs, marker}));
        return;
      }
      view.dispatch(st.tr.setNodeMarkup(at, type, {marker}));
      return;
    }
    pm.wrapInList(type, {marker})(st, view.dispatch);
  }
  const liftList = () => pm.liftListItem(N.list_item)(view.state, view.dispatch);
  // The list around the cursor: its kind, shape shown (saved, or automatic for its depth) and depth among lists of its kind.
  function listAround(st) {
    const li = inNode(st, N.list_item);
    if (li < 1) return null;
    const $f = st.selection.$from, list = $f.node(li - 1), kind = list.type === N.ordered_list ? 'ordered' : 'bullet';
    let depth = 0;
    for (let d = li - 2; d > 0; d--) if ($f.node(d).type === list.type) depth++;
    return {kind, depth, marker: list.attrs.marker || autoMarker(kind, depth)};
  }
  function toggleQuote() {
    const st = view.state;
    if (inNode(st, N.blockquote) > 0) return pm.lift(st, view.dispatch);
    return pm.wrapIn(N.blockquote)(st, view.dispatch);
  }
  // Puts a block at the cursor. A table gets the cursor in its first cell; after a rule the cursor goes to the paragraph
  // that follows (one is added when none does), so typing goes on below it.
  function insertBlock(node) {
    const st = view.state, $from = st.selection.$from;
    const emptyLine = $from.parent.type === N.paragraph && $from.parent.content.size === 0 && $from.depth > 0;
    const tr = st.tr;
    let at;
    // A photo chosen inside a photo row: the new block goes after the row (a row holds photos only).
    if ($from.parent.type === N.photo_row) { at = $from.after(); tr.insert(at, node); }
    else if (emptyLine) { at = $from.before(); tr.replaceWith(at, $from.after(), node); }
    else {
      if ($from.parent.isTextblock && $from.parentOffset > 0 && $from.parentOffset < $from.parent.content.size) tr.split($from.pos);
      const $p = tr.doc.resolve(tr.mapping.map($from.pos));
      at = $p.parent.isTextblock && $p.depth > 0 ? ($p.parentOffset === 0 ? $p.before() : $p.after()) : $p.pos;
      tr.insert(at, node);
    }
    const end = at + node.nodeSize;
    if (node.type === N.table) tr.setSelection(pm.TextSelection.near(tr.doc.resolve(at + 1)));
    else {
      const after = tr.doc.resolve(end).nodeAfter;
      if (!after || !after.isTextblock) tr.insert(end, N.paragraph.create({style: DEFAULT_BODY}));
      tr.setSelection(pm.TextSelection.near(tr.doc.resolve(end + 1)));
    }
    view.dispatch(tr.scrollIntoView());
  }
  function insertText(text) {
    const st = view.state;
    // Paired brackets go in around the cursor (the cursor between them).
    if (text.length === 2 && /^[「『〈《【“]/.test(text)) {
      const tr = st.tr.insertText(text);
      tr.setSelection(pm.TextSelection.create(tr.doc, tr.selection.from - 1));
      view.dispatch(tr.scrollIntoView());
      return;
    }
    const after = st.selection.$to.parent.textBetween(st.selection.$to.parentOffset, Math.min(st.selection.$to.parent.content.size, st.selection.$to.parentOffset + 1));
    const spaced = /^[~%℃㎡㎞]$/.test(text) || after === ' ' ? text : text + ' ';
    view.dispatch(st.tr.insertText(spaced).scrollIntoView());
  }
  // The lines before the cursor for [①]: the current line's text, then earlier lines nearest first (null for a heading).
  function circledText() {
    const st = view.state, $f = st.selection.$from;
    if (!$f.parent.isTextblock) return circled(1);
    const here = $f.parent.textBetween(0, $f.parentOffset, '', '\n').split('\n');
    const earlier = here.slice(0, -1).reverse();
    const blocks = [];
    st.doc.nodesBetween(0, $f.before(), (node, pos) => { if (node.isTextblock && pos < $f.before()) { blocks.push(node); return false; } return true; });
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === N.heading) { earlier.push(null); break; }
      earlier.push(...blocks[i].textBetween(0, blocks[i].content.size, '', '\n').split('\n').reverse());
    }
    return nextCircled(here[here.length - 1], earlier);
  }
  function selectWholeTable() {
    const st = view.state, depth = inNode(st, N.table);
    if (depth < 0) return;
    const $f = st.selection.$from, table = $f.node(depth), start = $f.start(depth), map = pm.TableMap.get(table);
    view.dispatch(st.tr.setSelection(pm.CellSelection.create(st.doc, start + map.map[0], start + map.map[map.map.length - 1])));
    say('표를 선택했어요. Delete나 Backspace로 삭제해요.');
  }
  function tableCmd(key) {
    const st = view.state;
    if (key === 'head') { toggleHeadRow(); return; }
    if (key === 'select') { selectWholeTable(); return; }
    if (key === 'fit') {
      const depth = inNode(st, N.table);
      if (depth < 0) return;
      const t = {node: st.selection.$from.node(depth), pos: st.selection.$from.before(depth), start: st.selection.$from.start(depth)};
      view.dispatch(setWidths(st.tr, t, widthsOf(t).map(() => 0)));
      return;
    }
    const cmds = {rowBefore: pm.addRowBefore, rowAfter: pm.addRowAfter, colBefore: pm.addColumnBefore, colAfter: pm.addColumnAfter,
      rowDel: pm.deleteRow, colDel: pm.deleteColumn, merge: pm.mergeCells, split: pm.splitCell, tableDel: pm.deleteTable};
    if (cmds[key] && !cmds[key](st, view.dispatch) && (key === 'merge' || key === 'split'))
      say(key === 'merge' ? '합칠 칸을 끌어서 둘 이상 선택해 주세요.' : '나눌 수 있는 합친 칸이 아니에요.');
  }
  // ED-폰표칸버튼: [넓게] [좁게] change the cursor's column by STEP px, [고르게] makes all columns the same; saved as the cells'
  // colwidth (one undo step), like the corner handle. A full table gives the room from its widest other column.
  const COL_STEP = 20;
  function columnWidthCmd(kind) {
    const st = view.state, depth = inNode(st, N.table);
    if (depth < 0) return;
    const sel = st.selection, $f = sel instanceof pm.CellSelection ? sel.$anchorCell : sel.$from;
    let t = {node: $f.node(depth), pos: $f.before(depth), start: $f.start(depth)};
    let cellDepth = -1;
    for (let d = $f.depth; d > depth; d--) if ($f.node(d).type === N.table_cell || $f.node(d).type === N.table_header) { cellDepth = d; break; }
    if (cellDepth < 0) return;
    const col = pm.TableMap.get(t.node).colCount($f.before(cellDepth) - t.start);
    freezeColumns(t);
    const now = tableAt(view.state, t.pos);
    if (!now) return;
    t = now;
    const start = widthsOf(t);
    const next = kind === 'even' ? evenWidths(start, MIN_COL)
      : stepWidths(start, col, kind === 'wider' ? COL_STEP : -COL_STEP, {min: MIN_COL, room: textWidth()});
    if (next.join() === start.join()) { say(kind === 'wider' ? '더 넓힐 수 없어요.' : kind === 'narrower' ? '더 좁힐 수 없어요.' : '이미 같은 너비예요.'); return; }
    view.dispatch(setWidths(view.state.tr, t, next));
    say(kind === 'even' ? '열 너비를 고르게 했어요.' : '열 너비를 바꿨어요.');
  }
  // [머리줄]: the table's first row is the head row, or not (wherever the cursor is in the table).
  function toggleHeadRow() {
    const st = view.state, depth = inNode(st, N.table);
    if (depth < 0) return;
    const tablePos = st.selection.$from.before(depth), table = st.selection.$from.node(depth), first = table.firstChild;
    const on = !first || first.childCount === 0 || [...Array(first.childCount).keys()].some(i => first.child(i).type !== N.table_header);
    const tr = st.tr;
    let pos = tablePos + 2;
    first.forEach(cell => { tr.setNodeMarkup(pos, on ? N.table_header : N.table_cell, cell.attrs); pos += cell.nodeSize; });
    view.dispatch(tr);
  }
  function newTable(rows = 2, cols = 2) {
    const cell = type => type.create(null, N.paragraph.create());
    const row = type => N.table_row.create(null, Array.from({length: cols}, () => cell(type)));
    return N.table.create(null, Array.from({length: rows}, (_, i) => row(i === 0 ? N.table_header : N.table_cell)));
  }
  // [링크]: the selection becomes a link (the address is added as letters when nothing is selected). "example.org" gets
  // https:// in front; only http(s)·mailto are kept.
  function applyLink() {
    const raw = linkInput.value.trim();
    const href = safeHref(raw) || (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw) ? safeHref('https://' + raw) : null);
    if (!href) { say('링크 주소를 확인해 주세요(https://로 시작).'); linkInput.focus(); return false; }
    const st = view.state, {from, to, empty} = st.selection, mark = M.link.create({href});
    const tr = empty ? st.tr.insert(from, schema.text(raw, [mark])) : st.tr.removeMark(from, to, M.link).addMark(from, to, mark);
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  // The link at the cursor (either side of it) or the first one in the selection.
  function linkAt(st) {
    const {from, to, empty, $from} = st.selection;
    if (empty) {
      for (const n of [$from.nodeAfter, $from.nodeBefore]) { const m = n && M.link.isInSet(n.marks); if (m) return m; }
      return null;
    }
    let found = null;
    st.doc.nodesBetween(from, to, n => { if (!found && n.isText) found = M.link.isInSet(n.marks) || null; });
    return found;
  }
  function removeLink() {
    const st = view.state;
    let {from, to} = st.selection;
    if (st.selection.empty) {
      const $p = st.selection.$from, idx = $p.index(), node = $p.parent.maybeChild(idx) || $p.parent.maybeChild(idx - 1);
      if (!node || !M.link.isInSet(node.marks)) return;
      // The whole linked run around the cursor.
      let start = $p.start(), s = null, e = null;
      $p.parent.forEach((child, offset) => { if (M.link.isInSet(child.marks) && start + offset <= $p.pos && start + offset + child.nodeSize >= $p.pos) { s = start + offset; e = s + child.nodeSize; } });
      if (s === null) return;
      from = s; to = e;
    }
    view.dispatch(st.tr.removeMark(from, to, M.link));
  }
  async function plainPaste() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { showNote('복사한 글을 읽지 못했어요. Ctrl+Shift+V(폰은 길게 눌러 "서식 없이 붙여넣기")로 넣어 주세요.'); return; }
    if (!text) return;
    view.focus();
    view.pasteText(text);
  }
  // A markdown paste: the letters go in through the plain-letter path (one paragraph per line), then dispatchTransaction converts.
  function pasteLetters(v, text, event) {
    pastingLetters = true;
    try { v.pasteText(text, event); } finally { pastingLetters = false; }
  }
  // The pasted part, converted right after the paste lands (auto) or by [서식으로 바꾸기] when converting at once could not load.
  async function convertPasted() {
    const range = pasteKey.getState(view.state);
    if (!range) return;
    let md;
    try { md = await loadMarkdownIt(); } catch {
      // Not loaded (offline): the letters stay and the small offer shows, to try again.
      const now = pasteKey.getState(view.state);
      if (now?.auto) view.dispatch(view.state.tr.setMeta(pasteKey, {...now, auto: false}).setMeta('addToHistory', false));
      else say('서식으로 바꾸지 못했어요. 다시 눌러 주세요.');
      return;
    }
    const now = pasteKey.getState(view.state);
    if (!now) return;
    const converted = markdownToDoc(md, view.state.doc.textBetween(now.from, now.to, '\n', '\n'));
    const nodes = pm.Node.fromJSON(schema, converted.doc).content;
    // Its own undo step: [↶] puts the pasted letters back (not the paste and the change together).
    const tr = pm.closeHistory(view.state.tr.replaceWith(now.from, now.to, nodes).setMeta(pasteKey, null));
    view.dispatch(tr.scrollIntoView());
    if (!now.auto) view.focus();
    say('서식으로 바꿨어요. 되돌리기(↶)로 글자로 돌아가요.');
    // After a paste converted by itself, [↶] back to the letters is the choice: no whole-text offer for them afterwards.
    if (now.auto) { wholeDismissed = true; showNote('마크다운을 서식으로 바꿨어요. 기호 그대로는 되돌리기(↶)'); }
  }
  // ED-폰마크다운붙여넣기 ②: the whole text, when it is only plain lines that look like markdown (pasted as letters before).
  let wholeDismissed = false, wholeSeen = null, wholeText = null;
  function wholeLetters(st) {
    if (wholeDismissed) return null;
    if (wholeSeen !== st.doc) {
      wholeSeen = st.doc;
      let plain = true;
      st.doc.forEach(n => { if (n.type !== N.paragraph) plain = false; });
      wholeText = plain ? markdownLettersOf(st.doc.toJSON(), looksLikeMarkdown) : null;
    }
    return wholeText;
  }
  async function convertWhole() {
    let md;
    try { md = await loadMarkdownIt(); } catch { say('서식으로 바꾸지 못했어요. 다시 눌러 주세요.'); return; }
    const text = wholeLetters(view.state);
    if (!text) return;
    const nodes = pm.Node.fromJSON(schema, markdownToDoc(md, text).doc).content;
    // One undo step: [↶] puts the whole text back as letters.
    view.dispatch(pm.closeHistory(view.state.tr.replaceWith(0, view.state.doc.content.size, nodes)).scrollIntoView());
    wholeDismissed = true; paint();
    view.focus();
    say('서식으로 바꿨어요. 되돌리기(↶)로 글자로 돌아가요.');
  }
  const say = text => { status.textContent = text; };
  let noteTimer = 0;
  function showNote(text) {
    note.textContent = text; note.hidden = false;
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { note.hidden = true; }, 5000);
  }
  const notePhotoLater = () => showNote(photos && !files ? '사진 파일만 넣을 수 있어요.' : !photos && files ? '이 글에는 사진을 넣을 수 없어요. [파일]로 넣어 주세요.'
    : '이 글에는 사진·파일을 넣을 수 없어요. 공유 페이지·노트 글쓰기에서 넣을 수 있어요.');
  // A photo in the text: our own id only. A saved place (no src) or a photo without an address shows as a place.
  // NOTE-노션편집 ①(나) 접기: [▸] before the first line opens or folds the rest (saved on the block; ↶ undoes it).
  function toggleView(node, v, getPos) {
    const dom = document.createElement('div'), btnEl = document.createElement('button'), body = document.createElement('div');
    // UI-접기꺾쇠: the site's one fold sign (⌄ folded, ⌃ open — turned by aria-expanded, ui-standard.css), not a triangle.
    btnEl.type = 'button'; btnEl.className = 'ed-toggle-btn'; btnEl.contentEditable = 'false';
    btnEl.append(Object.assign(document.createElement('i'), {className: 'kptu-chev'})); btnEl.firstChild.setAttribute('aria-hidden', 'true');
    body.className = 'ed-toggle-body';
    dom.append(btnEl, body);
    const show = n => { dom.className = n.attrs.open ? 'ed-toggle' : 'ed-toggle is-closed'; btnEl.setAttribute('aria-expanded', String(n.attrs.open)); btnEl.setAttribute('aria-label', n.attrs.open ? '접기' : '펼치기'); };
    show(node);
    btnEl.addEventListener('mousedown', e => e.preventDefault());
    btnEl.addEventListener('click', e => {
      e.preventDefault();
      const pos = getPos(); if (typeof pos !== 'number') return;
      const cur = v.state.doc.nodeAt(pos); if (!cur) return;
      const tr = v.state.tr.setNodeMarkup(pos, null, {...cur.attrs, open: !cur.attrs.open});
      // Folding with the cursor inside the hidden part: the cursor goes to the end of the ▸ line.
      const sel = v.state.selection, head = pos + 1 + cur.firstChild.nodeSize;
      if (cur.attrs.open && sel.from > head && sel.from < pos + cur.nodeSize) tr.setSelection(pm.TextSelection.create(tr.doc, head - 1));
      v.dispatch(tr);
    });
    return {dom, contentDOM: body,
      update(n) { if (n.type !== node.type) return false; node = n; show(n); return true; },
      stopEvent: e => btnEl.contains(e.target), ignoreMutation: m => btnEl.contains(m.target)};
  }
  function photoView(node) {
    const dom = document.createElement('figure');
    dom.contentEditable = 'false';
    const src = node.attrs.src;
    const place = text => {
      dom.className = 'ed-photo is-place ed-center'; dom.dataset.alt = node.attrs.alt;
      const mark = document.createElement('span'); mark.className = 'ed-photo-mark'; mark.textContent = text;
      dom.replaceChildren(mark);
      if (node.attrs.alt) { const cap = document.createElement('figcaption'); cap.className = 'ed-photo-cap'; cap.textContent = node.attrs.alt; dom.append(cap); }
    };
    const shown = photos || pictures;
    if (!src || !shown) { place(src ? '사진' : '사진 자리'); return {dom}; }
    // 공용 img-slot.js(PHOTO-못받은사진): 받는 동안 글자 없는 연한 회색 칸, 못 받으면 작은 ↻(누르면 그 사진만 다시).
    let gone = false;
    const bare = () => { place(''); dom.querySelector('.ed-photo-mark')?.remove(); };
    const fail = () => { if (gone) return; bare(); slotFailed(dom, load, 'photo'); };
    function load() {
      bare(); slotLoading(dom);
      shown.url(src).then(address => {
        if (gone) return;
        if (!address) return fail();
        const img = document.createElement('img');
        img.className = 'ed-photo-img'; img.alt = node.attrs.alt || ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
        img.addEventListener('error', fail, {once: true});
        img.addEventListener('load', () => { if (!gone) { dom.className = 'ed-photo ed-center'; slotShown(dom); } }, {once: true});
        img.src = address;
        dom.replaceChildren(img);
      }).catch(fail);
    }
    load();
    return {dom, destroy() { gone = true; }};
  }
  const photoCount = () => { let n = 0; view.state.doc.descendants(x => { if (x.type === N.image && x.attrs.src) n++; }); return n; };
  // S48-21 [파일]: a small card in the text (name · size, [열기]). Pressing the card chooses it (Backspace/Delete remove it); [열기] opens it.
  function fileView(node) {
    const dom = document.createElement('div');
    dom.className = 'ed-file'; dom.contentEditable = 'false';
    const mark = document.createElement('span'); mark.className = 'ed-file-mark'; mark.setAttribute('aria-hidden', 'true'); mark.append(toolIcon('file'));
    const name = document.createElement('span'); name.className = 'ed-file-name'; name.textContent = node.attrs.name || '파일';
    dom.append(mark, name);
    const size = fileSizeText(node.attrs.size);
    if (size) { const s0 = document.createElement('span'); s0.className = 'ed-file-size'; s0.textContent = size; dom.append(s0); }
    if (files && node.attrs.src) {
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'ed-file-open'; open.textContent = '열기'; open.setAttribute('aria-label', `${node.attrs.name || '파일'} 열기`);
      open.addEventListener('mousedown', e => e.preventDefault());
      open.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); try { files.open(node.attrs.src); } catch { showNote('파일을 열지 못했어요.'); } });
      dom.append(open);
    }
    return {dom, stopEvent: e => !!e.target.closest?.('.ed-file-open'), ignoreMutation: () => true};
  }
  // Puts a block in at the given document position (a drop), else at the cursor.
  const moveCursorTo = at => {
    if (typeof at !== 'number' || at < 0 || at > view.state.doc.content.size) return;
    try { view.dispatch(view.state.tr.setSelection(pm.TextSelection.near(view.state.doc.resolve(at)))); } catch { /* the cursor stays */ }
  };
  // Files dropped, pasted or picked: pictures go to [사진] (when the opener gives photos), the rest to [파일] (when it gives files).
  // One at a time, each put in after the one before. A failure stops the rest and says why; the ones in stay.
  async function filesFrom(list, at) {
    const all = [...(list || [])];
    // UPLOAD-올리기안됨: a photo from the phone app can come with an empty type; splitPictures also looks at the name and first bytes.
    const split = photos ? await splitPictures(all) : {pictures: [], others: all};
    if (view.isDestroyed) return;
    const pictures = split.pictures;
    const others = files ? split.others : [];
    // UPD-그림붙여넣기: where the opener has no inline [사진]/[파일] but its own attachment row (update windows), a pasted or dropped picture/file goes to that row.
    if (!pictures.length && !others.length) { if (onFiles && all.length) onFiles(all); else notePhotoLater(); return; }
    if (all.length > pictures.length + others.length) notePhotoLater();
    moveCursorTo(at);
    if (pictures.length) await photosIn(pictures);
    if (others.length && !view.isDestroyed) await filesIn(others);
  }
  // UX-알림하나로(S59-21): 못 올린 사진·파일은 하단바 위 한 줄 하나에 까닭과 [다시 올리기](files — 글 위 올리는 줄은 그 파일의 '실패 [다시]'를
  // 따로 그리지 않고, 편집기 안내 줄에도 같은 말을 쓰지 않는다). 결과를 알 수 없는 실패(이미 붙었을 수 있음)에는 [다시 올리기]가 없다.
  let upNote = null;
  function tellUpFailed(file, e, what, again) {
    upNote?.close(); upNote = null;
    // 편집기를 떠나 입력 세션이 바뀐 것(올리기는 끝났을 수 있다)은 실패로 알리지 않는다(예전에도 사라진 편집기 안에만 썼다).
    if (view.isDestroyed || e?.code === 'session_changed') return;
    // 올리기 전에 막힌 것(페이지를 아직 저장하지 않음 등 — 올리는 줄에 실패가 없다)은 예전처럼 편집기 안내 줄 하나에 쓴다.
    if (!file || !uploadJobs().some(job => job.file === file && job.phase === 'failed')) { showNote((e && e.message) || `${what}을 올리지 못했어요.`); return; }
    const canRetry = file && (!e?.code || !['note_save_result_unknown', 'note_changed'].includes(e.code));
    upNote = announceDock({text: `${what}을 올리지 못했어요`, note: (e && e.message) || '', error: true, ms: 0, files: file ? [file] : [],
      actions: canRetry ? [{label: '다시 업로드', aria: `못 올린 ${what} 다시 업로드`, run: () => { if (!view.isDestroyed) void again([file]); }}] : []});
  }
  async function photosIn(pictures) {
    const room = (photos.max || 40) - photoCount();
    if (pictures.length > room) { showNote(`사진은 한 페이지에 ${photos.max || 40}장까지 넣을 수 있어요.`); if (room <= 0) return; pictures.length = room; }
    // S52-05 A: several photos go in side by side without asking (no [나란히]/[한 장씩] question); one photo goes in on its own.
    const layout = pictures.length > 1 ? 'row' : 'single';
    const made = [];
    let failed = null;
    try {
      for (const file of pictures) {
        say(`사진 올리는 중… (${made.length + 1}/${pictures.length})`);
        uploadStarts(file, true);
        let src;
        try { ({src} = await photos.add(file)); }
        catch (e) {
          if (e?.code === 'upload_cancelled') continue; // ✕: 이 사진만 넣지 않고 다음 사진으로
          failed = file;
          throw e;
        } finally { uploadEnds(file); }
        if (view.isDestroyed) return;
        made.push(N.image.create({src, alt: ''}));
        if (layout === 'single') insertBlock(made.at(-1));
      }
      say(`사진 ${made.length}장을 넣었어요.${typeof photos.note === 'string' ? photos.note : photos.url && !files ? ' 저장해야 받는 사람에게 보여요.' : ''}`);
    } catch (e) {
      say(''); tellUpFailed(failed, e, '사진', filesFrom);
    }
    // 나란히: the photos that went up, in rows of PHOTO_ROW_MAX (one left over is a photo of its own).
    if (layout === 'row' && made.length && !view.isDestroyed) {
      for (let i = 0; i < made.length; i += PHOTO_ROW_MAX) {
        const part = made.slice(i, i + PHOTO_ROW_MAX);
        insertBlock(part.length === 1 ? part[0] : N.photo_row.create(null, part));
      }
    }
  }
  async function filesIn(list) {
    let done = 0, failed = null;
    try {
      for (const file of list) {
        say(`파일 올리는 중… (${done + 1}/${list.length})`);
        uploadStarts(file, false);
        let made;
        try { made = await files.add(file); }
        catch (e) {
          if (e?.code === 'upload_cancelled') continue;
          failed = file;
          throw e;
        } finally { uploadEnds(file); }
        if (view.isDestroyed) return;
        insertBlock(N.file.create({src: made.src, name: String(made.name || file.name || '').slice(0, LIMITS.alt), size: made.size > 0 ? made.size : (file.size || null)}));
        done++;
      }
      say(`파일 ${done}개를 넣었어요.`);
    } catch (e) {
      say(''); tellUpFailed(failed, e, '파일', filesIn);
    }
  }
  const pickFrom = (accept, take) => {
    const input = document.createElement('input');
    input.type = 'file'; if (accept) input.accept = accept; input.multiple = true; input.hidden = true;
    input.addEventListener('change', () => { const chosen = [...input.files]; input.remove(); void take(chosen); }, {once: true});
    input.addEventListener('cancel', () => input.remove(), {once: true});
    root.append(input); input.click();
  };
  const pickPhotos = () => pickFrom('image/*', async chosen => {
    const {pictures} = await splitPictures(chosen);
    if (view.isDestroyed) return;
    if (!pictures.length) { if (chosen.length) showNote('선택한 파일을 사진으로 알아보지 못했어요. JPEG·PNG 같은 사진을 선택해 주세요.'); return; }
    return filesFrom(pictures);
  });
  const pickFiles = () => pickFrom('', chosen => files ? filesIn(chosen) : chosen.length && onFiles?.(chosen));
  // S69-98 NOTE-에버노트 ⑥ [문서 스캔]: the phone's camera (a PC picks a picture) → doc-scan.js straightens and brightens it → the same [사진] path.
  const pickScan = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment'); input.hidden = true;
    input.addEventListener('change', async () => {
      const chosen = input.files?.[0]; input.remove();
      if (!chosen || view.isDestroyed) return;
      // Where the picture goes: the cursor as it was before the scan window took the focus (closing it puts the focus back on the text).
      const at = view.state.selection.from;
      const {pictures} = await splitPictures([chosen]);
      if (!pictures.length) { showNote('사진으로 알아보지 못했어요. 종이를 사진으로 찍어 주세요.'); return; }
      let made;
      try { made = await (await import('./doc-scan.js')).openDocScan(pictures[0]); } catch { made = {error: '스캔 창을 열지 못했어요. 다시 눌러 주세요.'}; }
      if (view.isDestroyed || !made) return;
      if (made.error) { showNote(made.error); return; }
      view.focus();
      return filesFrom([made], Math.min(at, view.state.doc.content.size));
    }, {once: true});
    input.addEventListener('cancel', () => input.remove(), {once: true});
    root.append(input); input.click();
  };

  // ── 사진 나란히 ──
  // The photo chosen now: {node, pos, row: {node, pos} | null}, or null.
  function chosenPhoto(st = view.state) {
    const sel = st.selection;
    if (!(sel instanceof pm.NodeSelection) || sel.node.type !== N.image) return null;
    const $p = st.doc.resolve(sel.from);
    const row = $p.parent.type === N.photo_row ? {node: $p.parent, pos: $p.before()} : null;
    return {node: sel.node, pos: sel.from, row};
  }
  // The photo or row right before (dir -1) or after (+1) the block at pos..end, in the same parent.
  function photoNeighbour(doc, pos, end, dir) {
    const $p = doc.resolve(dir < 0 ? pos : end), other = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
    if (!other) return null;
    if (other.type === N.image) return {node: other, pos: dir < 0 ? pos - other.nodeSize : end};
    if (other.type === N.photo_row && other.childCount < PHOTO_ROW_MAX) return {node: other, pos: dir < 0 ? pos - other.nodeSize : end};
    return null;
  }
  // Puts photo (a node) beside the photo or row at target ({node, pos}), on its left (side -1) or right (+1). Returns the tr.
  function joinInto(tr, target, photo, side, before = null) {
    if (target.node.type === N.image) {
      const pair = side < 0 ? [photo, target.node] : [target.node, photo];
      return tr.replaceWith(target.pos, target.pos + target.node.nodeSize, N.photo_row.create(null, pair));
    }
    // A row: at its start or end, or next to one photo in it (before: that photo's index).
    const at = before !== null ? target.pos + 1 + offsetOf(target.node, before + (side > 0 ? 1 : 0)) : side < 0 ? target.pos + 1 : target.pos + target.node.nodeSize - 1;
    return tr.insert(at, photo);
  }
  const offsetOf = (node, index) => { let off = 0; for (let i = 0; i < index && i < node.childCount; i++) off += node.child(i).nodeSize; return off; };
  function canJoin(st) {
    const c = chosenPhoto(st);
    if (!c || c.row) return false;
    return !!(photoNeighbour(st.doc, c.pos, c.pos + c.node.nodeSize, -1) || photoNeighbour(st.doc, c.pos, c.pos + c.node.nodeSize, 1));
  }
  function joinPhoto() {
    const st = view.state, c = chosenPhoto(st);
    if (!c || c.row) return;
    const end = c.pos + c.node.nodeSize;
    const before = photoNeighbour(st.doc, c.pos, end, -1), after = before ? null : photoNeighbour(st.doc, c.pos, end, 1);
    const target = before || after;
    if (!target) { showNote('바로 위나 아래에 사진이 있어야 나란히 놓을 수 있어요.'); return; }
    const tr = st.tr.delete(c.pos, end);
    const mapped = {node: target.node, pos: tr.mapping.map(target.pos)};
    joinInto(tr, mapped, c.node, before ? 1 : -1);
    view.dispatch(tr.scrollIntoView());
    say('사진을 나란히 놓았어요.');
  }
  function apartPhoto() {
    const st = view.state, c = chosenPhoto(st);
    if (!c || !c.row) return;
    const rowEnd = c.row.pos + c.row.node.nodeSize;
    const tr = st.tr.insert(rowEnd, c.node).delete(c.pos, c.pos + c.node.nodeSize);
    const at = tr.mapping.map(rowEnd, 1) - c.node.nodeSize;
    try { tr.setSelection(pm.NodeSelection.create(tr.doc, Math.max(0, at))); } catch { /* the plugin may unwrap the row */ }
    view.dispatch(tr.scrollIntoView());
    say('사진을 따로 놓았어요.');
  }
  // A photo of this text dropped on another photo: beside it, on the half it was dropped on. Anything else drops as before.
  function dropBeside(v, event, slice) {
    const only = slice.content.childCount === 1 && slice.content.firstChild;
    const sel = v.state.selection;
    if (!only || only.type !== N.image || !(sel instanceof pm.NodeSelection) || sel.node.type !== N.image) return false;
    const fig = event.target?.closest?.('.ed-photo');
    if (!fig || !v.dom.contains(fig)) return false;
    let pos;
    try { pos = v.posAtDOM(fig, 0); } catch { return false; }
    const node = v.state.doc.nodeAt(pos);
    if (!node || node.type !== N.image || pos === sel.from) return false;
    const $t = v.state.doc.resolve(pos), inRow = $t.parent.type === N.photo_row;
    if (inRow && $t.parent.childCount >= PHOTO_ROW_MAX && $t.parent !== v.state.doc.resolve(sel.from).parent) { showNote(`한 줄에는 사진 ${PHOTO_ROW_MAX}장까지 놓을 수 있어요.`); event.preventDefault(); return true; }
    const r = fig.getBoundingClientRect(), side = event.clientX < r.left + r.width / 2 ? -1 : 1;
    event.preventDefault();
    const tr = v.state.tr.delete(sel.from, sel.from + sel.node.nodeSize);
    const tpos = tr.mapping.map(pos);
    if (inRow) {
      const $r = tr.doc.resolve(tpos), row = {node: $r.parent, pos: $r.before()};
      joinInto(tr, row, sel.node, side, $r.index());
    } else joinInto(tr, {node, pos: tpos}, sel.node, side);
    v.dispatch(tr.scrollIntoView());
    say('사진을 나란히 놓았어요.');
    return true;
  }

  const RUN = {
    strong: () => pm.toggleMark(M.strong)(view.state, view.dispatch),
    em: () => pm.toggleMark(M.em)(view.state, view.dispatch),
    underline: () => pm.toggleMark(M.underline)(view.state, view.dispatch),
    strike: () => pm.toggleMark(M.strike)(view.state, view.dispatch),
    quote: toggleQuote,
    rule: () => insertBlock(N.horizontal_rule.create()),
    nowStamp: () => view.dispatch(view.state.tr.insertText(nowText()).scrollIntoView()),
    photo: () => pickPhotos(),
    scan: () => pickScan(),
    // NOTE-블록꾹눌러잡기(S71-66, P6): a phone has no handle, so ⠿ opens the cursor block's menu (the same menu); wider it is 블록 모드.
    blocks: () => (blockPart?.isPhone() ? blockPart.toggleMenuAt(buttons.blocks) : setBlocks(!blockPart?.isOn(), true)),
    gtask: () => { void gtaskPart?.press(); },
    form: () => { const at = buttons.gInsert?.isConnected && !buttons.gInsert.hidden ? buttons.gInsert : buttons.form; void forms?.pick(at); },
    file: () => pickFiles(),
    indent: () => pm.chainCommands(pm.sinkListItem(N.list_item), indentBy(1))(view.state, view.dispatch),
    outdent: () => pm.chainCommands(pm.liftListItem(N.list_item), indentBy(-1))(view.state, view.dispatch),
    clear: () => clearFormat(view.state, view.dispatch),
    undo: () => (shortcuts ? pm.chainCommands(pm.undoInputRule, pm.undo) : pm.undo)(view.state, view.dispatch), redo: () => pm.redo(view.state, view.dispatch),
  };
  function run(fn) {
    // During a 한글 composition, wait for it to end (the press blurred the box) before changing the document.
    const go = () => { fn(); view.focus(); };
    if (!view.composing) { go(); return; }
    let tries = 0;
    const wait = () => (!view.composing || ++tries > 20) ? go() : setTimeout(wait, 25);
    setTimeout(wait, 0);
  }

  // ── panels ──
  let openName = null, grouped = false;
  const triggerOf = name => name === 'grid' ? buttons.table : buttons[name];
  // The panel a panel's own button sits in (a group popover), or null when the button is on the row: that one stays
  // open under the panel opened from inside it, and a second press (or Esc) goes back to it.
  const hostOf = name => {
    const p = triggerOf(name)?.parentElement;
    return GROUP_KEYS.find(k => panels[k] === p) || null;
  };
  const placeOpen = () => {
    if (!openName) return;
    const chain = [openName];
    for (let h = hostOf(openName); h && !chain.includes(h); h = hostOf(h)) chain.unshift(h);
    for (const n of chain) placePop(n);
  };
  // A popover goes right under the button that opened it, over the text (the text does not move). It stays inside the visible
  // screen: moved left when it would pass the right edge, put above the button when there is no room below, and its own list
  // scrolls when neither fits. (A phone's bottom bar is kept clear, as the cell menu does.)
  function placePop(name) {
    const pop = panels[name], trigger = triggerOf(name);
    if (!pop || !pop.classList.contains('ed-pop') || pop.hidden || !trigger) return;
    const vv = window.visualViewport;
    const view0 = {l: vv ? vv.offsetLeft : 0, t: vv ? vv.offsetTop : 0, w: vv ? vv.width : innerWidth, h: vv ? vv.height : innerHeight};
    const gap = 4, side = 8, bottomRoom = view0.w <= 760 ? 72 : 12;
    pop.style.maxHeight = ''; pop.style.maxWidth = ''; pop.style.overflowY = '';
    if (pop.getBoundingClientRect().width > view0.w - side * 2) pop.style.maxWidth = `${Math.max(120, view0.w - side * 2)}px`;
    pop.style.left = '0px'; pop.style.top = '0px';
    const t = trigger.getBoundingClientRect(), size = pop.getBoundingClientRect();
    // NOTE-노션편집 ①(가): the screen's own top line (PC: the fixed top bar, --kptu-stick-top) is not room — a box opened upward
    // under it could not be pressed. (0 on a phone and in the big window.)
    const topLine = parseFloat(getComputedStyle(root).getPropertyValue('--kptu-stick-top')) || 0;
    const ceiling = Math.max(view0.t + side, topLine + side);
    const below = view0.t + view0.h - bottomRoom - t.bottom - gap, above = t.top - ceiling - gap;
    const underneath = size.height <= below || below >= above, room = Math.max(80, Math.floor(underneath ? below : above));
    // (A button inside a scrolled group popover can sit above the screen's top: the popover stays on the screen.)
    const top = Math.max(ceiling, underneath ? t.bottom + gap : t.top - gap - Math.min(size.height, room));
    pop.style.maxHeight = `${room}px`;
    // NOTE-블록모드찾기(2026-11-25): a list that fits shows no scroll bar. Its buttons' 44px press area (::after) reaches a few px past the box
    // edge, which alone made the list "scroll" with every item already in view; it scrolls only when the list is taller than the room.
    pop.style.overflowY = size.height <= room ? 'hidden' : '';
    // (The left floor is the screen's side margin, or the button's own left when the button sits closer to the edge, so a popover
    // under the first button of a tight phone row still starts on that button.)
    const left = Math.max(view0.l + Math.min(side, Math.max(0, t.left - view0.l)), Math.min(t.left, view0.l + view0.w - side - size.width));
    pop.style.left = `${Math.round(left)}px`; pop.style.top = `${Math.round(top)}px`;
    // An ancestor with a transform or filter would make "fixed" relative to it: correct by what was really drawn.
    const drawn = pop.getBoundingClientRect();
    if (Math.abs(drawn.left - left) > 1) pop.style.left = `${Math.round(left - (drawn.left - left))}px`;
    if (Math.abs(drawn.top - top) > 1) pop.style.top = `${Math.round(top - (drawn.top - top))}px`;
  }
  const followPop = e => { if (openName && !(e && e.target && e.target.closest && e.target.closest('.ed-pop'))) placeOpen(); };
  function openPanel(name) {
    const was = openName;
    // The panels that hold the pressed panel's button stay open (a group popover).
    const hosts = new Set();
    for (let h = name && hostOf(name); h && !hosts.has(h); h = hostOf(h)) hosts.add(h);
    for (const key of PANEL_ORDER) {
      const on = key === name || hosts.has(key);
      panels[key].hidden = !on;
      triggerOf(key)?.setAttribute('aria-expanded', String(on));
    }
    openName = name || null;
    if (name !== 'link' && panels.link.firstChild) panels.link.replaceChildren();
    if (name === 'link') {
      if (!panels.link.firstChild) panels.link.append(linkInput, linkOk, linkOff);
      const mark = linkAt(view.state);
      linkInput.value = mark ? mark.attrs.href : '';
      linkOff.hidden = !mark;
      setTimeout(() => linkInput.focus(), 0);
    }
    if (name === 'grid') paintGrid(2, 2);
    if (name) { paint(); placeOpen(); }
    syncBox();
    return was;
  }
  const closePanels = () => openPanel(null);
  // ED③-창: any open panel or the cell menu counts as a small box. Coalesced into one call per event so closing one box to open another
  // (a panel then the cell menu) reaches onBox as a single "open".
  let boxWas = false, boxQueued = false;
  const boxOpen = () => !!openName || !ctx.hidden || !!blockPart?.isOpen() || !!noteLinkPart?.isOpen();
  const syncBox = () => {
    if (!onBox || boxQueued) return;
    boxQueued = true;
    queueMicrotask(() => { boxQueued = false; const now = boxOpen(); if (now !== boxWas) { boxWas = now; onBox(now); } });
  };
  function paintGrid(r, c) {
    for (const cell of grid.children) cell.classList.toggle('is-on', +cell.dataset.edGridR <= r && +cell.dataset.edGridC <= c);
    gridSize.textContent = `${r} × ${c}`;
  }
  grid.addEventListener('pointerover', e => { const b = e.target.closest('[data-ed-grid-r]'); if (b) paintGrid(+b.dataset.edGridR, +b.dataset.edGridC); });
  grid.addEventListener('focusin', e => { const b = e.target.closest('[data-ed-grid-r]'); if (b) paintGrid(+b.dataset.edGridR, +b.dataset.edGridC); });
  grid.addEventListener('keydown', e => {
    const b = e.target.closest('[data-ed-grid-r]');
    if (!b) return;
    const move = {ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0]}[e.key];
    if (!move) return;
    e.preventDefault();
    const r = Math.max(1, Math.min(GRID.rows, +b.dataset.edGridR + move[0])), c = Math.max(1, Math.min(GRID.cols, +b.dataset.edGridC + move[1]));
    grid.querySelector(`[data-ed-grid-r="${r}"][data-ed-grid-c="${c}"]`)?.focus();
  });
  linkInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (applyLink()) { closePanels(); view.focus(); } }
  });

  // ── table cell menu ──
  let ctxFrom = null;
  function openCtx(x, y) {
    ctxFrom = document.activeElement;
    closePanels();
    ctx.hidden = false;
    paint();
    const vv = window.visualViewport, vw = vv ? vv.width : innerWidth, vh = vv ? vv.height : innerHeight;
    // Kept clear of a phone's bottom bar (UI: 팝업이 하단바에 가리지 않게).
    const bottomRoom = vw <= 760 ? 72 : 12;
    const r = ctx.getBoundingClientRect();
    ctx.style.left = `${Math.max(8, Math.min(x, vw - r.width - 8))}px`;
    ctx.style.top = `${Math.max(8, Math.min(y, vh - r.height - bottomRoom))}px`;
    ctx.querySelector('button:not(:disabled)')?.focus({preventScroll: true});
    syncBox();
  }
  function closeCtx(refocus = true) {
    if (ctx.hidden) return;
    ctx.hidden = true;
    if (refocus) view.focus();
    ctxFrom = null;
    syncBox();
  }
  function closeBoxes() {
    if (!boxOpen()) return false;
    closeCtx(false); closePanels(); blockPart?.close(); noteLinkPart?.close();
    return true;
  }
  ctx.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    closeCtx(false);
    if (b.dataset.edColw) { run(() => columnWidthCmd(b.dataset.edColw)); return; }
    run(() => tableCmd(b.dataset.edTable));
  });
  ctx.addEventListener('keydown', e => {
    const items = [...ctx.querySelectorAll('button:not(:disabled)')], i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeCtx(); }
    else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });
  // A press anywhere outside the button row and its popovers (the text included) closes the open one.
  const outside = e => {
    if (!ctx.hidden && !ctx.contains(e.target)) closeCtx(false);
    if (openName && !bar.contains(e.target)) closePanels();
  };
  document.addEventListener('pointerdown', outside, true);
  // NOTE-서식메뉴Esc: an Escape that a small box (a popover of the button row, the table cell menu) takes is used up here — it closes
  // only the box and never reaches the screen around the editor (노트 고치기 끝내기, 큰 창 닫기, 다른 화면의 Esc). One rule for every
  // opener: the box's own key handlers inside the editor run first, then the editor's root stops the key (a box still open is closed).
  // With no box open, Escape goes on to the screen as before. Focus outside the editor with a popover open: closed and stopped here.
  let escTaken = false;
  root.addEventListener('keydown', e => { if (e.key === 'Escape') escTaken = boxOpen(); }, true);
  root.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !escTaken) return;
    escTaken = false;
    if (boxOpen()) closeBoxes();
    e.preventDefault(); e.stopPropagation();
  });
  const escape = e => {
    if (e.key !== 'Escape' || !boxOpen() || root.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation(); closeBoxes();
  };
  document.addEventListener('keydown', escape, true);
  // A popover follows its button when the page, the screen or the sideways button row moves.
  window.addEventListener('scroll', followPop, true);
  window.addEventListener('resize', followPop);
  window.visualViewport?.addEventListener('resize', followPop);
  window.visualViewport?.addEventListener('scroll', followPop);
  tools.addEventListener('scroll', followPop);

  view.dom.addEventListener('mousedown', e => { if (e.button === 0) pointerHeld = true; });
  const release = () => { if (pointerHeld) { pointerHeld = false; paint(); } };
  window.addEventListener('mouseup', release, true);
  // A press on the table grip (its top left corner) chooses the whole table.
  view.dom.addEventListener('mousedown', e => {
    if (!e.target.closest?.('.ed-table-grip')) return;
    e.preventDefault();
    const wrap = e.target.closest('.ed-table-wrap'), pos = view.posAtDOM(wrap.querySelector('td,th'), 0);
    view.dispatch(view.state.tr.setSelection(pm.TextSelection.near(view.state.doc.resolve(pos))));
    selectWholeTable();
    view.focus();
  });

  // ED-서식줄펼침: pressing a table's outer border (top, left, bottom) chooses the whole table. The pointer shows a hand and the
  // table gets a faint outline while it is over the border. A finger gets a wider strip (a phone has [표 선택] too). The right
  // border is the last column's width handle, so a press there still drags the column.
  let pointerKind = 'mouse', edgeWrap = null;
  const edgeWidth = () => pointerKind === 'touch' || pointerKind === 'pen' ? 12 : 4;
  function tableEdgeAt(x, y, target) {
    if (target?.closest?.('.ed-table-resize')) return null;
    const wrap = target?.closest?.('.ed-table-wrap');
    const table = wrap && wrap.querySelector('table');
    if (!table || !view.dom.contains(wrap)) return null;
    const rs = pm.columnResizingPluginKey.getState(view.state);
    if (rs && rs.activeHandle >= 0) return null;
    const r = table.getBoundingClientRect(), w = edgeWidth();
    const insideX = x >= r.left - w && x <= r.right - w, insideY = y >= r.top - w && y <= r.bottom + w;
    if (!insideX || !insideY) return null;
    const onEdge = Math.abs(y - r.top) <= w || Math.abs(y - r.bottom) <= w || Math.abs(x - r.left) <= w;
    return onEdge ? wrap : null;
  }
  const setEdge = wrap => {
    if (wrap === edgeWrap) return;
    edgeWrap?.classList.remove('is-edge');
    edgeWrap = wrap; wrap?.classList.add('is-edge');
  };
  view.dom.addEventListener('pointerdown', e => { pointerKind = e.pointerType || 'mouse'; }, true);
  view.dom.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !pointerHeld) setEdge(tableEdgeAt(e.clientX, e.clientY, e.target)); });
  view.dom.addEventListener('pointerleave', () => setEdge(null));
  view.dom.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest?.('.ed-table-grip')) return;
    const wrap = tableEdgeAt(e.clientX, e.clientY, e.target);
    if (!wrap) return;
    e.preventDefault(); e.stopPropagation();
    const pos = view.posAtDOM(wrap.querySelector('td,th'), 0);
    view.dispatch(view.state.tr.setSelection(pm.TextSelection.near(view.state.doc.resolve(pos))));
    selectWholeTable();
    view.focus();
  }, true);

  // Pressing a button keeps the text box focused (the phone keyboard stays), except during a composition (see run) and
  // in the link box (it takes the focus to type).
  // ED-서식줄펼침: the editor learns of the browser's own selection change (Shift+Home, Shift+arrows, a drag) a moment after it
  // happens (selectionchange). A button pressed in that moment used to act on the old, empty selection (굵게 set as a typing
  // style instead of on the chosen letters). So a press first reads the browser's selection into the editor.
  const syncSelection = () => { if (view.isDestroyed || view.composing) return; try { view.domObserver.forceFlush(); view.domObserver.flush(); } catch { /* reads on the next selectionchange */ } };
  // The same read after a key is let go or a press ends, in case the browser's own selectionchange was missed or ignored
  // (the editor then kept the old cursor although letters were chosen on screen).
  view.dom.addEventListener('keyup', syncSelection);
  window.addEventListener('pointerup', syncSelection, true);
  const keepFocus = e => { const b = e.target.closest('button'); if (b && !view.composing && view.hasFocus()) { syncSelection(); e.preventDefault(); } };
  bar.addEventListener('pointerdown', keepFocus);
  bar.addEventListener('mousedown', keepFocus);
  ctx.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !bar.contains(b) || b.disabled) return;
    const d = b.dataset;
    if (d.edPhoto) { run(d.edPhoto === 'join' ? joinPhoto : apartPhoto); return; }
    if (d.edCmd && OPENS[d.edCmd]) { const name = OPENS[d.edCmd]; openPanel(openName === name ? hostOf(name) : name); return; }
    if (d.edStyle) { run(() => setTextStyle(d.edStyle)); closePanels(); return; }
    if (d.edListMarker) { const kind = d.edListKind, marker = d.edListMarker; closePanels(); run(() => setListStyle(kind, marker)); return; }
    if (d.edListOff) { closePanels(); run(liftList); return; }
    if ('edColor' in d) { run(() => setNamedMark(M.color, d.edColor)); closePanels(); return; }
    if ('edHighlight' in d) { run(() => setNamedMark(M.highlight, d.edHighlight)); closePanels(); return; }
    if (d.edAlign) { run(() => setAlign(d.edAlign)); closePanels(); return; }
    if (d.edSym) { const sign = d.edSym; closePanels(); run(() => insertText(sign)); return; }
    if (d.edGridR) { const r = +d.edGridR, c = +d.edGridC; closePanels(); run(() => { if (!pm.isInTable(view.state)) insertBlock(newTable(r, c)); }); return; }
    if ('edLinkOk' in d) { if (applyLink()) { closePanels(); view.focus(); } return; }
    if ('edLinkOff' in d) { closePanels(); run(removeLink); return; }
    if (d.edCmd === 'plainPaste') { closePanels(); void plainPaste(); return; }
    // S71-65: [서식] opens the opener's picker; the text keeps no focus meanwhile (a phone's keyboard stays down under the picker).
    if (d.edCmd === 'form') { closePanels(); RUN.form(); return; }
    if (d.edCmd && RUN[d.edCmd]) { closePanels(); run(RUN[d.edCmd]); return; }
    if (d.edTable) { run(() => tableCmd(d.edTable)); return; }
    if ('edConvert' in d) { void (pasteKey.getState(view.state) ? convertPasted() : convertWhole()); return; }
    if ('edDismiss' in d) {
      if (!pasteKey.getState(view.state)) { wholeDismissed = true; paint(); }
      view.dispatch(view.state.tr.setMeta(pasteKey, null).setMeta('addToHistory', false)); view.focus();
    }
  });
  bar.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !openName) return;
    e.preventDefault();
    const name = openName, trigger = triggerOf(name), host = hostOf(name);
    if (name === 'link') { closePanels(); view.focus(); return; }
    openPanel(host);
    (trigger.offsetParent ? trigger : buttons[host] || view.dom).focus();
  });
  // NOTE-노션편집 ①(가): one row model for every width (see the top of this file). A phone: PHONE_ORDER, every group's buttons in its list.
  // Wider: each group's PC_OUT prefix stands on the row before the group button; when the row does not fit, those go back into their
  // group from the right end (the last group first), so the order read through the row and the lists never changes.
  const phone = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
  const groupItems = key => GROUPS.find(g => g[0] === key)[3].map(k => buttons[k]).filter(Boolean);
  const outCount = {};
  function placeTools() {
    const row = [];
    for (const k of PHONE_ORDER) {
      if (!GROUP_KEYS.includes(k)) { if (buttons[k]) row.push(buttons[k]); continue; }
      const items = groupItems(k), n = outCount[k] || 0;
      row.push(...items.slice(0, n), buttons[k]);
      const inside = items.slice(n);
      // (The same nodes in the same order are left where they are: no detaching, so focus and an open popover's anchor stay.)
      if (panels[k].childElementCount !== inside.length || inside.some((b, i) => panels[k].children[i] !== b)) panels[k].replaceChildren(...inside);
      buttons[k].hidden = n >= items.length;
    }
    // A small gap before each part: [단계] | 굵게 · | each group | [⋮⋮ 블록 모드] ↶ ↷.
    const starts = new Set([buttons.strong, buttons.blocks || buttons.undo]);
    for (const k of GROUP_KEYS) starts.add(groupItems(k).slice(0, outCount[k] || 0)[0] || buttons[k]);
    for (const b of Object.values(buttons)) b.classList.remove('ed-gap');
    for (const b of row) if (starts.has(b)) b.classList.add('ed-gap');
    if (tools.childElementCount !== row.length || row.some((b, i) => tools.children[i] !== b)) tools.replaceChildren(...row);
  }
  function fitTools() {
    if (grouped) return;
    for (const k of GROUP_KEYS) { const items = groupItems(k), pcOut = PC_OUT[k] || []; let n = 0; while (n < items.length && pcOut.includes(items[n].dataset.edCmd)) n++; outCount[k] = n; }
    placeTools();
    if (!tools.clientWidth) return;
    for (let i = GROUP_KEYS.length - 1; i >= 0 && tools.scrollWidth > tools.clientWidth; i--) {
      const k = GROUP_KEYS[i];
      while (outCount[k] > 0 && tools.scrollWidth > tools.clientWidth) { outCount[k]--; placeTools(); }
    }
    paint();
  }
  // Refit only when the row overflows now or became clearly wider (more buttons may fit). A small width change that still fits (a page
  // scroll bar coming and going) changes nothing — no layout loop, and an open popover stays open. When the layout changes, popovers close.
  let fitFrame = 0, lastWidth = -1;
  const layoutKey = () => GROUP_KEYS.map(k => outCount[k] || 0).join();
  const queueFit = () => { if (!fitFrame) fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    const w = tools.clientWidth;
    if (grouped || !w || w === lastWidth) return;
    if (lastWidth >= 0 && tools.scrollWidth <= w && w < lastWidth + 24) return;
    lastWidth = w;
    const was = layoutKey();
    fitTools();
    if (layoutKey() !== was) closePanels();
  }); };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(queueFit) : null;
  resize?.observe(tools);
  let laidOut = false;
  function setGrouped(on) {
    if (on === grouped && laidOut) return;
    laidOut = true;
    closePanels();
    grouped = on;
    root.classList.toggle('ed-grouped', on);
    root.classList.toggle('ed-wide', !on);
    if (on) { for (const k of GROUP_KEYS) outCount[k] = 0; placeTools(); paint(); } else { fitTools(); lastWidth = tools.clientWidth || -1; }
  }
  const syncLayout = () => setGrouped(!!phone?.matches);
  phone?.addEventListener?.('change', syncLayout);

  // ── state shown on the buttons ──
  function currentStyle(st) {
    const p = st.selection.$from.parent;
    if (p.type === N.heading) return `h${p.attrs.level}`;
    if (p.type === N.paragraph) return BODY_STYLES.includes(p.attrs.style) ? p.attrs.style : DEFAULT_BODY;
    return '';
  }
  function markActive(st, type) {
    const {from, to, empty, $from} = st.selection;
    if (empty) return !!type.isInSet(st.storedMarks || $from.marks());
    return st.doc.rangeHasMark(from, to, type);
  }
  const namedMark = (st, type) => {
    const {empty, $from, from, to} = st.selection;
    if (empty) return type.isInSet(st.storedMarks || $from.marks())?.attrs.color || '';
    let found = '';
    st.doc.nodesBetween(from, to, node => { const m = node.isText && type.isInSet(node.marks); if (m && !found) found = m.attrs.color; });
    return found;
  };
  function paint() {
    const st = view.state, style = currentStyle(st);
    const label = (TEXT_STYLES.find(([v]) => v === style) || [null, st.selection.$from.parent.type === N.code_block ? '코드' : '단계'])[1];
    setLabel(buttons.style, `${label} ▾`);
    for (const b of panels.style.querySelectorAll('[data-ed-style]')) b.setAttribute('aria-pressed', String(b.dataset.edStyle === style));
    for (const key of ['strong', 'em', 'underline', 'strike']) buttons[key].setAttribute('aria-pressed', String(markActive(st, M[key])));
    const color = namedMark(st, M.color), hl = namedMark(st, M.highlight);
    buttons.color.dataset.edNow = color; buttons.highlight.dataset.edNow = hl;
    for (const b of panels.color.querySelectorAll('[data-ed-color]')) b.setAttribute('aria-pressed', String(b.dataset.edColor === color));
    for (const b of panels.highlight.querySelectorAll('[data-ed-highlight]')) b.setAttribute('aria-pressed', String(b.dataset.edHighlight === hl));
    const p = st.selection.$from.parent;
    const align = (st.selection instanceof pm.NodeSelection ? st.selection.node.attrs.align : p.attrs && p.attrs.align) || 'left';
    setLabel(buttons.align, `${buttons.align.parentElement !== tools ? '정렬 ' : ''}${(ALIGNS.find(([v]) => v === align) || ALIGNS[0])[1]} ▾`);
    for (const b of panels.align.querySelectorAll('[data-ed-align]')) b.setAttribute('aria-pressed', String(b.dataset.edAlign === align));
    buttons.quote.setAttribute('aria-pressed', String(inNode(st, N.blockquote) > 0));
    const li = inNode(st, N.list_item), around = listAround(st);
    buttons.bullet.setAttribute('aria-pressed', String(around?.kind === 'bullet'));
    buttons.ordered.setAttribute('aria-pressed', String(around?.kind === 'ordered'));
    for (const kind of ['bullet', 'ordered']) {
      for (const b of panels[kind].querySelectorAll('[data-ed-list-marker]')) b.setAttribute('aria-pressed', String(around?.kind === kind && around.marker === b.dataset.edListMarker));
      panels[kind].querySelector('[data-ed-list-off]').hidden = around?.kind !== kind;
    }
    buttons.outdent.disabled = !(li > 0 || (p.attrs && p.attrs.indent > 0));
    buttons.undo.disabled = pm.undoDepth(st) === 0; buttons.redo.disabled = pm.redoDepth(st) === 0;
    buttons.link.setAttribute('aria-pressed', String(!!linkAt(st)));
    if (buttons.gtask) { const g = gtaskPart?.state(st); setLabel(buttons.gtask, g?.unlink ? '구글 할 일 연결 풀기' : '구글 할 일로'); buttons.gtask.setAttribute('aria-pressed', String(!!g?.unlink)); }
    const inTable = pm.isInTable(st);
    // The table tools row shows or hides only when no mouse button is held: appearing in the middle of a press would push
    // the text down under the pointer (a drag across cells would land on the wrong row).
    if (!pointerHeld) tableRow.hidden = !inTable;
    // S48-21: the photo row tools while one photo is chosen ([옆 사진과 나란히] only when a photo is right above or below).
    // (Only where photos can be put in: a saved photo place in a text without [사진] gets no tools.)
    const pic = photos ? chosenPhoto(st) : null;
    photoTools.hidden = !pic;
    if (pic) { photoJoin.hidden = !!pic.row; photoJoin.disabled = !pic.row && !canJoin(st); photoApart.hidden = !pic.row; }
    buttons.table.disabled = inTable;
    if (inTable) {
      const can = {merge: pm.mergeCells(st), split: pm.splitCell(st), rowDel: pm.deleteRow(st), colDel: pm.deleteColumn(st)};
      for (const list of [tableRow, ctx]) for (const b of list.querySelectorAll('[data-ed-table]')) if (b.dataset.edTable in can) b.disabled = !can[b.dataset.edTable];
    }
    if (openName === 'symCircled') {
      const next = circledText();
      for (const b of panels.symCircled.children) b.classList.toggle('is-next', b.dataset.edSym === next);
    }
    // The pasted part being converted by itself shows nothing; one that could not convert, or a whole text of markdown letters,
    // shows the small offer.
    const offer = pasteKey.getState(st);
    const whole = !offer && !!wholeLetters(st);
    suggest.hidden = !(offer ? !offer.auto : whole);
    suggestText.textContent = whole ? '이 글에 마크다운 기호가 보여요.' : '마크다운 기호가 보여요.';
    root.toggleAttribute('data-ed-empty', isEmpty());
  }

  function getValue() { return cleanDoc({v: 'ed1', doc: view.state.doc.toJSON()}); }
  // NOTE-노션편집 ①(나): 블록 편집 on/off. pressed = from the [블록] switch (the opener is told, to keep the choice).
  function setBlocks(next, pressed = false) {
    if (!blockPart || !blocks) return false;
    blockPart.setOn(!!next);
    syncBlocksButton();
    if (pressed) blocks.onToggle?.(blockPart.isOn());
    syncBox();
    return blockPart.isOn();
  }
  // The ⠿ button on the row: wider = the 블록 모드 switch (pressed = on); a phone (P6) = '블록 메뉴', which opens a menu.
  function syncBlocksButton() {
    const b = buttons.blocks;
    if (!b || !blockPart) return;
    const menuMode = blockPart.isPhone(), name = menuMode ? '블록 메뉴' : '블록 모드';
    b.setAttribute('aria-label', name); b.title = name;
    const word = b.querySelector('.ed-tool-word'); if (word && word.textContent !== name) word.textContent = name;
    if (menuMode) { b.removeAttribute('aria-pressed'); b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', String(blockPart.menuOpenFor(b))); }
    else { b.setAttribute('aria-pressed', String(blockPart.isOn())); b.removeAttribute('aria-haspopup'); b.removeAttribute('aria-expanded'); }
  }
  function isEmpty() {
    const d = view.state.doc;
    return d.childCount === 1 && d.firstChild.type === N.paragraph && d.firstChild.content.size === 0;
  }
  syncLayout();
  built = true;
  paint();
  // S69-97: the first read of the linked Google tasks starts only now — its answer redraws (paint), which needs everything above
  // (an earlier start could answer during the '[[' part's import and paint before the toolbar's helpers exist).
  void gtaskPart?.sync();
  if (blocks) setBlocks(!!blocks.on);
  return {
    view, root, getValue, isEmpty, closeBoxes, hasBox: boxOpen,
    setBlocks: on => setBlocks(on), blocksOn: () => !!blockPart?.isOn(), syncTasks: () => gtaskPart?.sync(),
    getText: () => toPlain(getValue()),
    // ED③ 노트: put a whole saved form in (the big window hands its text back to the note's edit field). A fresh undo history.
    setValue(next) {
      const clean = cleanDoc(next) || emptyDoc();
      let d; try { d = pm.Node.fromJSON(schema, clean.doc); d.check(); } catch { return false; }
      let st = pm.EditorState.create({doc: d, plugins});
      if (!endsOpen(st.doc)) st = st.apply(st.tr.insert(st.doc.content.size, N.paragraph.create({style: DEFAULT_BODY})).setMeta('addToHistory', false));
      view.updateState(st); paint(); void gtaskPart?.sync(); return true;
    },
    focus: () => view.focus(),
    destroy() {
      resize?.disconnect(); phone?.removeEventListener?.('change', syncLayout); cancelAnimationFrame(fitFrame); clearTimeout(noteTimer);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('pointerup', syncSelection, true);
      window.removeEventListener('scroll', followPop, true);
      window.removeEventListener('resize', followPop);
      window.visualViewport?.removeEventListener('resize', followPop);
      window.visualViewport?.removeEventListener('scroll', followPop);
      window.removeEventListener('mouseup', release, true);
      stopUploads(); upRows.destroy(); for (const url of upPreview.values()) URL.revokeObjectURL(url); upPreview.clear();
      lineGone = true; touchPhone?.removeEventListener?.('change', syncTableGrips); lineGrip?.destroy(); blockPart?.destroy(); noteLinkPart?.destroy(); gtaskPart?.destroy();
      view.destroy();
      if (leadAt?.parent?.isConnected) leadAt.parent.insertBefore(lead, leadAt.next?.parentNode === leadAt.parent ? leadAt.next : null);
      root.remove();
    },
  };
}
