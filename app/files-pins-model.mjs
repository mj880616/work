// S52-41 ④ FILES-폴더고정(요청함 11/08, 시안 docs/design/mockups/files-pinned-folders.html): [파일] 나무 맨 위 '📌 고정한 폴더' 계산. DOM·네트워크 없음(node --test).
// - 클라우드(원드라이브·구글 드라이브) 고정은 서버 view_prefs.files_pins — 'od:<폴더 id>'·'gd:<폴더 id>' 글자 배열 12개까지, 모든 기기 같게(이름은 넣지 않음).
// - 내 PC 고정은 그 PC에만: 바구니 PC 앱 문(/v1/pins)이 그 PC 안에 경로를 둔다(서버·브라우저 저장소에 넣지 않음). 고정한 그 PC에서만 목록에 나온다.
// - 줄 순서는 사람이 ⠿로 정한 순서. 클라우드 묶음과 내 PC 묶음은 따로 순서를 가진다(저장 곳이 달라서).
export const PINS_MAX = 12;
const CLOUD = ['od', 'gd'];
// 'od:ID' → {source:'od', id:'ID'}, 모양이 틀리면 null. 폴더 id에는 ':'가 들어갈 수 있다(첫 ':'만 가른다).
export function pinParse(key) {
  const k = typeof key === 'string' ? key : '', at = k.indexOf(':');
  if (at < 0) return null;
  const source = k.slice(0, at), id = k.slice(at + 1);
  // eslint-disable-next-line no-control-regex
  if (!CLOUD.includes(source) || !id || [...id].length > 200 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return {source, id};
}
export const pinKey = (source, id) => (CLOUD.includes(source) && id ? `${source}:${id}` : '');
// 서버 값 → 쓸 수 있는 키만(겹치면 하나, 12개까지).
export function pinsClean(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list : []) if (pinParse(k) && !out.includes(k) && out.length < PINS_MAX) out.push(k);
  return out;
}
export const pinHas = (list, key) => (Array.isArray(list) ? list : []).includes(key);
// 맨 끝에 더하기. 가득 찼으면 {ok:false, why}.
export function pinAdd(list, key) {
  const cur = Array.isArray(list) ? [...list] : [];
  if (!key) return {ok: false, why: '고정할 수 없는 폴더예요', list: cur};
  if (cur.includes(key)) return {ok: true, list: cur};
  if (cur.length >= PINS_MAX) return {ok: false, why: `고정은 ${PINS_MAX}개까지예요. 다른 것을 풀고 다시 해 주세요`, list: cur};
  return {ok: true, list: [...cur, key]};
}
export const pinRemove = (list, key) => (Array.isArray(list) ? list : []).filter(k => k !== key);
// 끌어 놓기: key를 (그 줄을 뺀) index 자리로.
export function pinMove(list, key, index) {
  const cur = (Array.isArray(list) ? list : []).filter(k => k !== key);
  if (cur.length === (Array.isArray(list) ? list.length : 0)) return Array.isArray(list) ? [...list] : [];
  const at = Math.max(0, Math.min(cur.length, Number(index) || 0));
  cur.splice(at, 0, key);
  return cur;
}
// 키보드 ↑↓ 한 칸.
export function pinStep(list, key, dir) {
  const cur = Array.isArray(list) ? [...list] : [], i = cur.indexOf(key), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= cur.length) return cur;
  [cur[i], cur[j]] = [cur[j], cur[i]];
  return cur;
}
// 줄 하나의 모양: 이름(모르면 '폴더'), 오른쪽 흐린 출처 글자, 쓸 수 있나(출처가 꺼졌거나 연결이 끊기면 흐리게 '연결 안 됨' — 지우지 않음).
export function pinView({source, id, name = '', on = [], names = {}}) {
  const label = String(name || names[`${source}:${id}`] || '').trim() || (source === 'pc' ? String(id).split('\\').filter(Boolean).pop() || id : '폴더');
  const live = on.includes(source);
  return {source, id, name: label, live, tag: live ? '' : '연결 안 됨'};
}
