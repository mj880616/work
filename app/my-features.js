// 운영자 기능 목록(서버 app_my_features, 서버 허용 표 app_operator_features가 정함 — AGENTS 5절). 화면은 칸을 그릴지 정하는 데만 쓴다(화면 숨김은 보안이 아님:
// 표 읽기·쓰기는 서버가 같은 표로 막는다). 로그인한 사람·작업공간마다 한 번만 묻고(stable 함수라 GET 읽기), 바뀌면 지운다. 기기 저장 없음.
const cache = new Map();
const keyOf = rt => { const c = rt?.context?.read?.() || {}; return `${c.user?.id || ''}:${c.workspace?.id || ''}`; };
// 못 읽거나 목록이 아닌 답이면 null(다음에 다시 묻는다). myFeatures는 지금처럼 빈 목록으로 읽는다. 메뉴(menu-layout.js)는 null이면 아무 메뉴도 빼지 않는다 —
// 잠깐 못 읽었다고 운영자 메뉴가 사라지지 않게(MULTI-처음쓰는사람 ④).
export function myFeaturesOrNull(rt = window.KPTURuntime) {
  const key = keyOf(rt);
  if (!cache.has(key)) {
    cache.set(key, Promise.resolve().then(() => rt.api('/rest/v1/rpc/app_my_features', {singleFlight: false}))
      .then(v => { if (Array.isArray(v)) return v.filter(x => typeof x === 'string'); cache.delete(key); return null; })
      .catch(() => { cache.delete(key); return null; }));
  }
  return cache.get(key);
}
export const myFeatures = async (rt = window.KPTURuntime) => (await myFeaturesOrNull(rt)) || [];
export const hasFeature = async (rt, name) => (await myFeatures(rt)).includes(name);
if (typeof window !== 'undefined') window.addEventListener?.('kptu:session-changed', () => cache.clear());
