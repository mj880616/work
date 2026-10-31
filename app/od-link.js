// OD-연결아이콘(2026-10-28 13:53 명진 요청): 원드라이브 연결 표시를 아이콘 하나 + 누르면 드롭다운으로.
// 일기 [오늘] 오른쪽에 두고, 새 '사진' 메뉴도 이 부품을 그대로 쓴다(docs/design/photo-menu.md). 여기는 모양만 그리고, 연결·폴더·저장은 부르는 쪽이 한다.
// - 아이콘: 원드라이브 구름 모양을 직접 그린 단색 SVG(currentColor, 상표 그림 파일 아님). 연결 안 됨 = 흐림, 오류 = 작은 빨간 점.
// - 드롭다운: 공용 anchored-menu.js(뒤로가기·Esc·바깥 누름으로 닫힘, 위치 계산 공용). 항목 = 연결 상태 / 일기에서 사진 보이기 / 연결 끊기.
//   PHOTO-폴더스위치(10/31): 원드라이브 전체 보기(od.whole)에서는 [폴더 바꾸기]·[하위 폴더 켜고 끄기]가 없다(사진 [폴더]의 폴더별 스위치가 대신함).
//   서버가 아직 전체 보기를 모르는 동안(배포 전)만 두 항목을 예전처럼 보인다.
// - 기기 저장 없음. '일기에서 사진 보이기'는 부르는 쪽이 서버(view_prefs.diary_onedrive)에 둔다.
import {createAnchoredMenu} from './anchored-menu.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[ch]);

// 구름 두 덩이가 겹친 단순한 모양(가로 24 × 세로 16 칸). 색은 글자색을 따른다.
export const OD_CLOUD_SVG = '<svg class="od-link-cloud" viewBox="0 0 24 16" width="20" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9.6 2.2a5 5 0 0 1 4.6 2.1 4.2 4.2 0 0 1 5.5 3.6A3.6 3.6 0 0 1 19.4 15H5.2A4.2 4.2 0 0 1 4.6 6.6a5 5 0 0 1 5-4.4Z"/></svg>';

// 연결 상태 → 'hidden'(원드라이브 준비 안 된 서버) | 'off'(연결 안 됨·흐림) | 'error'(빨간 점) | 'ok'.
// od = {configured, connected, folder, failed?}, fault = 이번 접속에서 원드라이브 요청이 실패했는지.
export function odLinkState(od, fault = false) {
  if (od?.failed) return 'error';
  if (!od?.configured) return 'hidden';
  if (!od.connected) return 'off';
  return fault ? 'error' : 'ok';
}
const STATE_TEXT = {off:'연결 안 됨', error:'오류가 있어요', ok:'연결됨'};
export function odLinkLabel(state, od) {
  const where = state === 'ok' && od?.folder?.name && !od.whole ? ` · ${od.folder.name}` : '';
  return `원드라이브 · ${STATE_TEXT[state] || STATE_TEXT.off}${where}`;
}
// 버튼 한 개. data-od-link로 찾고, 상태는 paintOdLink가 바꾼다.
export function odLinkButtonHtml(attrs = '') {
  return `<button type="button" class="mini od-link" data-od-link data-state="off" aria-haspopup="true" aria-expanded="false" aria-label="${esc(odLinkLabel('off'))}" title="${esc(odLinkLabel('off'))}" hidden ${attrs}>${OD_CLOUD_SVG}<span class="od-link-dot" aria-hidden="true"></span></button>`;
}
export function paintOdLink(button, od, fault = false) {
  if (!button) return 'hidden';
  const state = odLinkState(od, fault), label = odLinkLabel(state, od);
  button.hidden = state === 'hidden';
  button.dataset.state = state;
  button.setAttribute('aria-label', label); button.title = label;
  return state;
}

// 드롭다운 항목. model = {od, fault, message, show(일기에서 사진 보이기 켜짐?), showLabel?}
// 누르면 data-od-act 값('connect'|'retry'|'folder'|'subfolders'|'show'|'reconnect'|'disconnect')을 onAction이 받는다.
export function odLinkMenuHtml({od = {}, fault = false, message = '', show = true, showLabel = '일기에서 사진 보이기'} = {}) {
  const state = odLinkState(od, fault);
  const where = od.connected && od.folder?.name && !od.whole ? ` · ${esc(od.folder.name)}` : '';
  const status = `<p class="od-link-status" data-od-link-status><span class="od-link-mark" data-state="${state}" aria-hidden="true"></span>${esc(STATE_TEXT[state] || STATE_TEXT.off)}${where}</p>${message ? `<p class="od-link-note">${esc(message)}</p>` : ''}`;
  if (od.failed || !od.connected) {
    return status + (od.failed ? '<button type="button" data-od-act="retry">다시 확인</button>' : '<button type="button" data-od-act="connect">원드라이브 연결</button>');
  }
  const items = [];
  if (!od.whole) items.push(`<button type="button" data-od-act="folder">${od.folder ? '폴더 바꾸기' : '폴더 고르기'}</button>`);
  if (od.folder && !od.whole) items.push('<button type="button" data-od-act="subfolders">하위 폴더 켜고 끄기</button>');
  if (od.folder) items.push(`<button type="button" role="menuitemcheckbox" aria-checked="${show ? 'true' : 'false'}" data-od-act="show"><span class="od-link-check" aria-hidden="true">${show ? '✓' : ''}</span>${esc(showLabel)}</button>`);
  if (!od.canDelete) items.push('<button type="button" data-od-act="reconnect">지우기를 쓰려면 다시 연결</button>');
  items.push('<button type="button" class="od-link-danger" data-od-act="disconnect">연결 끊기</button>');
  return status + items.join('');
}

// 화면마다 하나씩 만든다(id·historyKey만 다르게). model()은 열 때마다 지금 상태를 돌려준다.
export function createOdLinkMenu({id, historyKey, label = '원드라이브', model, onAction}) {
  return createAnchoredMenu({id, className:'od-link-menu', label, historyKey,
    key:() => 'od', render:() => odLinkMenuHtml(model()),
    onAction:button => onAction(button.dataset.odAct || '')});
}
