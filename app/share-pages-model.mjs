// SHARE-현장공유 PR 2: block shapes and checks for share pages (app_share_pages.blocks), shared by the Web2 editor
// (share-pages.js) and its tests. The database keeps the outer limits (6 types, 60 blocks, 256KB as jsonb text);
// the shape inside a block is decided here. The Web1 reader (share/share.js) reads the same shapes and draws text only.
// Because that reader imports this file, it keeps to syntax older Samsung Internet parses (no ?. or ??; BUG-공유페이지삼성).
//   summary  {type, text}                                 한 줄 현황
//   stages   {type, title, items:[{name}], current}       진행 단계 (current = 지금 단계 번호, 0부터)
//   schedule {type, title, items:[{date, text}]}         일정
//   issues   {type, title, items:[{title, body}]}        쟁점·요구
//   links    {type, title, items:[{label, url}]}         자료·링크 (http·https만)
//   updates  {type, title, items:[{date, text}]}         업데이트 기록
//   doc      {type, doc:{v:'ed1', doc:{…}}}               글(ED-통합편집기 ①b: 새 편집기 한 칸, 모양은 ed-schema.mjs가 정함)
// BLOCK_TYPES are the six old kinds offered by [+ 블록]; a new page starts with one 'doc' block instead (설계 결정 6 가).
// ALL_TYPES is what may be saved and drawn (the DB check allows the same seven).
import {cleanDoc, emptyDoc, isEmptyDoc} from './ed-schema.mjs';
export const BLOCK_TYPES = ['summary', 'stages', 'schedule', 'issues', 'links', 'updates'];
export const ALL_TYPES = BLOCK_TYPES.concat(['doc']);
export const BLOCK_LABELS = {summary:'한 줄 현황', stages:'진행 단계', schedule:'일정', issues:'쟁점·요구', links:'자료·링크', updates:'업데이트 기록', doc:'글'};
// [field, label, max characters, multiline]
export const ITEM_FIELDS = {
  stages: [['name', '단계 이름', 60, false]],
  schedule: [['date', '날짜', 40, false], ['text', '내용', 500, false]],
  issues: [['title', '쟁점', 200, false], ['body', '설명·요구', 2000, true]],
  links: [['label', '이름', 200, false], ['url', '주소 (https://…)', 2000, false]],
  updates: [['date', '날짜', 40, false], ['text', '내용', 2000, true]],
};
// DB: 60 blocks and 262144 bytes of jsonb text. The client stops a little earlier so a save never meets the DB check.
export const LIMITS = {blocks:60, items:50, bytes:250000, docBytes:240000, title:200, summary:500, blockTitle:100, label:60};
export const SHARE_ORIGIN = 'https://work.bokdoong.com';
export const SHARE_PATH = '/work/share/';

const length = value => [...String(value == null ? '' : value)].length;
// Control characters are refused by the DB for titles and labels; inside blocks they are simply removed (line breaks stay
// in multi-line fields).
export function cleanText(value, max, {multiline = false} = {}) {
  let text = String(value == null ? '' : value).replace(/\r\n?/g, '\n');
  text = multiline ? text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  text = text.trim();
  return length(text) > max ? [...text].slice(0, max).join('') : text;
}
export const hasControl = value => /[\u0000-\u001f\u007f]/.test(String(value == null ? '' : value));

export function newBlock(type) {
  if (ALL_TYPES.indexOf(type) < 0) throw new Error('알 수 없는 블록입니다.');
  if (type === 'doc') return {type, doc:emptyDoc()};
  if (type === 'summary') return {type, text:''};
  const block = {type, title:'', items:[newItem(type)]};
  if (type === 'stages') block.current = 0;
  return block;
}
export function newItem(type) {
  return Object.fromEntries((ITEM_FIELDS[type] || []).map(([field]) => [field, '']));
}
// Returns a new array; moving past either end leaves the order as it was.
export function moveBlock(blocks, index, delta) {
  const next = [...blocks], to = index + delta;
  if (index < 0 || index >= next.length || to < 0 || to >= next.length) return next;
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value == null ? '' : value).trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

