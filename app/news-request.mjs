// NEWS-클리핑 C2: 다른 화면(노트의 [기사로 가기])이 뉴스 클리핑 화면에 "이 기사를 열어 줘"를 남기는 곳. 화면 메모리에만 둔다(기기 저장 없음).
let pending = null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requestNewsItem(id) { pending = typeof id === 'string' && UUID.test(id) ? id : null; return !!pending; }
// Now 껍데기(outside-statements.js)가 들어올 때 [뉴스] 탭을 열지 보려고 꺼내지 않고 본다.
export const hasNewsItem = () => !!pending;
export function takeNewsItem() { const v = pending; pending = null; return v; }
