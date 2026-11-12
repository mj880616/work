// LIB-최근폴더로가기(S61-12, 요청함 V28 11/13 04:40 명진 ㅇ): 줄 메뉴 맨 위 [폴더로 가기] — 그 파일·노트가 든 폴더로 들어가 그 줄을 잠깐 강조.
// 자료실('최근 올린 파일'·검색 결과·'자료실 전체' 자료 줄), [파일] '최근' 상자, 노트 '최근'이 같은 글자·같은 강조를 쓴다.
// 폴더로 들어가는 길은 화면마다 이미 있는 들어가기 하나를 그대로 쓰고(뒤로 = 앞 화면), 여기는 글자와 강조만 맡는다. 저장 없음.
export const GOTO_FOLDER_LABEL = '폴더로 가기';

const timers = new WeakMap();
// el을 화면 가운데로 데려와 초점을 주고, cls 강조(움직임 없음 설정이면 CSS가 색만)를 ms 동안 붙였다 뗀다.
export function flashRow(el, {cls, ms = 1900, focus = true} = {}) {
  if (!el || !cls) return false;
  el.scrollIntoView?.({block: 'center'});
  if (focus) (el.matches?.('button,[tabindex]') ? el : el.querySelector?.('button,[tabindex]') || el).focus?.({preventScroll: true});
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  clearTimeout(timers.get(el));
  timers.set(el, setTimeout(() => el.classList.remove(cls), ms));
  return true;
}