// The saved form: trimmed text, empty rows dropped, only known fields, stage number inside the list.
export function normalizeBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).filter(b => ALL_TYPES.indexOf(b && b.type) >= 0).map(block => {
    if (block.type === 'doc') return {type:'doc', doc:cleanDoc(block.doc) || emptyDoc()};
    if (block.type === 'summary') return {type:'summary', text:cleanText(block.text, LIMITS.summary)};
    const fields = ITEM_FIELDS[block.type];
    const items = (Array.isArray(block.items) ? block.items : []).map(item => Object.fromEntries(fields.map(([field, , max, multiline]) =>
      [field, cleanText(item ? item[field] : undefined, max, {multiline})]))).filter(item => fields.some(([field]) => item[field]));
    const out = {type:block.type, title:cleanText(block.title, LIMITS.blockTitle), items};
    if (block.type === 'stages') {
      const current = Number.isInteger(block.current) ? block.current : 0;
      out.current = items.length ? Math.min(Math.max(current, 0), items.length - 1) : 0;
    }
    return out;
  });
}

// Bytes of the value as PostgreSQL prints jsonb (a space after every ':' and ','), the size the DB check measures.
export function jsonbTextBytes(value) {
  const utf8 = text => new TextEncoder().encode(text).length;
  if (Array.isArray(value)) return 2 + value.reduce((n, v) => n + jsonbTextBytes(v), 0) + Math.max(0, value.length - 1) * 2;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return 2 + entries.reduce((n, [k, v]) => n + utf8(JSON.stringify(k)) + 2 + jsonbTextBytes(v), 0) + Math.max(0, entries.length - 1) * 2;
  }
  return utf8(JSON.stringify(value == null ? null : value));
}

// Checks the saved form. Returns a message for the owner, or '' when it can be saved.
export function pageProblem({title, blocks}) {
  const name = String(title == null ? '' : title).trim();
  if (!name) return '제목을 입력해 주세요.';
  if (length(name) > LIMITS.title) return `제목은 ${LIMITS.title}자까지 쓸 수 있어요.`;
  if (hasControl(name)) return '제목에 쓸 수 없는 글자가 있어요.';
  if (!Array.isArray(blocks)) return '블록을 확인해 주세요.';
  if (blocks.length > LIMITS.blocks) return `블록은 ${LIMITS.blocks}개까지 둘 수 있어요.`;
  for (const block of blocks) {
    if (ALL_TYPES.indexOf(block && block.type) < 0) return '알 수 없는 블록이 있어요.';
    if (block.type === 'doc' && jsonbTextBytes(block.doc) > LIMITS.docBytes) return '글이 너무 길어요. 나눠서 써 주세요.';
    if (Array.isArray(block.items) && block.items.length > LIMITS.items) return `${BLOCK_LABELS[block.type]}의 줄은 ${LIMITS.items}개까지예요.`;
    if (block.type === 'links') for (const item of block.items || []) if (item.url && !safeUrl(item.url)) return '자료·링크 주소는 http:// 또는 https://로 시작해야 해요.';
    if (block.type === 'links') for (const item of block.items || []) if (!item.url && item.label) return '자료·링크에 주소가 없는 줄이 있어요.';
  }
  if (jsonbTextBytes(blocks) > LIMITS.bytes) return '내용이 너무 길어요. 블록이나 줄을 줄여 주세요.';
  return '';
}

export function labelProblem(label) {
  const text = String(label == null ? '' : label).trim();
  if (!text) return '받는 사람 이름표를 입력해 주세요(예: ○○지부).';
  if (length(text) > LIMITS.label) return `이름표는 ${LIMITS.label}자까지예요.`;
  if (hasControl(text)) return '이름표에 쓸 수 없는 글자가 있어요.';
  return '';
}

// A chosen expiry date means "until the end of that day" in Korea. '' means no expiry (S3).
export function expiresAt(day, now = Date.now()) {
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('기한 날짜를 확인해 주세요.');
  const iso = `${day}T23:59:59+09:00`, at = Date.parse(iso);
  if (!Number.isFinite(at)) throw new Error('기한 날짜를 확인해 주세요.');
  if (at <= now) throw new Error('기한은 오늘이나 그 뒤 날짜로 골라 주세요.');
  return iso;
}
export function linkState(link, now = Date.now()) {
  if (link && link.disabled_at) return 'off';
  if (link && link.expires_at && Date.parse(link.expires_at) <= now) return 'expired';
  return 'on';
}
export function shareUrl(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw new Error('링크 값을 확인할 수 없어요.');
  // SHARE-미리보기제목: ?t= (not #t=) so the Worker can show the page title on link-preview cards. share/share.js
  // moves the value to # as soon as the page opens; older #t= links keep working.
  return `${SHARE_ORIGIN}${SHARE_PATH}?t=${token}`;
}

