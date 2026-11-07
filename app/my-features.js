// 운영자 기능 목록(서버 app_my_features, 서버 허용 표 app_operator_features가 정함 — AGENTS 5절). 화면은 칸을 그릴지 정하는 데만 쓴다(화면 숨김은 보안이 아님:
// 표 읽기·쓰기는 서버가 같은 표로 막는다). 로그인한 사람·작업공간마다 한 번만 묻고(stable 함수라 GET 읽기), 바뀌면 지운다. 기기 저장 없음.
const cache = new Map();
const keyOf = rt => { const c = rt?.context?.read?.() || {}; return `${c.user?.id || ''}:${c.workspace?.id || ''}`; };
export function myFeatures(rt = window.KPTURuntime) {
  const key = keyOf(rt);
  if (!cache.has(key)) {
    cache.set(key, Promise.resolve().then(() => rt.api('/rest/v1/rpc/app_my_features', {singleFlight: false}))
      .then(v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []))
      .catch(() => { cache.delete(key); return []; }));
  }
  return cache.get(key);
}
export const hasFeature = async (rt, name) => (await myFeatures(rt)).includes(name);
if (typeof window !== 'undefined') window.addEventListener?.('kptu:session-changed', () => cache.clear());
