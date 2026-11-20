// NOTE-읽생기아이디어 ② 해시태그: 노트 본문(제목·raw_text, 이미 서버 저장)의 #낱말을 읽어 모은다. 따로 저장하지 않는다(같은 자료 두 번 저장 금지).
// 규칙: 줄 처음이나 띄어쓰기·괄호·따옴표 뒤의 '#' + 글자·숫자·_·-(1~40자, 글자가 하나는 있어야 함). '# 제목'(띄움)·'##'·주소 속 '#'·'#1755'는 태그가 아니다.
// 같은 태그는 대소문자를 가리지 않고 하나로 보고, 처음 나온 모양으로 보인다.
const TAG = /(^|[\s(\[{"'“‘·,])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,39})(?![\p{L}\p{N}_-])/gu;
const LETTER = /\p{L}/u;
export const tagKey = tag => String(tag || '').toLocaleLowerCase('ko');

export function noteTags(text) {
  const seen = new Map();
  for (const m of String(text || '').matchAll(TAG)) {
    const tag = m[2].replace(/[-_]+$/, '');
    if (!tag || !LETTER.test(tag)) continue;
    const key = tagKey(tag);
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

export const tagsOfNote = note => noteTags(`${note?.title || ''}\n${note?.raw_text || ''}`);

// 태그별 노트 수: 많은 순, 같으면 이름 차례. [{tag, key, count}]
export function tagGroups(notes) {
  const groups = new Map();
  for (const note of notes || []) for (const tag of tagsOfNote(note)) {
    const key = tagKey(tag), g = groups.get(key);
    if (g) g.count += 1; else groups.set(key, {tag, key, count: 1});
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'));
}

export const noteHasTag = (note, key) => tagsOfNote(note).some(tag => tagKey(tag) === key);

// S67-48 태그 칸: 노트 화면의 [+ 태그]·칩 ×도 원본은 본문의 #태그 하나다(따로 저장하는 표 없음).
// 붙이기 = 본문 끝 '태그 줄'(#낱말만 있는 마지막 문단)에 더하고, 없으면 그 줄을 새로 만든다. 빼기 = 제목·본문 어디에 있든 그 태그(대소문자 무시)를 지운다.
// 본문 중간의 #낱말도 그대로 태그다. 아래는 화면 없이 도는 계산(Node 시험이 돈다).
const TAG_MAX = 40;
// 입력 글 → 태그 낱말(앞의 # 떼고, 띄어쓰기는 _로). 태그가 될 수 없으면 null.
export function cleanTagInput(input) {
  const s = String(input ?? '').trim().replace(/^#+/, '').trim().replace(/\s+/g, '_').replace(/[-_]+$/, '');
  if (!s || [...s].length > TAG_MAX) return null;
  const got = noteTags('#' + s);
  return got.length === 1 && got[0] === s ? s : null;
}
export const TAG_INPUT_HELP = '태그는 글자를 하나 넣어 40자까지 써 주세요(기호는 _ - 만).';

// 글 s에서 key 태그가 차지한 자리 [시작, 끝) 목록. 앞(없으면 뒤)의 띄어쓰기 하나도 함께 지운다.
function tagRanges(s, key) {
  const out = [];
  for (const m of s.matchAll(TAG)) {
    const tag = m[2].replace(/[-_]+$/, '');
    if (!tag || !LETTER.test(tag) || tagKey(tag) !== key) continue;
    let start = m.index + m[1].length, end = start + 1 + m[2].length;
    if (m[1] === ' ' || m[1] === '\t') start -= 1;
    else if (s[end] === ' ') end += 1;
    out.push([start, end]);
  }
  return out;
}
const cut = (s, ranges) => { let out = '', at = 0; for (const [a, b] of ranges) { out += s.slice(at, a); at = b; } return out + s.slice(at); };

// 제목에서 태그 빼기(제목 속 #도 태그로 읽으므로).
export function removeTagFromTitle(title, key) {
  const s = String(title ?? ''), ranges = tagRanges(s, key);
  return ranges.length ? cut(s, ranges).replace(/ {2,}/g, ' ').trim() : s;
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const rootOf = value => isObj(value) && isObj(value.doc) && value.doc.type === 'doc' ? value.doc : isObj(value) && value.type === 'doc' ? value : null;
const inlineText = n => n?.type === 'text' ? String(n.text || '') : n?.type === 'hard_break' ? '\n' : '￼';
const isTextblock = node => Array.isArray(node?.content) && node.content.some(c => c?.type === 'text');
const blockText = node => (node?.content || []).map(inlineText).join('');
const blank = node => node?.type === 'paragraph' && !blockText(node).trim();

// 글 줄(문단·제목 등)의 글자 조각에서 ranges 자리를 지운다(서식은 조각마다 그대로).
function cutInline(content, ranges) {
  const out = []; let pos = 0;
  for (const c of content) {
    const len = inlineText(c).length, a = pos, b = pos + len; pos = b;
    if (c?.type !== 'text') { if (!ranges.some(([x, y]) => x <= a && b <= y)) out.push(c); continue; }
    const local = ranges.filter(([x, y]) => x < b && y > a).map(([x, y]) => [Math.max(x, a) - a, Math.min(y, b) - a]);
    const text = local.length ? cut(c.text, local) : c.text;
    if (text) out.push({...c, text});
  }
  return out;
}
function dropIn(list, key, top) {
  const out = []; let changed = false;
  for (const node of list || []) {
    if (!isObj(node)) { out.push(node); continue; }
    if (isTextblock(node)) {
      const s = blockText(node), ranges = tagRanges(s, key);
      if (!ranges.length) { out.push(node); continue; }
      changed = true;
      const content = cutInline(node.content, ranges);
      // 문단 안 줄바꿈 줄이 통째로 태그였으면 남는 줄바꿈(앞뒤 끝)을 치운다.
      while (content.length && content[content.length - 1]?.type === 'hard_break') content.pop();
      while (content.length && content[0]?.type === 'hard_break') content.shift();
      // 태그만 있던 맨 위 문단(태그 줄)은 통째로 없앤다. 다른 글이 남으면 그 글은 그대로.
      if (top && node.type === 'paragraph' && !content.map(inlineText).join('').trim()) continue;
      out.push({...node, content});
      continue;
    }
    if (Array.isArray(node.content)) {
      const inner = dropIn(node.content, key, false);
      if (inner.changed) { changed = true; out.push({...node, content: inner.list}); continue; }
    }
    out.push(node);
  }
  return {list: out, changed};
}
// 본문(저장된 모양 {v,doc})에서 key 태그를 모두 뺀 새 모양. 바뀐 것이 없으면 null.
export function removeTagFromDoc(value, key) {
  const root = rootOf(value); if (!root) return null;
  const {list, changed} = dropIn(root.content, key, true);
  if (!changed) return null;
  return {v: 'ed1', doc: {type: 'doc', content: list.length ? list : [{type: 'paragraph', attrs: {style: 'body2'}}]}};
}
// 태그 줄: #낱말과 띄어쓰기만 있는 문단, 또는 문단 안 줄바꿈 뒤 마지막 줄(옛 글자 노트는 줄이 한 문단 안 줄바꿈이다).
export function isTagLine(node) {
  if (node?.type !== 'paragraph' || !isTextblock(node)) return false;
  const all = blockText(node), s = all.slice(all.lastIndexOf('\n') + 1), words = s.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(w => w.startsWith('#')) && noteTags(s).length === words.length;
}
// 본문 끝 태그 줄에 #tag를 더한 새 모양(이미 그 태그가 본문에 있으면 null). 태그 줄이 없으면 맨 끝에 새 줄.
export function addTagToDoc(value, tag, style = 'body2') {
  const root = rootOf(value) || {type: 'doc', content: []};
  const word = cleanTagInput(tag); if (!word) return null;
  const key = tagKey(word), content = [...(root.content || [])];
  if (noteTags(content.map(n => blockOrDeep(n)).join('\n')).some(t => tagKey(t) === key)) return null;
  while (content.length && blank(content[content.length - 1])) content.pop();
  const last = content[content.length - 1];
  if (isTagLine(last)) {
    const inner = [...last.content], end = inner[inner.length - 1];
    const sep = /\s$/.test(blockText(last)) ? '' : ' ';
    if (end?.type === 'text' && !(end.marks && end.marks.length)) inner[inner.length - 1] = {...end, text: end.text + sep + '#' + word};
    else inner.push({type: 'text', text: sep + '#' + word});
    content[content.length - 1] = {...last, content: inner};
  } else content.push({type: 'paragraph', attrs: {style}, content: [{type: 'text', text: '#' + word}]});
  return {v: 'ed1', doc: {type: 'doc', content}};
}
function blockOrDeep(node) {
  if (!isObj(node)) return '';
  if (isTextblock(node)) return blockText(node);
  return (node.content || []).map(blockOrDeep).join('\n');
}