// True when the block has nothing a reader would see.
export function blockIsEmpty(block) {
  if (!block) return true;
  if (block.type === 'doc') return isEmptyDoc(block.doc);
  if (block.type === 'summary') return !String(block.text || '').trim();
  return !(block.items || []).some(item => Object.keys(item || {}).some(k => String(item[k] || '').trim()));
}

// [새 편집기로 바꾸기] (설계 4.2): the old blocks of a page → one 'doc' block, keeping every letter. Shapes:
//   한 줄 현황 → 본문 1 문단 · 진행 단계 → 번호 목록(지금 단계는 굵게 + "(지금)") · 일정 → 2칸 표(날짜·내용)
//   쟁점·요구 → 제목 3 + 문단 · 자료·링크 → 링크 목록(http·https만 링크, 나머지는 글자) · 업데이트 기록 → 날짜 굵게 + 문단 목록
// A block title (or the kind's name) becomes a 제목 2 above it. Existing 'doc' blocks keep their content in place.
const para = (text, style, marks) => {
  const lines = String(text == null ? '' : text).split('\n'), content = [];
  lines.forEach((line, i) => {
    if (i) content.push({type:'hard_break'});
    if (line) content.push(marks ? {type:'text', text:line, marks:marks} : {type:'text', text:line});
  });
  const node = {type:'paragraph', attrs:{style:style || 'body2'}};
  if (content.length) node.content = content;
  return node;
};
const heading = (text, level) => ({type:'heading', attrs:{level:level}, content:text ? [{type:'text', text:text}] : []});
const item = content => ({type:'list_item', content:content});
const STRONG = [{type:'strong'}];
function blockNodes(block) {
  const b = normalizeBlocks([block])[0];
  if (!b) return [];
  if (b.type === 'doc') return b.doc.doc.content;
  if (b.type === 'summary') return b.text ? [para(b.text, 'body1')] : [];
  if (!b.items.length && !b.title) return [];
  const out = [heading(b.title || BLOCK_LABELS[b.type], 2)];
  if (b.type === 'stages') {
    out.push({type:'ordered_list', attrs:{order:1}, content:b.items.map((it, i) => item([i === b.current
      ? {type:'paragraph', attrs:{style:'body2'}, content:[{type:'text', text:it.name + ' (지금)', marks:STRONG}]}
      : para(it.name)]))});
  } else if (b.type === 'schedule') {
    const cell = (type, text) => ({type:type, attrs:{colspan:1, rowspan:1}, content:[para(text)]});
    out.push({type:'table', content:[{type:'table_row', content:[cell('table_header', '날짜'), cell('table_header', '내용')]}]
      .concat(b.items.map(it => ({type:'table_row', content:[cell('table_cell', it.date), cell('table_cell', it.text)]})))});
  } else if (b.type === 'issues') {
    b.items.forEach(it => { if (it.title) out.push(heading(it.title, 3)); if (it.body) out.push(para(it.body)); });
  } else if (b.type === 'links') {
    out.push({type:'bullet_list', content:b.items.map(it => {
      const url = safeUrl(it.url), label = it.label || it.url || '';
      return item([url ? {type:'paragraph', attrs:{style:'body2'}, content:[{type:'text', text:label, marks:[{type:'link', attrs:{href:url}}]}]}
        : para(label + (it.url && it.url !== label ? ' ' + it.url : ''))]);
    })});
  } else if (b.type === 'updates') {
    out.push({type:'bullet_list', content:b.items.map(it => {
      const p = para(it.text);
      if (it.date) p.content = [{type:'text', text:it.date, marks:STRONG}, {type:'text', text:' '}].concat(p.content || []);
      return item([p]);
    })});
  }
  return out;
}
export function blocksToDoc(blocks) {
  const content = [];
  (Array.isArray(blocks) ? blocks : []).forEach(block => { blockNodes(block).forEach(n => content.push(n)); });
  return {type:'doc', doc:cleanDoc({type:'doc', content:content}) || emptyDoc()};
}
