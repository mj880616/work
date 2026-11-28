// APP-폰앱새로 ② 공유로 바구니 넣기: 폰 앱이 넘긴 "받은 항목 목록"을 읽고, 알림 문구와 저장할 글을 만드는 규칙(SHARE-바로넣기: 확인 줄 없이 바로 넣음).
// 화면·네트워크를 쓰지 않는다(단위 시험 tests/share-intake-model.test.mjs). 한도는 basket-upload.js·basket-data.js와 같다.
export const SHARE_MAX_FILES = 20;
export const SHARE_MAX_BYTES = 100 * 1024 * 1024;
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
  // APP-공유노트할일: 공유 창에서 고른 칸(정리함·노트·할 일). S62-22 APP-공유로뉴스보관: 'News 보관'(news). S68-09: '읽을 거리'(reading). 정해진 낱말 밖은 모두 정리함(이전과 같음).
  const target = ['note', 'task', 'news', 'reading'].includes(data.target) ? data.target : 'basket';
  return {id:data.id, subject:clean(data.subject, 1000).trim(), text:clean(data.text, 100000), items, target};
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

// S62-22 APP-공유로뉴스보관: 공유된 글(본문 먼저, 그다음 제목)에서 기사 주소(http·https) 하나. 없으면 ''.
// 브라우저 [공유]는 보통 '제목\n주소' 또는 주소 하나를 넘긴다. 끝에 붙은 문장부호·닫는 괄호는 뗀다. 서버(news-feed save_url)가 다시 검사한다.
export const SHARE_URL_MAX = 2000;
export function shareArticleUrl({subject = '', text = ''} = {}) {
  for (const src of [text, subject]) {
    for (const m of String(src ?? '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
      let url = m[0];
      while (/[.,;:!?…)\]}>'"”’」』）]$/.test(url)) {
        if (url.endsWith(')') && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
        url = url.slice(0, -1);
      }
      if (url.length > SHARE_URL_MAX) continue;
      try { const u = new URL(url); if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.')) return u.href; } catch { /* 다음 주소 */ }
    }
  }
  // S70-44: 텔레그램 공지처럼 단축 주소를 앞머리 없이('bit.ly/…') 쓴 글. 이름이 알려진 단축 주소만 https로 본다(아무 'a.b/c'나 주소로 보지 않음).
  // 실제 기사 주소까지 따라가는 일·주소 검사는 서버(note-import·news-feed)가 그대로 한다.
  for (const src of [text, subject]) {
    const m = SHORT_BARE.exec(String(src ?? ''));
    if (m) { try { return new URL(`https://${m[1]}`).href; } catch { /* 없음 */ } }
  }
  return '';
}
const SHORT_BARE_ALL = /(?:bit\.ly|han\.gl|me2\.do|url\.kr|buly\.kr|vo\.la|naver\.me|kko\.to|lrl\.kr|tinyurl\.com|t\.ly|c11\.kr|zrr\.kr|abit\.ly|goo\.gl)\/[A-Za-z0-9_\-]{2,64}/gi;
const SHORT_BARE = /(?:^|[\s(\[<"'“‘\p{Extended_Pictographic}:])((?:bit\.ly|han\.gl|me2\.do|url\.kr|buly\.kr|vo\.la|naver\.me|kko\.to|lrl\.kr|tinyurl\.com|t\.ly|c11\.kr|zrr\.kr|abit\.ly|goo\.gl)\/[A-Za-z0-9_\-]{2,64})(?![A-Za-z0-9_\-./])/iu;

// S67-10 NEWS-네이버공유읽기: 공유된 글에서 기사 제목 한 줄(서버 news-feed save_url의 title). 원문을 못 읽었을 때만 서버가 기사 제목으로 쓴다.
// 제목(subject)이 주소가 아니면 그것, 아니면 본문에서 주소를 뺀 첫 줄. 없으면 ''. 서버가 다시 다듬고 검사한다(글자로만, SHARE_TITLE_MAX자).
export const SHARE_TITLE_SEND_MAX = 1000;
// S70-44: 줄 안의 주소(앞머리 없는 단축 주소 포함)·그림 글자(이모지)는 빼고, 줄 전체를 감싼 따옴표만 벗긴다(줄 가운데 인용 따옴표는 그대로).
export function shareArticleTitle({subject = '', text = ''} = {}) {
  const line = v => {
    let t = String(v ?? '').replace(/https?:\/\/[^\s<>"'`]+/gi, ' ').replace(SHORT_BARE_ALL, ' ')
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/gu, ' ')
      .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const wrap = /^["“'‘「『](.+)["”'’」』]$/u.exec(t);
    if (wrap && !/["“”「」『』]/u.test(wrap[1])) t = wrap[1].trim();
    return /[\p{L}\p{N}]/u.test(t) ? t : '';
  };
  const fromSubject = line(subject);
  if (fromSubject) return [...fromSubject].slice(0, SHARE_TITLE_SEND_MAX).join('');
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const l = line(raw);
    if (l) return [...l].slice(0, SHARE_TITLE_SEND_MAX).join('');
  }
  return '';
}
