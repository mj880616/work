// PHOTO-폴더스위치 ②·③(요청함 10/31 11:04): 사진 [폴더]의 폰 폴더 스위치·폴더 관리 규칙(화면 없이 시험).
// - 폰 폴더 = 안드로이드 사진첩 relative_path('DCIM/Camera/'). 빈 폴더는 폰에 없다(사진이 들어가야 생긴다).
// - 스위치: 끈 폴더 목록 view_prefs.phone_folders_off(서버 저장, 기기 저장 없음). 끈 폴더 바로 안 사진은 [사진]·[달력]·앨범·★ 어디에도 안 보인다
//   (앱 0.4.1이 목록 읽기에서 뺀다). 하위 폴더는 따로 켜고 끈다(원드라이브 전체 보기와 같음).
// - 바꾸기(앱 PhoneMediaRules.folderOp와 같은 규칙): 옮길 곳은 DCIM/·Pictures/ 아래만, 이름 1~60자('/'·'\'·제어문자·앞 '.' 없음).
export const PHONE_OFF_MAX = 80;
export const PHONE_TOPS = Object.freeze(['DCIM/', 'Pictures/']);
export const PHONE_NAME_MAX = 60;
const CC = /[\p{Cc}]/u;

// 서버 값 → 끈 폴더 Set(모양이 틀린 칸은 버림).
export function parsePhoneOff(value) {
  return new Set(Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.length <= 255 && !CC.test(v)).slice(0, PHONE_OFF_MAX) : []);
}
// Set → 서버 값(정렬, 80개까지). 넘치면 null(저장하지 않고 알림).
export function phoneOffValue(set) {
  const list = [...set].filter(v => typeof v === 'string' && v.length <= 255 && !CC.test(v)).sort();
  return list.length <= PHONE_OFF_MAX ? list : null;
}
export const under = (path, folder) => path === folder || path.startsWith(folder);
// 이름 바꾸기·폴더 옮기기 뒤: from(과 그 아래)을 to(와 그 아래)로. 지우기 뒤: to = null이면 뺀다.
export function remapPhoneOff(set, from, to) {
  const out = new Set();
  for (const p of set) {
    if (!under(p, from)) out.add(p);
    else if (to) out.add(to + p.slice(from.length));
  }
  return out;
}
export function cleanPhoneName(v) {
  const s = String(v ?? '').trim();
  return s.length >= 1 && s.length <= PHONE_NAME_MAX && !s.startsWith('.') && !/[/\\]/.test(s) && !CC.test(s) ? s : '';
}
export const phoneParent = path => { const s = path.slice(0, -1); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i + 1); };
export const phoneLeaf = path => path.slice(0, -1).split('/').pop() || '';
// 옮길 곳이 될 수 있는 경로('DCIM/' 'Pictures/…/').
export function isPhoneTarget(path) {
  if (typeof path !== 'string' || path.length > 255 || !path.endsWith('/') || !PHONE_TOPS.some(t => path.startsWith(t))) return false;
  return path.slice(0, -1).split('/').slice(1).every(p => p !== '' && cleanPhoneName(p) === p);
}
// 이름 바꾸기·옮기기·지우기를 할 수 있는 폴더(DCIM·Pictures 자체는 안 됨, 그 아래만).
export const isPhoneMovable = path => isPhoneTarget(path) && !PHONE_TOPS.includes(path);
// 지우기(폰 휴지통)는 어느 폴더든(사진첩 맨 위·DCIM·Pictures 자체는 안 됨).
export const isPhoneTrashable = path => typeof path === 'string' && path.endsWith('/') && path.length <= 255 && !PHONE_TOPS.includes(path) && !CC.test(path);
// 새 폴더 경로: 부모가 옮길 곳이 될 수 있으면 그 아래, 아니면 Pictures/ 아래.
export function newPhonePath(parent, name) {
  const n = cleanPhoneName(name); if (!n) return '';
  const base = isPhoneTarget(parent) ? parent : 'Pictures/';
  const p = base + n + '/';
  return isPhoneTarget(p) ? p : '';
}
export const renamedPhonePath = (from, name) => { const n = cleanPhoneName(name); const p = n ? phoneParent(from) + n + '/' : ''; return isPhoneTarget(p) ? p : ''; };
export const movedPhonePath = (from, into) => { const p = into + phoneLeaf(from) + '/'; return isPhoneTarget(p) ? p : ''; };
// 고르는 창 줄: 폴더 목록(+ DCIM·Pictures 맨 위). kind 'folder'면 자기·자기 아래·지금 부모를 막는다, 'photos'면 지금 보는 폴더를 막는다.
export function phonePickRows(folders, {moving = null, here = null} = {}) {
  const paths = new Set(PHONE_TOPS);
  for (const f of folders || []) if (isPhoneTarget(f.id)) paths.add(f.id);
  return [...paths].sort((a, b) => a.localeCompare(b)).map(p => {
    const depth = p.slice(0, -1).split('/').length - 1;
    const off = moving ? under(p, moving) || p === phoneParent(moving) || !movedPhonePath(moving, p) : p === here;
    return {id:p, name:phoneLeaf(p), indent:depth, current:off};
  });
}
// 앱 답 → 화면 글.
export function phoneOpText(res, done) {
  if (res?.ok) return done;
  const e = res?.error || '';
  if (e === 'refused') return '폰에서 바꾸지 않았어요(확인 창에서 취소).';
  if (e === 'none') return '바꿀 사진이 없어요.';
  if (e === 'old') return '폰 폴더를 바꾸려면 앱 새 판이 필요해요.';
  if (e === 'busy') return '앞의 바꾸기가 끝난 뒤 다시 해 주세요.';
  return '폰 폴더를 바꾸지 못했어요.';
}
