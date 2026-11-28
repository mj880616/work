// S67-52 HOME-칸끄기: 홈 칸 끄기·다시 켜기의 하나뿐인 저장 문(공용 부품).
// - 값: 서버 화면 기억 view_prefs.home_off(끈 칸 이름 배열, 사람별·모든 기기 같음, 기기 저장 없음). 뜻·모양은 home-off-model.mjs.
// - DB 적용 전(쓰기 400)이면 view-prefs가 서버 값으로 되돌리므로 이번 접속에서 고른 값만 화면 메모리에 들고 있는다(note-zoom.js와 같은 방식).
// - 바뀌면 'kptu:home-off' 하나를 알린다. 칸의 renderer는 homeCardOff(id)가 참이면 그 칸을 그리지 않고(숨김 아님), 그 칸의 AI 요청도 보내지 않는다.
// - 끄는 곳: 칸 머리 ⋯ → [이 칸 끄기](공용 줄 메뉴 row-menu.js). 다시 켜는 곳: 내 프로필 '홈 칸'(mountHomeOffSettings).
import {viewPrefs} from './view-prefs.js';
import {HOME_OFF_CARDS, offList, toggledOff, savedOff, homeOffCard} from './home-off-model.mjs';
import {openRowMenu} from './row-menu.js';
import {notify} from './small-notice.js';
import {groupHtml, switchRow} from './settings-list.mjs';

export {HOME_OFF_CARDS};
export const HOME_OFF_EVENT = 'kptu:home-off';
let session = null, serverRefused = false;
globalThis.addEventListener?.('kptu:view-prefs-rejected', e => { if ((e.detail?.paths || []).includes('home_off')) serverRefused = true; });
globalThis.addEventListener?.('kptu:view-prefs-ready', () => { if (!serverRefused) tell(); });
function tell() { try { globalThis.dispatchEvent?.(new CustomEvent(HOME_OFF_EVENT, {detail: {off: homeOffList()}})); } catch { /* 알림만 */ } }

export const homeOffList = () => offList(serverRefused && session ? session : viewPrefs.get('home_off'));
export const homeCardOff = id => homeOffList().includes(id);
export function setHomeCardOff(id, off) {
  if (!homeOffCard(id) || homeCardOff(id) === !!off) return false;
  const next = toggledOff(homeOffList(), id, !!off);
  session = next;
  viewPrefs.set('home_off', savedOff(next), {rejectable: true});
  void viewPrefs.flush?.();
  tell();
  return true;
}

// 칸 머리 ⋯ 단추(공용 ⋯ 모양). 누르면 openHomeOffMenu.
export const homeOffMoreHtml = id => {
  const card = homeOffCard(id);
  return card ? `<button type="button" class="journal-more-btn icon-btn home-off-more" data-home-off-more="${id}" data-ctx="off" aria-label="${card.name} 칸 메뉴" aria-haspopup="true" aria-expanded="false"><span class="more-dots" aria-hidden="true">⋯</span></button>` : '';
};
// ⋯ 메뉴: [이 칸 끄기]. 끄면 위쪽 작은 알림 + [되돌리기](다시 켬). 다시 켜는 곳은 내 프로필 '홈 칸'.
export function openHomeOffMenu(trigger, id) {
  const card = homeOffCard(id);
  if (!card) return false;
  return openRowMenu(trigger, {key: 'home-off:' + id, label: card.name, items: [{id: 'hide', label: '이 칸 끄기'}],
    run: item => {
      if (item !== 'hide' || !setHomeCardOff(id, true)) return;
      notify(`'${card.name}' 칸을 껐어요. 내 프로필 '홈 칸'에서 다시 켜요.`, {label: `'${card.name}' 칸 끄기`, undo: () => { setHomeCardOff(id, false); return true; }});
    }});
}

// 내 프로필 '홈 칸' 장: 끌 수 있는 칸마다 한 줄 + 스위치(켜짐 = 홈에 보임). 바꾸면 바로 서버 저장. 줄은 공용 설정 줄(settings-list.mjs).
// 첫 화면 요약은 켜진 칸 수(onSummary).
export function mountHomeOffSettings(host, {onSummary} = {}) {
  const render = () => {
    const off = new Set(homeOffList());
    host.innerHTML = groupHtml(HOME_OFF_CARDS.map(c => switchRow({label: c.name, checked: !off.has(c.id), attrs: {'data-home-off-switch': c.id}, ariaLabel: `홈에 '${c.name}' 보이기`})));
    onSummary?.({text: `${HOME_OFF_CARDS.filter(c => !off.has(c.id)).length}개 켜짐`});
  };
  host.addEventListener('change', e => {
    const box = e.target.closest?.('[data-home-off-switch]');
    if (box) setHomeCardOff(box.dataset.homeOffSwitch, !box.checked);
  });
  globalThis.addEventListener?.(HOME_OFF_EVENT, render);
  render();
  return {load: render};
}
