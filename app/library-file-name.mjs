// LIB-파일이름그대로(2026-10-30 사용자 결정 A "뜻 있는 파일 이름이면 모두 그대로"): 자료실에 올린 파일 이름 판정 한 곳.
// 순수 함수만(브라우저·Edge 공용). Edge 사본은 supabase/functions/_shared/library-file-name.mjs 이고, 시험이 이 줄 아래를 바이트까지 비교한다.
// 쓰는 곳: library-files(올릴 때 제목·자료 날짜), ai-assist library_fill(제목을 본문에서 뽑아도 되는지), 화면 library-ai-fill.js
// (올린 뒤 AI 자동 정리가 쓰지 않을 칸, 기존 자료 정리 후보 고르기).

// 뜻 없는 이름 = 이름에서 숫자·기호를 뺀 낱말이 모두 아래 흔한 낱말이거나 짧은 영문 조각(1~2자)이고, 한글·한자·긴 영문 낱말이 하나도
// 남지 않는 이름. 예: 251020·scan0001·IMG_20251020_123456·KakaoTalk_20251020_1·제목 없음·새 문서 1·image.png·문서·최종·회의자료.
export const GENERIC_NAME_WORDS = Object.freeze([
  'img', 'image', 'images', 'imgs', 'dsc', 'dscn', 'dscf', 'pxl', 'mvimg', 'vid', 'video', 'photo', 'photos', 'pict', 'picture', 'pic',
  'scan', 'scanned', 'scanner', 'document', 'doc', 'docx', 'file', 'files', 'untitled', 'new', 'screenshot', 'screen', 'shot', 'capture',
  'download', 'downloads', 'attachment', 'temp', 'tmp', 'kakaotalk', 'kakao', 'talk', 'copy', 'wa', 'am', 'pm',
  'note', 'notes', 'memo', 'final', 'draft',
  '스캔', '제목', '없음', '제목없음', '새문서', '무제', '새', '문서', '사진', '이미지', '첨부', '첨부파일', '붙여넣은', '화면', '캡처', '스크린샷',
  '카카오톡', '복사본', '사본', '오전', '오후', '파일', '이름', '한글',
  '자료', '회의자료', '최종', '최종본', '확정', '수정', '수정본', '완성', '완성본',
]);
const GENERIC_SET = new Set(GENERIC_NAME_WORDS);

// 확장자(점 뒤 1~8자)를 뗀 이름.
export const fileBaseName = name => String(name ?? '').replace(/\.[^.]{1,8}$/, '').trim();

export function isMeaninglessName(fileName) {
  const words = fileBaseName(fileName).normalize('NFKC').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  return !words.some(w => !GENERIC_SET.has(w) && !/^[a-z]{1,2}$/.test(w));
}

// 뜻 있는 이름의 제목: 확장자를 떼고 밑줄을 띄어쓰기로, 겹친 띄어쓰기를 하나로. 날짜·이름 같은 나머지 글자는 그대로 둔다.
// '주간보고_20261102_홍길동.hwpx' → '주간보고 20261102 홍길동'.
export function fileNameTitle(fileName) {
  return fileBaseName(fileName).normalize('NFKC').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

// 파일 이름의 날짜(YYYY-MM-DD) 또는 null. 20261102 · 2026-11-02 · 2026.11.02 · 261102(앞뒤가 숫자가 아닐 때).
export function fileNameDate(fileName) {
  const name = String(fileName ?? '');
  let m = name.match(/(20\d{2})[._-]?(0[1-9]|1[0-2])[._-]?([0-2]\d|3[01])/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = name.match(/(?:^|\D)(\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\D|$)/);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// 올린 뒤 AI 자동 정리가 쓰지 않을 칸: 뜻 있는 이름이면 제목, 이름에 날짜가 있으면 자료 날짜.
export function nameKeptFields(fileName) {
  const keep = [];
  if (fileBaseName(fileName) && !isMeaninglessName(fileName)) keep.push('title');
  if (fileNameDate(fileName)) keep.push('document_date');
  return keep;
}
