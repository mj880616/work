// FILES-통합 3단계(S49-51, 설계 docs/design/files-unified-plan.md J절 H-1·H-7): [파일] '이 폰' 줄 모양 계산. DOM·네트워크 없음.
// - 폰 앱 다리(android-app PhoneFilesRules.kt)가 돌려준 줄 {p(뿌리 기준 상대 경로), n(이름), d(폴더), s(크기), m(바뀐 시각 ms), t(종류)}을
//   [파일] 화면이 클라우드 색인 줄과 같은 모양으로 그리게 바꾼다: {source:'ph', item_id: 경로, parent_id: 부모 경로, name, is_folder, size_bytes, modified_at, mime, folder_path}.
// - 폰 파일 목록은 화면 메모리에만 있고 서버로 보내지 않는다(이 파일은 계산만).
export const PHONE_SOURCE = 'ph';
export const PHONE_NAME = '이 폰';
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


// 다리 상태 글 'pfiles:state:{…}' → {known, can, all, key}. 열쇠는 켜져 있을 때만 받는다.
export function phoneState(text) {
  if (typeof text !== 'string' || !text.startsWith('pfiles:state:')) return null;
  let v = null;
  try { v = JSON.parse(text.slice('pfiles:state:'.length)); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const all = v.all === true && /^[A-Za-z0-9_-]{22,64}$/.test(v.key || '');
  // write = 앱이 받기·새 폴더·이름·휴지통을 안다(앱 3-③ 판부터).
  // del(S53-7, 폰 앱 0.5.4+) = 휴지통이 문서·PDF까지 되고 못 한 이유를 알려 준다.
  return {known: true, can: v.can === true, all, key: all ? v.key : '', write: v.write === true, del: v.del === true};
}

// 실패 글(앱 다리 {error}) → 화면 한 줄.
export function phoneErrorText(code) {
  switch (code) {
    case 'permission': return '폰 저장 공간 허락이 꺼져 있어요(설정 › 모든 파일 접근)';
    case 'key': return '앱을 다시 켜서 폰 연결이 바뀌었어요. 다시 눌러 주세요';
    case 'blocked': return '이 폴더는 열 수 없어요';
    case 'not_found': return '폰에서 그 파일을 찾지 못했어요';
    case 'unreached': return '폰 앱 다리에 닿지 못했어요';
    case 'timeout': return '폰 앱이 답하지 않아요';
    default: return '폰 파일을 읽지 못했어요';
  }
}
// 다리 답(pfiles:done·pfiles:save) 모양 맞추기. 글자는 정해 둔 짧은 말만.
const code = v => (typeof v === 'string' && /^[a-z_]{1,20}$/.test(v) ? v : '');
export function phoneDone(text) {
  if (typeof text !== 'string' || !text.startsWith('pfiles:done:')) return null;
  let v = null; try { v = JSON.parse(text.slice('pfiles:done:'.length)); } catch { return null; }
  return {ok: v?.ok === true, op: code(v?.op), path: typeof v?.path === 'string' && phonePathOk(v.path) ? v.path : '', count: Number.isInteger(v?.count) ? v.count : 0, error: code(v?.error)};
}
export function phoneSaved(text) {
  if (typeof text !== 'string' || !text.startsWith('pfiles:save:')) return null;
  let v = null; try { v = JSON.parse(text.slice('pfiles:save:'.length)); } catch { return null; }
  return {ok: v?.ok === true, step: code(v?.step), got: Number.isFinite(v?.got) ? v.got : 0, path: typeof v?.path === 'string' && phonePathOk(v.path) ? v.path : '', error: code(v?.error)};
}
export const PHONE_SAVE_MAX = 1024 * 1024 * 1024;
// 폰 쓰기 실패 글. del = 폰 앱이 0.5.4+(휴지통이 문서까지 되는 판). 옛 판에서 막연히 '못했어요'만 보이지 않게 할 일을 붙인다(S53-7).
export const PHONE_TRASH_OLD_TEXT = '폰에서 지우지 못했어요. 웹2 앱을 새 판으로 올리면 지울 수 있어요(앱 위쪽 새 버전 줄)';
export function phoneWriteText(code, {del = true} = {}) {
  switch (code) {
    case 'exists': return '같은 이름이 이미 있어요';
    case 'space': return '폰 저장 공간이 모자라요';
    case 'refused': return '안드로이드 확인 창에서 그만둬서 지우지 않았어요';
    case 'missing': return '폰이 아직 모르는 파일이라 휴지통으로 보내지 못했어요. 잠시 뒤 다시 해 주세요';
    case 'direct': return "문서·PDF 일부를 폰 휴지통에 넣지 못했어요. 폰 '내 파일' 앱에서 지워 주세요";
    case 'unsupported': return '이 폰에서는 휴지통으로 보낼 수 없어요';
    case 'permission': return phoneErrorText('permission');
    case 'blocked': return phoneErrorText('blocked');
    case 'not_found': return phoneErrorText('not_found');
    case 'timeout': return '폰 앱이 답하지 않아요. 다시 해 주세요';
    default: return del ? '폰에 쓰지 못했어요. 다시 해 보고, 또 안 되면 폰 앱을 껐다 켜 주세요' : PHONE_TRASH_OLD_TEXT;
  }
}
// '이 폰'에서 아직 안 되는 일. 옛 앱(쓰기 모름)은 보기·클라우드로 복사만.
export const PHONE_READONLY_TEXT = '폰 파일은 지금은 보기·받기만 돼요';
export const PHONE_OLD_APP_TEXT = '폰에 쓰려면 웹2 앱을 새 판으로 올려 주세요';
// FILES-저장소사이(S52-43 ②): 폰에 쓸 수 있는 앱(3-③)이면 폰 ↔ 클라우드 옮기기(복사 뒤 원본 휴지통)가 된다. 옛 앱·폰 안끼리는 이 한 줄.
export const PHONE_MOVE_TEXT = '폰 안끼리 옮기기는 아직 안 돼요. 폰 ↔ 클라우드는 웹2 앱 새 판에서 옮길 수 있어요';
export const PHONE_ASK_TEXT = "설정에서 '모든 파일 접근 허용'을 켜고 돌아오세요";
export const PHONE_CANNOT_TEXT = '이 폰(안드로이드 10 이하)에서는 폰 저장 공간을 열 수 없어요';
