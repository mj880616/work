// FILES-통합 3단계(S49-51, 설계 docs/design/files-unified-plan.md J절 H-1·H-7): [파일] '이 폰' 줄 모양 계산. DOM·네트워크 없음.
// - 폰 앱 다리(android-app PhoneFilesRules.kt)가 돌려준 줄 {p(뿌리 기준 상대 경로), n(이름), d(폴더), s(크기), m(바뀐 시각 ms), t(종류)}을
//   [파일] 화면이 클라우드 색인 줄과 같은 모양으로 그리게 바꾼다: {source:'ph', item_id: 경로, parent_id: 부모 경로, name, is_folder, size_bytes, modified_at, mime, folder_path}.
// - 폰 파일 목록은 화면 메모리에만 있고 서버로 보내지 않는다(이 파일은 계산만).
export const PHONE_SOURCE = 'ph';
export const PHONE_NAME = '이 폰';
export const PHONE_RECENT_LIMIT = 200;
const PATH_MAX = 1024, SEG_MAX = 255, DEPTH_MAX = 40;

// 앱 규칙과 같은 경로 검사(앱이 다시 본다). 빈 칸·'.'·'..'·점으로 시작·역슬래시·제어 글자·Android/data·Android/obb는 거절.
export function phonePathOk(path) {
  const p = String(path ?? '');
  if (!p || p.length > PATH_MAX || p.startsWith('/') || p.endsWith('/')) return false;
  const segs = p.split('/');
  if (segs.length > DEPTH_MAX) return false;
  // eslint-disable-next-line no-control-regex
  if (segs.some(s => !s || s.length > SEG_MAX || s.startsWith('.') || /[\\\u0000-\u001f\u007f]/.test(s))) return false;
  return !(segs.length >= 2 && /^android$/i.test(segs[0]) && /^(data|obb)$/i.test(segs[1]));
}
export const phoneParent = path => { const p = String(path || ''); const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : null; };
export const phoneBase = path => { const p = String(path || ''); return p.slice(p.lastIndexOf('/') + 1); };

// 다리 줄 하나 → 화면 줄. 모양이 틀리면 null.
export function phoneRow(e) {
  if (!e || typeof e !== 'object') return null;
  const path = typeof e.p === 'string' ? e.p : '';
  if (!phonePathOk(path)) return null;
  const name = typeof e.n === 'string' && e.n ? e.n : phoneBase(path);
  if (name !== phoneBase(path)) return null;
  const folder = e.d === true, m = Number(e.m), s = Number(e.s);
  const parent = phoneParent(path);
  return {
    source: PHONE_SOURCE, item_id: path, parent_id: parent, name, is_folder: folder,
    size_bytes: folder || !Number.isFinite(s) || s < 0 ? null : s,
    modified_at: Number.isFinite(m) && m > 0 ? new Date(m).toISOString() : null,
    mime: folder ? null : (typeof e.t === 'string' && e.t.length <= 120 ? e.t : null),
    folder_path: parent ? parent.split('/').join(' › ') : '',
    starred: false, library_doc_id: null, hash: null,
  };
}
export const phoneRows = list => (Array.isArray(list) ? list : []).map(phoneRow).filter(Boolean);

// 위치 줄(app_cloud_trail과 같은 모양): 지금 폴더가 depth 0, 위로 갈수록 depth가 크다.
export function phoneTrail(path) {
  if (!path || !phonePathOk(path)) return [];
  const segs = String(path).split('/');
  return segs.map((name, i) => ({item_id: segs.slice(0, i + 1).join('/'), name, depth: segs.length - 1 - i}));
}

// [최근]에 폰 줄 섞기(H-7): 클라우드 줄과 폰 줄을 바뀐 날 새것부터 한 목록으로. 같은 열쇠는 한 번만, 한도까지.
export function mergeRecent(cloud, phone, limit = 400) {
  const seen = new Set(), out = [];
  for (const r of [...(cloud || []), ...(phone || [])]) {
    const k = `${r?.source}:${r?.item_id}`;
    if (!r || seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  const t = r => Date.parse(r.modified_at || '') || 0;
  return out.sort((a, b) => t(b) - t(a)).slice(0, limit);
}

// 다리 상태 글 'pfiles:state:{…}' → {known, can, all, key}. 열쇠는 켜져 있을 때만 받는다.
export function phoneState(text) {
  if (typeof text !== 'string' || !text.startsWith('pfiles:state:')) return null;
  let v = null;
  try { v = JSON.parse(text.slice('pfiles:state:'.length)); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const all = v.all === true && /^[A-Za-z0-9_-]{22,64}$/.test(v.key || '');
  return {known: true, can: v.can === true, all, key: all ? v.key : ''};
}

// 실패 글(앱 다리 {error}) → 화면 한 줄.
export function phoneErrorText(code) {
  switch (code) {
    case 'permission': return '폰 저장 공간 허락이 꺼져 있어요(설정 › 모든 파일 접근)';
    case 'key': return '앱을 다시 켜서 폰 연결이 바뀌었어요. 다시 눌러 주세요';
    case 'blocked': return '이 폴더는 열 수 없어요';
    case 'not_found': return '폰에서 그 파일을 찾지 못했어요';
    case 'unreached': return '폰 앱 다리에 닿지 못했어요';
    default: return '폰 파일을 읽지 못했어요';
  }
}
// '이 폰'에서 아직 안 되는 일(이 판은 읽기·보내기만).
export const PHONE_READONLY_TEXT = '폰 파일은 지금은 보기·받기만 돼요';
export const PHONE_ASK_TEXT = "설정에서 '모든 파일 접근 허용'을 켜고 돌아오세요";
export const PHONE_CANNOT_TEXT = '이 폰(안드로이드 10 이하)에서는 폰 저장 공간을 열 수 없어요';
