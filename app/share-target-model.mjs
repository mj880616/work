// APP-공유노트할일(요청함 11/02 00:22): 폰 공유 창의 '웹2 노트'·'웹2 할 일'로 받은 것을 노트·할 일 초안으로 바꾸는 규칙.
// 화면·네트워크를 쓰지 않는다(단위 시험 tests/share-target-model.test.mjs). 받은 글은 외부 입력이라 글자로만 다룬다(HTML로 넣지 않음).
// 한도: 노트 제목 200자·본문 100,000자(basket-data.js NOTE_LIMITS), 할 일 제목 1,024자·메모 8,192자(위젯 빠른 쓰기와 같음).
export const SHARE_TARGETS = Object.freeze(['basket', 'note', 'task']);
export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 100000;
export const TASK_TITLE_MAX = 1024;
export const TASK_NOTES_MAX = 8192;
export const EXTRA_MAX = 500;

export const shareTarget = value => (value === 'note' || value === 'task' ? value : 'basket');

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const chars = value => [...String(value ?? '')];
const cut = (value, max) => chars(value).slice(0, max).join('');
const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** 글 속 링크들(중복 없이, 순서대로). 끝의 문장부호는 뺀다. */
export function linksIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(URL_RE)) {
    const url = m[0].replace(/[).,;!?。、]+$/u, '');
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** 링크를 뺀 글(줄마다 앞뒤 빈칸 정리, 빈 줄 겹침 줄임). */
export function withoutLinks(text) {
  return String(text ?? '').replace(URL_RE, '').split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const firstLine = text => String(text ?? '').split('\n').map(line => line.trim()).find(Boolean) || '';
const fileBase = name => oneLine(name).replace(/\.[A-Za-z0-9]{1,8}$/, '');

/**
 * 노트 초안. 제목 = 링크 공유면 보낸 앱이 준 제목(subject, 보통 링크 제목) → 글 첫 줄 → 첫 파일 이름 → '공유한 노트'.
 * 본문 = 보낸 글 그대로(링크 포함). 링크만 왔고 제목이 따로 있으면 본문은 링크만.
 */
export function noteDraft({subject = '', text = '', files = []} = {}) {
  const body = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  const hasLink = linksIn(body).length > 0;
  const subj = oneLine(subject);
  const plain = firstLine(withoutLinks(body));
  const title = (hasLink && subj) || oneLine(plain) || subj || (hasLink ? oneLine(linksIn(body)[0]) : '') || fileBase(files[0]?.name) || '공유한 노트';
  return {title:cut(title, NOTE_TITLE_MAX), body:cut(body, NOTE_BODY_MAX)};
}

/** 한 줄 더하기: 비어 있지 않으면 본문 맨 앞 줄로(빈 줄 하나 띄움). */
export function noteBodyWithExtra(body, extra) {
  const line = oneLine(extra).slice(0, EXTRA_MAX);
  if (!line) return cut(body, NOTE_BODY_MAX);
  return cut(body ? `${line}\n\n${body}` : line, NOTE_BODY_MAX);
}

/**
 * 할 일 초안. 제목 = 링크를 뺀 글의 첫 줄 → 보낸 앱이 준 제목(링크 제목) → 첫 파일 이름 → 첫 링크. 메모 = 나머지 글 + 링크(한 줄에 하나).
 */
export function taskDraft({subject = '', text = '', files = []} = {}) {
  const body = String(text ?? '').replace(/\r\n?/g, '\n');
  const links = linksIn(body);
  const lines = withoutLinks(body).split('\n').map(line => line.trim()).filter(Boolean);
  const first = lines[0] || '';
  const subj = oneLine(subject);
  const title = oneLine(first) || subj || fileBase(files[0]?.name) || links[0] || '';
  const others = lines.slice(1);
  if (first && subj && subj !== title) others.unshift(subj);
  const notes = [...others, ...links].join('\n');
  return {title:cut(title, TASK_TITLE_MAX), notes:cut(notes, TASK_NOTES_MAX)};
}

/** 할 일 메모에 한 줄 더하기(맨 앞). */
export function taskNotesWithExtra(notes, extra) {
  const line = oneLine(extra).slice(0, EXTRA_MAX);
  return cut(line ? (notes ? `${line}\n${notes}` : line) : notes, TASK_NOTES_MAX);
}

/** 노트 폴더 표(parent_id 나무)를 고르기 줄로: 위에서부터 깊이 순서, 깊이는 들여쓰기 글자 수로 쓴다. 고리·주인 없는 폴더는 맨 위로. */
export function folderOptions(folders = []) {
  const list = (Array.isArray(folders) ? folders : []).filter(f => f && typeof f.id === 'string' && String(f.name || '').trim());
  const ids = new Set(list.map(f => f.id));
  const kids = new Map();
  for (const f of list) {
    const parent = f.parent_id && ids.has(f.parent_id) && f.parent_id !== f.id ? f.parent_id : '';
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(f);
  }
  const out = [], seen = new Set();
  const walk = (parent, depth) => {
    for (const f of kids.get(parent) || []) {
      if (seen.has(f.id) || depth > 100) continue;
      seen.add(f.id);
      out.push({id:f.id, name:oneLine(f.name), depth});
      walk(f.id, depth + 1);
    }
  };
  walk('', 0);
  for (const f of list) if (!seen.has(f.id)) { seen.add(f.id); out.push({id:f.id, name:oneLine(f.name), depth:0}); }
  return out;
}
