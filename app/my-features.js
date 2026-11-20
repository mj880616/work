// 운영자 기능 목록(서버 app_my_features, 서버 허용 표 app_operator_features가 정함 — AGENTS 5절). 화면은 칸을 그릴지 정하는 데만 쓴다(화면 숨김은 보안이 아님:
// 표 읽기·쓰기는 서버가 같은 표로 막는다). 로그인한 사람·작업공간마다 한 번만 묻고(stable 함수라 GET 읽기), 바뀌면 지운다. 기기 저장 없음.
const cache = new Map();
const keyOf = rt => { const c = rt?.context?.read?.() || {}; return `${c.user?.id || ''}:${c.workspace?.id || ''}`; };
// 못 읽거나 목록이 아닌 답이면 null(다음에 다시 묻는다). myFeatures는 지금처럼 빈 목록으로 읽는다. 메뉴(menu-layout.js)는 null이면 아무 메뉴도 빼지 않는다 —
// 잠깐 못 읽었다고 운영자 메뉴가 사라지지 않게(MULTI-처음쓰는사람 ④).
// S67-62: 시작할 때 loader-v2.js가 같은 사람으로 이미 물었으면(window.__KPTU_BOOT_FEATURES__, 바탕 낱말 묶음용) 첫 물음은 그 답을 쓴다(한 번만).
// 그 답이 없었으면(실패·시간 초과) 지금처럼 다시 묻는다.
const ask = rt => rt.api('/rest/v1/rpc/app_my_features', {singleFlight: false});
function firstAsk(rt) {
  const boot = typeof window !== 'undefined' ? window.__KPTU_BOOT_FEATURES__ : null;
  const userId = rt?.context?.read?.()?.user?.id || '';
  if (!boot || !userId || boot.userId !== userId || typeof boot.promise?.then !== 'function') return ask(rt);
  window.__KPTU_BOOT_FEATURES__ = null;
  return boot.promise.then(list => Array.isArray(list) ? list : ask(rt));
}
export function myFeaturesOrNull(rt = window.KPTURuntime) {
  const key = keyOf(rt);
  if (!cache.has(key)) {
    cache.set(key, Promise.resolve().then(() => firstAsk(rt))
      .then(v => { if (Array.isArray(v)) return v.filter(x => typeof x === 'string'); cache.delete(key); return null; })
      .catch(() => { cache.delete(key); return null; }));
  }
  return cache.get(key);
}
export const myFeatures = async (rt = window.KPTURuntime) => (await myFeaturesOrNull(rt)) || [];
export const hasFeature = async (rt, name) => (await myFeatures(rt)).includes(name);
if (typeof window !== 'undefined') window.addEventListener?.('kptu:session-changed', () => { cache.clear(); window.__KPTU_BOOT_FEATURES__ = null; });
// MULTI-처음쓰는사람 ⑤: 통화·텔레그램 수집을 쓰는 계정인가(내 프로필 '수집·사용량' 칸·수집 알림 칩). 답이 없으면(null) 그렇다고 본다 —
// 잠깐 못 읽었다고 운영자 칸이 빠지지 않게.
export const collectsFeeds = features => !Array.isArray(features) || features.includes('calls') || features.includes('telegram');
