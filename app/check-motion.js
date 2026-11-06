// UI-누름움직임(2026-11-06 명진 요청 22:44 "할일 체크 누르면 누르는 모션 이건 어디서 눌러도"): 할 일 동그라미를 눌러 끝냈을 때의 움직임.
// 누르는 순간의 작아짐은 공용 눌림 규칙(ui-standard.css :active·[data-pressing])이 맡고, 끝낸 줄이 다시 그려진 뒤의
// 물결 → 채움·체크 그리기(살짝 튀어나듯) → 글자 줄 긋기는 ui-standard.css의 [data-check-pop] 규칙 한 곳이 그린다(전체 --ds-check-ms 안).
// 여기는 '방금 끝낸 할 일'만 기억한다: 목록이 바로 다시 그려져(홈은 '한 일'로 옮겨 감) 새 요소가 생겨도, 그 줄에 지난 시간만큼 앞당긴
// 움직임(--check-t 음수)을 걸어 한 번만 이어서 보인다. 끝나면 더 걸지 않는다. 기기·서버에 아무것도 남기지 않는다.
export const CHECK_MS = 240;
const recent = new Map();

// 할 일을 '끝냄'으로 바꾼 순간(google-tasks.js toggleTask 한 곳 — 할 일 화면·홈·일정·연결 목록·회의 상세가 모두 이 길로 저장한다).
export function noteChecked(id, now = Date.now()) { if (id != null && id !== '') recent.set(String(id), now); }
export function noteUnchecked(id) { recent.delete(String(id)); }

// 끝낸 지 CHECK_MS 안이면 지난 시간(ms), 아니면 null(그리고 잊는다).
export function checkElapsed(id, now = Date.now()) {
  const key = String(id), at = recent.get(key);
  if (at == null) return null;
  const t = Math.max(0, now - at);
  if (t >= CHECK_MS) { recent.delete(key); return null; }
  return Math.round(t);
}

// 글로 그리는 줄: 줄 여는 태그 안에 넣는다(앞 칸 포함). 다른 style이 있는 줄은 checkPopStyle을 그 style에 더한다.
export function checkPopAttr(id, now = Date.now()) {
  const t = checkElapsed(id, now);
  return t == null ? '' : ` data-check-pop style="--check-t:-${t}ms"`;
}
export function checkPopStyle(id, now = Date.now()) {
  const t = checkElapsed(id, now);
  return t == null ? '' : `--check-t:-${t}ms;`;
}

// 요소로 그리는 줄·제자리에서 바뀌는 줄: 움직임을 처음부터 다시 건다.
export function applyCheckPop(el, id, now = Date.now()) {
  if (!el) return false;
  const t = checkElapsed(id, now);
  if (t == null) return false;
  el.removeAttribute('data-check-pop');
  void el.offsetWidth; // 같은 줄에서 다시 끝냈을 때도 움직임이 처음부터
  el.style.setProperty('--check-t', `-${t}ms`);
  el.setAttribute('data-check-pop', '');
  return true;
}
