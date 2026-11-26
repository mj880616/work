// CAL-머리한줄(S71-24, 2026-11-26 사용자 요청: 구글 캘린더 줄을 맨 윗줄로 합쳐 한 줄로):
// 일정 화면의 '구글 캘린더' 칸(캘린더 고르기·연결 계정·연결 설정, #googleCalendarPanel)을 여닫는 유일한 주인.
//  - 여는 단추 [구글 캘린더 ▾]는 화면 이름 줄(폰·폴드 앱 머리 줄, PC 맨 위 줄)에 있다 — 자리 옮기기는 공용 screen-tools.js.
//  - 칸 자신은 일정 상자 맨 위(‹ 11월 › 줄 바로 위)에 있고, 열면 그 자리에 펼쳐진다. 예전 상자 안 '› 구글 캘린더 …… 메일' 접기 줄은 없다.
//  - 열림 상태는 칸의 hidden 하나다(단추 aria-expanded는 그 거울). 바꾸는 길은 setGooglePanelOpen 하나이고,
//    바뀌면 'kptu:google-panel-toggle'을 낸다(달력 다시 그리기 — calendar-month-view.js).
// 불러올 때 화면을 건드리지 않는다(노드 시험이 이 파일을 불러오는 모듈을 읽는다).
import {mountScreenTools} from './screen-tools.js';

const PANEL = 'googleCalendarPanel', BUTTON = 'googleCalendarHeadBtn';
const panel = () => document.getElementById(PANEL);

export function isGooglePanelOpen() {
  const p = panel();
  return !!p && !p.hidden;
}

export function setGooglePanelOpen(open) {
  const p = panel();
  if (!p) return;
  const next = !!open, changed = p.hidden === next;
  p.hidden = !next;
  document.getElementById(BUTTON)?.setAttribute('aria-expanded', next ? 'true' : 'false');
  if (changed) document.dispatchEvent(new CustomEvent('kptu:google-panel-toggle', {detail: {open: next}}));
}

// 단추 묶음(.screen-tools)을 일정 화면 안 원래 자리에 한 번 만들고 이름 줄로 올린다. 누르기는 여기 한 곳.
export function installGooglePanelHead(section) {
  if (!section || document.getElementById(BUTTON)) return;
  const tools = document.createElement('div');
  tools.id = 'calGoogleTools';
  tools.className = 'screen-tools cal-google-tools';
  tools.innerHTML = `<button id="${BUTTON}" class="secondary cal-google-head" type="button" aria-controls="${PANEL}" aria-expanded="${isGooglePanelOpen() ? 'true' : 'false'}">구글 캘린더<span class="cal-google-caret" aria-hidden="true">▾</span></button>`;
  section.prepend(tools);
  tools.querySelector('button').addEventListener('click', () => setGooglePanelOpen(!isGooglePanelOpen()));
  mountScreenTools('calendar', tools);
}
