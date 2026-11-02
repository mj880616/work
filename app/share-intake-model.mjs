// APP-폰앱새로 ② 공유로 바구니 넣기: 폰 앱이 넘긴 "받은 항목 목록"을 읽고, 알림 문구와 저장할 글을 만드는 규칙(SHARE-바로넣기: 확인 줄 없이 바로 넣음).
// 화면·네트워크를 쓰지 않는다(단위 시험 tests/share-intake-model.test.mjs). 한도는 basket-upload.js·basket-data.js와 같다.
export const SHARE_MAX_FILES = 20;
export const SHARE_MAX_BYTES = 100 * 1024 * 1024;
export const SHARE_MAX_TEXT = 20000;
export const SHARE_MEMO_MAX = 500;
const ID = /^[A-Za-z0-9_-]{22,64}$/;
const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;

export const isShareId = value => typeof value === 'string' && ID.test(value);

const clean = (value, max) => [...String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')].slice(0, max).join('');
const fileName = (value, index) => clean(value, 200).replace(/[\n\t/\\]+/g, ' ').trim() || `공유 파일 ${index + 1}`;

/** 앱의 'share:list:' JSON을 읽는다. 모양이 맞지 않으면 null. */
export function parseShareList(json) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return null; }
  if (!data || typeof data !== 'object' || !isShareId(data.id) || !Array.isArray(data.items)) return null;
  const items = [];
  for (const raw of data.items.slice(0, 100)) {
    const index = Number(raw?.i);
    if (!Number.isInteger(index) || index < 0 || index > 99 || items.some(item => item.index === index)) continue;
    const type = String(raw?.type || '').toLowerCase();
    const size = Number(raw?.size);
    items.push({index, name:fileName(raw?.name, index), type:MIME.test(type) ? type : 'application/octet-stream', size:Number.isFinite(size) && size >= 0 ? Math.floor(size) : -1});
  }
  return {id:data.id, subject:clean(data.subject, 1000).trim(), text:clean(data.text, 100000), items, target:shareTarget(data.target)};
}

