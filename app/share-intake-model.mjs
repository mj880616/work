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
  return {id:data.id, subject:clean(data.subject, 1000).trim(), text:clean(data.text, 100000), items};
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
