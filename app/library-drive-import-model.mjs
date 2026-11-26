// S69-25 LIB-드라이브에서가져오기: 목록 묶기·기본 체크·나눠 보내기·결과 줄 — 순수 규칙(DOM·네트워크 없음). 시험: tests/library-drive-import-model.test.mjs.
// 서버(library-files action drive-import-list)가 준 항목: {id,name,path,kind:'file'|'link',size,modified,personal,media}.
export const ADD_BATCH = 50; // 서버 한 번 한도(drive-import.mjs ADD_MAX)와 같다.

// 개인 서류로 보이는 이름·사진/동영상·자료실에 같은 내용이 이미 있는 파일(S69-45)은 기본으로 뺀다(명진이 선택하면 넣음). 나머지는 모두 체크.
export const defaultPicked = item => !item?.personal && !item?.media && !item?.same;

// S69-45: 드라이브 id는 달라도 내용(md5 + 크기)이 같은 자료가 이미 있을 때 한 줄. 목록 안 앞 파일과 같으면 그 파일 이름.
export function sameNote(item) {
  const s = item?.same;
  if (!s) return '';
  return s.inList ? `목록 안 '${s.title}'와 같은 내용` : `이미 있음(같은 내용: ${s.title} · ${s.path})`;
}

// 드라이브 폴더 경로별 묶음(서버가 경로·이름 순으로 정렬해 보냄 — 그 순서 그대로).
export function groupByPath(items) {
  const out = [], at = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const key = String(it?.path || '내 드라이브');
    if (!at.has(key)) { at.set(key, out.length); out.push({ path: key, items: [] }); }
    out[at.get(key)].items.push(it);
  }
  return out;
}

export function batches(ids, size = ADD_BATCH) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function sizeText(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + 'MB';
  return (n / 1024 / 1024 / 1024).toFixed(1) + 'GB';
}

// 결과 더하기(묶음마다 서버 답 {added,exists,unreadable,failed}).
export function addTotals(sum, part) {
  const k = ['added', 'exists', 'unreadable', 'failed'];
  const out = { ...sum };
  for (const x of k) out[x] = (Number(out[x]) || 0) + (Number(part?.[x]) || 0);
  return out;
}

// 'n개 가져옴 · n개 건너뜀(이미 있음 a · 못 읽음 b)'.
export function resultLine(t) {
  const added = Number(t?.added) || 0, exists = Number(t?.exists) || 0, bad = (Number(t?.unreadable) || 0) + (Number(t?.failed) || 0);
  const skip = exists + bad;
  const why = [exists ? `이미 있음 ${exists}` : '', bad ? `못 읽음 ${bad}` : ''].filter(Boolean).join(' · ');
  return `${added}개 가져옴` + (skip ? ` · ${skip}개 건너뜀(${why})` : '');
}

// 목록 머리 한 줄: '자료실에 없는 파일 n개 · 선택 m개'(+ 서버가 줄인 경우 안내).
export function headLine({ total = 0, shown = 0, picked = 0, more = false, partial = false, same = 0, samePartial = false }) {
  let s = `자료실에 없는 파일 ${total}개 · 선택 ${picked}개`;
  if (same) s += ` · 같은 내용이 이미 있는 ${same}개는 뺐어요`;
  if (samePartial) s += ' · 자료가 많아 같은 내용은 일부만 견줬어요';
  if (more) s += ` · 앞 ${shown}개만 보여요(가져온 뒤 다시 열면 나머지)`;
  else if (partial) s += ' · 드라이브가 커서 일부만 읽었어요(가져온 뒤 다시 열면 나머지)';
  return s;
}

// 건너뛴 것(목록에 안 나온 것) 한 줄.
export function skippedLine(sk) {
  const parts = [];
  if (sk?.registered) parts.push(`이미 자료실에 있음 ${sk.registered}`);
  if (sk?.app) parts.push(`앱이 쓰는 폴더·문서 ${sk.app}`);
  if (sk?.secret) parts.push(`열쇠·비밀번호 파일 ${sk.secret}`); // S70-69: 서버가 뺀 비밀값 파일(종류·개수만)
  if (sk?.not_file) parts.push(`바로가기·스크립트 등 ${sk.not_file}`);
  if (sk?.empty) parts.push(`빈 파일 ${sk.empty}`);
  if (sk?.others) parts.push(`다른 사람이 올린 파일 ${sk.others}`); // S69-25b: 고른 폴더 안이라도 내 소유가 아닌 것
  return parts.length ? '목록에서 뺀 것: ' + parts.join(' · ') : '';
}

// S69-25b: 고를 폴더 목록 [{id,name}]에서 기억한 폴더 id가 아직 있으면 그 id, 없으면 ''(고르기 비움 — 이름으로 짐작하지 않음).
export function pickFolder(folders, remembered) {
  const list = Array.isArray(folders) ? folders : [];
  return typeof remembered === 'string' && list.some(f => f?.id === remembered) ? remembered : '';
}