// ── APP-공유노트할일(앱 0.4.8): 공유 창의 세 칸 '웹2 정리함'·'웹2 노트'·'웹2 할 일'. 받기 길은 같고 들어갈 곳만 다르다. ──
export const SHARE_TARGETS = Object.freeze(['basket', 'note', 'task']);
/** 앱이 알려 준 들어갈 곳. 모르는 값·없음(0.4.7 이하 앱)은 정리함. */
export const shareTarget = value => SHARE_TARGETS.includes(value) ? value : 'basket';
export const SHARE_NOTE_TITLE_MAX = 200;
export const SHARE_NOTE_MAX = 100000;
export const SHARE_TASK_TITLE_MAX = 1024;
export const SHARE_TASK_NOTES_MAX = 8192;
export const SHARE_TASK_FILES_MAX = 10;
const LINK = /https?:\/\/[^\s<>"']+/gi;
const cut = (value, max) => [...String(value ?? '')].slice(0, max).join('');
const oneLine = value => clean(value, SHARE_MEMO_MAX).replace(/\s*\n+\s*/g, ' ').trim();
const linesOf = value => String(value ?? '').split('\n').map(line => line.trim()).filter(Boolean);

/** 글 속 링크(같은 것은 한 번, 20개까지). 끝에 붙은 문장부호는 뺀다. */
export function shareLinks(text) {
  const out = [];
  for (const raw of String(text ?? '').match(LINK) || []) {
    const link = raw.replace(/[).,!?;:'"\]]+$/, '');
    if (link && !out.includes(link)) out.push(link);
    if (out.length >= 20) break;
  }
  return out;
}

/** 글이 링크뿐인가(브라우저 [공유]: 글 = 주소, 제목 = 페이지 제목). */
const onlyLinks = text => !!String(text ?? '').trim() && !String(text).replace(LINK, ' ').trim();

/**
 * 노트로 넣을 제목·본문. 제목 = 받은 글의 첫 줄, 글이 링크뿐이면 링크 제목(subject), 둘 다 없으면 한 줄 더하기 → 첫 파일 이름.
 * 본문 = 한 줄 더하기 → 링크 제목(본문에 없을 때) → 받은 글. 노트 한도(본문 100,000자·제목 200자) 안으로 자른다.
 */
export function shareNoteDraft({subject = '', text = '', items = [], extra = ''} = {}) {
  const body = String(text ?? '').trim(), line = oneLine(extra), head = String(subject ?? '').trim();
  const first = (linesOf(body)[0] || '').replace(/^#{1,6}\s+/, '');
  const title = ((onlyLinks(body) || !body) && head ? head : first || head || line || String(items[0]?.name || '')).trim();
  const raw = [line, head && !body.includes(head) ? head : '', body].filter(Boolean).join('\n');
  const fit = fitText(raw, SHARE_NOTE_MAX);
  return {title:cut(title.replace(/[\r\n]+/g, ' '), SHARE_NOTE_TITLE_MAX).trim(), raw_text:fit.text, cut:fit.cut};
}

/**
 * 할 일로 넣을 제목·메모. 제목 = 받은 글(링크를 뺀 첫 줄) 또는 링크 제목, 없으면 첫 링크 → 첫 파일 이름.
 * 메모 = 링크 제목(제목으로 쓰지 않았을 때) → 나머지 글 줄 → 링크. 구글 할 일 한도(제목 1,024자·메모 8,192자) 안으로 자른다.
 * title(사용자가 작은 창에서 고친 제목)이 있으면 그것을 제목으로 쓴다.
 */
export function shareTaskDraft({subject = '', text = '', items = [], title = null} = {}) {
  const body = String(text ?? '').trim(), head = String(subject ?? '').trim(), links = shareLinks(body);
  const rest = linesOf(body.replace(LINK, ' ')).map(line => line.replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
  const auto = rest[0] || head || links[0] || String(items[0]?.name || '').trim();
  const chosen = typeof title === 'string' && title.trim() ? oneLine(title) || title.trim() : auto;
  const notes = [head && head !== chosen && !body.includes(head) ? head : '', ...rest.filter((line, i) => !(i === 0 && line === chosen)), ...links.filter(link => link !== chosen)];
  return {title:cut(chosen.replace(/[\r\n]+/g, ' '), SHARE_TASK_TITLE_MAX).trim(), notes:cut(notes.filter(Boolean).join('\n'), SHARE_TASK_NOTES_MAX), auto:cut(auto, SHARE_TASK_TITLE_MAX)};
}

/** 할 일에 붙일 파일(구글 할 일 첨부 한도 10개). 넘는 것은 뺀 수로 알린다. */
export function shareTaskFiles(files = []) {
  const list = Array.from(files || []);
  return {keep:list.slice(0, SHARE_TASK_FILES_MAX), over:Math.max(0, list.length - SHARE_TASK_FILES_MAX)};
}

/** 서버 한도에 맞는 것만 고른다(빈 파일·100MB 넘는 파일·21번째부터는 뺀다). 크기를 모르면 받은 뒤 다시 본다. */
export function pickShareItems(items) {
  const keep = [], skipped = {empty:0, large:0, over:0};
  for (const item of items) {
    if (item.size === 0) { skipped.empty++; continue; }
    if (item.size > SHARE_MAX_BYTES) { skipped.large++; continue; }
    if (keep.length >= SHARE_MAX_FILES) { skipped.over++; continue; }
    keep.push(item);
  }
  return {keep, skipped};
}

const isPhoto = item => /^image\//.test(item.type);

/** 확인 줄 한 줄: "사진 3 · 파일 1 (12.4MB)", 글만 있으면 "글 1". */
export function shareSummary({items = [], text = '', subject = ''}, skipped = {}) {
  const photos = items.filter(isPhoto).length, files = items.length - photos;
  const known = items.filter(item => item.size > 0).reduce((sum, item) => sum + item.size, 0);
  const parts = [];
  if (photos) parts.push(`사진 ${photos}`);
  if (files) parts.push(`파일 ${files}`);
  if (!parts.length && (text.trim() || subject.trim())) parts.push('글 1');
  let line = parts.join(' · ') || '넣을 것 없음';
  if (known) line += ` (${sizeText(known)})`;
  const left = skippedText(skipped);
  if (left) line += ` · ${left}`;
  return line;
}

/** 넣지 않고 뺀 것 한 줄: "뺌: 100MB 넘는 파일 1개, 빈 파일 1개". 없으면 ''. failed는 받다가 읽지 못한 것. */
export function skippedText(skipped = {}) {
  const left = [];
  if (skipped.failed) left.push(`읽지 못한 파일 ${skipped.failed}개`);
  if (skipped.large) left.push(`100MB 넘는 파일 ${skipped.large}개`);
  if (skipped.empty) left.push(`빈 파일 ${skipped.empty}개`);
  if (skipped.over) left.push(`20개 넘는 ${skipped.over}개`);
  return left.length ? `뺌: ${left.join(', ')}` : '';
}

export const sizeText = size => size >= 1048576 ? `${(size / 1048576).toFixed(1)}MB` : size >= 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;

/** CRLF로 바꿔 셀 때(basket-upload.js validateBatch)도 20,000자 안에 들도록 자른다. */
export function fitText(value, max = SHARE_MAX_TEXT) {
  const chars = [...String(value ?? '')];
  let used = 0, end = 0;
  for (; end < chars.length; end++) {
    const cost = chars[end] === '\n' ? 2 : 1;
    if (used + cost > max) break;
    used += cost;
  }
  return {text:chars.slice(0, end).join(''), cut:end < chars.length};
}

/** 저장할 바구니 글: 메모 한 줄 → 제목(글에 이미 없을 때) → 받은 글. */
export function shareRawText({memo = '', subject = '', text = ''}) {
  const line = clean(memo, SHARE_MEMO_MAX).replace(/\n+/g, ' ').trim();
  const body = String(text ?? '').trim();
  const title = subject && !body.includes(subject) ? subject : '';
  return fitText([line, title, body].filter(Boolean).join('\n'));
}

/** 공유로 넣은 뒤 [메모 달기]: 한 줄 메모를 기존 글 맨 앞에 붙인 새 글. 메모가 비면 null. 기존 글은 그대로 둔다. */
export function withMemo(memo, existing = '') {
  const line = clean(memo, SHARE_MEMO_MAX).replace(/\n+/g, ' ').trim();
  if (!line) return null;
  const body = String(existing ?? '');
  return fitText(body.trim() ? `${line}\n${body}` : line);
}
