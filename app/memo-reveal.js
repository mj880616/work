// S69-95: 모아 보기에서 연 메모의 '그 메모 자리로' 요청 한 곳(화면 메모리만, 기기 저장 없음). 가져오는 것이 없는 작은 모듈이라
// 메모 칸(memo-thread.js)과 원문 열기(memo-open.js)가 서로 부르지 않고 이것만 함께 쓴다(불러오기 고리 없음 — Pages 빌드 해시).
// 원문 메모 칸이 붙을 때 takeMemoReveal로 꺼내 그 줄로 내려가 칠한다.
const memoKey = (type, id) => `${type}:${id}`;
let pending = null; // {key: 'type:id', memo: id}
export function requestMemoReveal(type, id, memo) { pending = memo ? {key: memoKey(type, id), memo} : null; }
// 원문 메모 칸이 붙을 때: 그 원문에 남긴 요청이면 메모 id를 꺼낸다(한 번).
export function takeMemoReveal(type, id) {
  if (!pending || pending.key !== memoKey(type, id)) return null;
  const v = pending.memo; pending = null; return v;
}
// 원문 화면이 메모 칸을 펼쳐야 하는지(기록 ⋯ [메모]처럼 메모 칸이 늘 보이지 않는 곳): 그 종류의 요청이면 대상 id(꺼내지 않음).
export const pendingMemoTarget = type => (pending && pending.key.startsWith(`${type}:`) ? pending.key.slice(type.length + 1) : null);
