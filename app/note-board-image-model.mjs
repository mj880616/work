// S70-32 ②(사용자 2026-11-25 "보드에 이미지 넣기"): 노트 › 보드 이미지 칸 계산(화면 없음, 시험 가능). 그리는 곳은 note-board.js 하나.
// - 이미지 하나 = 사진 한 장뿐인 노트 하나(제목만 있고 본문 없음, 첨부 사진 1장). 파일은 그 노트 첨부(Drive '노트 첨부', owner만,
//   basket-files 올리기와 owner 사진 보기)라 새 저장소·새 표·새 권한이 없다. 보드에는 그 노트 카드가 사진으로 보이고,
//   크기·자리는 카드와 같은 손잡이·자유 이동(노트 metadata.boards[보드] w·h, S69-88).
// - 올리기 전 사진 정보(EXIF: 위치·기기·찍은 시각, XMP, IPTC, 글 칸) 지우기: JPEG은 APP1·APP3~APP13·APP15·COM 칸, PNG는 eXIf·tEXt·zTXt·iTXt·tIME 칸.
//   그림 자체·색 정보(JFIF APP0, ICC APP2, Adobe APP14, PNG 색 칸)는 그대로. 지운 뒤에도 남아 있으면 올리지 않는다(metaLeft).
// - 기기 저장 없음.
export const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/bmp']);
export const isBoardImage = file => !!file && typeof file.type === 'string' && /^image\//.test(file.type) && file.type !== 'image/svg+xml';
export const PHOTO_EDGE = 2048; // 긴 변(px) — 넘으면 줄인다(하루 기록 사진과 같은 크기)
export const PHOTO_MAX = 10; // 한 번에 넣는 장 수
export const BOX_W = 240, BOX_MIN = 60, BOX_MAX = 600; // 새 이미지 칸 폭(판 px), 카드 크기 범위(S69-88 frame 모델과 같음)

const JPEG_DROP = new Set([0xe1, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xef, 0xfe]);
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
export const isJpeg = b => b?.length > 3 && b[0] === 0xff && b[1] === 0xd8;
export const isPng = b => b?.length > 8 && PNG_SIG.every((v, i) => b[i] === v);

// JPEG 칸 목록: [{marker, start, end}] (SOS부터 끝까지는 그림 자료 한 덩어리). 깨진 파일이면 null.
function jpegSegments(b) {
  const out = []; let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // 채우기 바이트
    if (m === 0xd9 || m === 0xda) { out.push({marker:m, start:i, end:b.length}); return out; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { out.push({marker:m, start:i, end:i + 2}); i += 2; continue; }
    if (i + 3 >= b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    out.push({marker:m, start:i, end:i + 2 + len}); i += 2 + len;
  }
  return out;
}
function pngChunks(b) {
  const out = []; let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (i + 12 + len > b.length) return null;
    out.push({type, start:i, end:i + 12 + len}); i += 12 + len;
    if (type === 'IEND') return out;
  }
  return null;
}
const join = (b, parts) => {
  const size = parts.reduce((s, [a, z]) => s + z - a, 0), out = new Uint8Array(size); let at = 0;
  for (const [a, z] of parts) { out.set(b.subarray(a, z), at); at += z - a; }
  return out;
};
// 사진 정보를 지운 바이트. JPEG·PNG가 아니거나 깨졌으면 null(그런 파일은 다시 그려서 올린다 — 다시 그리면 정보 칸이 없다).
export function stripPhotoMeta(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (isJpeg(b)) {
    const segs = jpegSegments(b); if (!segs) return null;
    return join(b, [[0, 2], ...segs.filter(s => !JPEG_DROP.has(s.marker)).map(s => [s.start, s.end])]);
  }
  if (isPng(b)) {
    const chunks = pngChunks(b); if (!chunks) return null;
    return join(b, [[0, 8], ...chunks.filter(c => !PNG_DROP.has(c.type)).map(c => [c.start, c.end])]);
  }
  return null;
}
// 남은 사진 정보 칸 이름들(없으면 빈 배열). 모르는 형식·깨진 파일은 ['unknown'](올리지 않는다).
export function metaLeft(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (isJpeg(b)) { const segs = jpegSegments(b); return segs ? segs.filter(s => JPEG_DROP.has(s.marker)).map(s => `jpeg:${s.marker.toString(16)}`) : ['unknown']; }
  if (isPng(b)) { const chunks = pngChunks(b); return chunks ? chunks.filter(c => PNG_DROP.has(c.type)).map(c => `png:${c.type}`) : ['unknown']; }
  return ['unknown'];
}
// 줄이지 않고 바이트만 지워 올려도 되나: PNG(투명 그대로)이고 긴 변이 PHOTO_EDGE 이하. JPEG은 늘 다시 그린다 —
// 폰 사진의 돌림 정보(EXIF Orientation)를 지우면 눕혀 보이므로, 기기가 바로 세워 다시 그린 그림을 올린다.
export const keepBytes = (type, w, h) => type === 'image/png' && Math.max(w, h) <= PHOTO_EDGE;

// 새 이미지 칸 크기(판 px): 폭 BOX_W, 높이는 사진 비율(너무 길면 BOX_MAX에서 자름). 크기를 모르면 정사각형.
export function imageBoxSize(w, h) {
  const okW = Number.isFinite(w) && w > 0, okH = Number.isFinite(h) && h > 0;
  if (!okW || !okH) return {w:BOX_W, h:BOX_W};
  const width = Math.max(BOX_MIN, Math.min(BOX_W, Math.round(w)));
  const height = Math.max(BOX_MIN, Math.min(BOX_MAX, Math.round(width * h / w)));
  return {w:width, h:height};
}
// 사진 한 장뿐인 노트(보드에서 사진으로 보이는 노트): 본문이 비었고 첨부가 사진 1장. 그 첨부를 돌려준다.
export function photoOnlyFile(note) {
  if (!note || String(note.raw_text || '').trim()) return null;
  const list = Array.isArray(note.attachments) ? note.attachments : [];
  if (list.length !== 1) return null;
  const f = list[0];
  return f && typeof f.drive_file_id === 'string' && /^image\//.test(f.mime_type || '') ? f : null;
}
// 새 노트 제목: 파일 이름(확장자 빼고). 붙여넣기 이름(image·clipboard 등)이나 빈 이름이면 '보드 사진 11월 25일 14:05'.
const GENERIC = /^(image|images|img|photo|picture|clipboard|screenshot|paste|pasted|untitled|blob)([ _-]?\d*)?$/i;
export function photoTitle(name, at = new Date()) {
  const base = String(name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\.[^./\s]{1,8}$/, '').trim();
  if (base && !GENERIC.test(base)) return [...base].slice(0, 120).join('');
  const d = at instanceof Date && Number.isFinite(at.getTime()) ? at : new Date();
  const two = n => String(n).padStart(2, '0');
  return `보드 사진 ${d.getMonth() + 1}월 ${d.getDate()}일 ${two(d.getHours())}:${two(d.getMinutes())}`;
}
