import {bindRowSwipe} from './row-swipe.js';
import {notify} from './small-notice.js';
import {setMark, setSaved, sendSignal, unstar, restoreStar, removeMine, restoreMine} from './now-marks.js';
import {openRowMenu, appMenuPoint} from './row-menu.js';
// NOW-줄밀기(S49-3, 명진 11/03 08:55): Now 글 줄(사회운동·뉴스·보관)의 밀기·마우스 단추를 한 곳에서. 공용 줄 밀기(row-swipe.js)를 그대로 쓴다.
// 왼쪽 밀기 = 숨기기(사회운동 '관심 없음' 표시 + 목록에서 감춤, 뉴스 hidden_at), 오른쪽 밀기 = 보관(= 별표, 두 쪽 같음 — S67-09). 보관된 줄을 다시 밀면 풀기.
// [보관] 탭의 오른쪽 밀기 = 보관 풀기. 저장은 모두 서버(상세와 같은 now-marks.js), 누른 일마다 환류 기록. 알림 '숨겼어요 [되돌리기]'.
// PC·중간 폭은 밀기 대신 줄 위에 마우스를 올리면(또는 키보드 초점) 작은 [보관][숨기기]([보관] 탭은 [보관 풀기]).
// S67-11 NEWS-보관빼기(명진 11/19): 줄 오른쪽 ★(news-row.mjs, data-now-act="unstar")·밀기·마우스 단추·⋯·우클릭의 '보관 풀기'는 모두 dropSaved 하나 —
//   '보관에서 뺐어요 [되돌리기]' 5초, 되돌리면 원래 별표 시각·폴더로(원래 자리). 내가 넣은 기사(canDelete)는 [숨기기] 자리에 [삭제](deleteMine, 5초 [되돌리기]).
// 쓰는 법: bindNowRows(목록 칸, {row:'줄 선택자', itemOf:줄→{type,id}|null, isSaved:item→bool, canDelete:item→bool, saved:bool, changed:(item,kind,on)=>void})
//   changed kind: 'hide' | 'save'(on = 별표 켜짐) | 'release'(보관 탭에서 뺌, on = true) | 'delete'(on = 삭제됨, false = 되돌림).

export const HIDE_LABEL = '숨기기', SAVE_LABEL = '보관', RELEASE_LABEL = '보관 풀기', DELETE_LABEL = '삭제';
export const UNDO_MS = 5000; // 보관 빼기·삭제 되돌리기 알림은 5초(명진 11/19)

// 보관에서 빼기(별표 끄기) 하나 — 줄 ★·밀기·단추·⋯·우클릭이 모두 부른다. saved: [보관] 목록 칸이면 true(changed 'release'), 아니면 changed('save', false).
export async function dropSaved(item, {changed = () => {}, saved = false} = {}) {
  const prev = await unstar(item);
  sendSignal(item, 'unstar');
  if (saved) changed(item, 'release', true); else changed(item, 'save', false);
  notify('보관에서 뺐어요', {label: RELEASE_LABEL, ms: UNDO_MS, undo: async () => { await restoreStar(item, prev); sendSignal(item, 'star'); changed(item, 'save', true); }});
}
// 내가 넣은 기사 [삭제] — 줄 단추·⋯·우클릭·밀기와 상세 [삭제]가 같이 부른다. 공용 기사 행은 지우지 않는다(now-marks.js removeMine).
export async function deleteMine(item, {changed = () => {}} = {}) {
  const prev = await removeMine(item);
  if (prev?.starred_at) sendSignal(item, 'unstar');
  changed(item, 'delete', true);
  notify('삭제했어요', {label: '기사 삭제', ms: UNDO_MS, undo: async () => { await restoreMine(item, prev); if (prev?.starred_at) sendSignal(item, 'star'); changed(item, 'delete', false); }});
}

// 줄에 넣는 마우스 단추(밀기를 못 하는 기기용). 폰 폭에서는 CSS가 감춘다. canDelete: 내가 넣은 기사면 [숨기기] 대신 [삭제]([보관] 탭은 [보관 풀기] 뒤에).
export function hoverActsHtml({saved = false, isSaved = false, canDelete = false} = {}) {
  const btn = ({id, label}) => `<button type="button" class="now-hov-btn" data-now-act="${id}">${label}</button>`;
  return `<span class="now-hov" role="group" aria-label="이 글 처리">${rowMenuItems({saved, isSaved, canDelete}).map(btn).join('')}</span>`;
}
// 줄 ⋯·우클릭 메뉴 항목(밀기·단추와 같은 이름).
export function rowMenuItems({saved = false, isSaved = false, canDelete = false} = {}) {
  const del = canDelete ? [{id: 'delete', label: DELETE_LABEL}] : [];
  if (saved) return [{id: 'release', label: RELEASE_LABEL}, ...del];
  return [{id: 'save', label: isSaved ? RELEASE_LABEL : SAVE_LABEL}, ...(del.length ? del : [{id: 'hide', label: HIDE_LABEL}])];
}

// titleOf: 우클릭 메뉴 머리에 보일 줄 제목(기본은 News 줄의 .nw-title — 다른 화면이 같은 줄 밀기를 쓸 때 줄 제목 위치를 알려 준다: 홈 읽을 만한 글).
const nwTitle = el => el.querySelector('.nw-title')?.textContent || '';
export function bindNowRows(host, {row, itemOf, isSaved = () => false, canDelete = () => false, saved = false, changed = () => {}, enabled = () => true, titleOf = nwTitle} = {}) {
  if (!host) return {close() {}};
  const fail = () => notify('저장하지 못했어요 · 잠시 뒤 다시', {error: true});
  const busy = new Set(); // 같은 글을 빠르게 두 번 눌러도 한 번만
  // 하나를 하고 되돌리기 길을 알림에 건다.
  async function run(key, item) {
    const id = item.type + ':' + item.id;
    if (busy.has(id)) return;
    busy.add(id);
    try {
      if (key === 'hide') {
        await setMark(item, 'dismiss', true); sendSignal(item, 'dismiss'); changed(item, 'hide', true);
        notify('숨겼어요', {label: '글 숨기기', undo: async () => { await setMark(item, 'dismiss', false); sendSignal(item, 'undismiss'); changed(item, 'hide', false); }});
      } else if (key === 'release' || key === 'unstar' || (key === 'save' && isSaved(item))) {
        await dropSaved(item, {changed, saved});
      } else if (key === 'save') {
        await setSaved(item, true); sendSignal(item, 'star'); changed(item, 'save', true);
        notify('보관했어요', {label: '글 보관', undo: async () => { await setSaved(item, false); sendSignal(item, 'unstar'); changed(item, 'save', false); }});
      } else if (key === 'delete' && canDelete(item)) {
        await deleteMine(item, {changed});
      }
    } catch { fail(); }
    finally { busy.delete(id); }
  }
  const menuItems = item => rowMenuItems({saved, isSaved: isSaved(item), canDelete: canDelete(item)});
  const swipe = bindRowSwipe(host, {row, enabled,
    actions: el => {
      const item = itemOf(el); if (!item) return null;
      const del = canDelete(item) ? {key: 'delete', label: DELETE_LABEL, tone: 'danger'} : null;
      if (saved) return {start: {key: 'release', label: RELEASE_LABEL, tone: 'info'}, end: del};
      return {start: {key: 'save', label: isSaved(item) ? RELEASE_LABEL : SAVE_LABEL, tone: 'info'}, end: del || {key: 'hide', label: HIDE_LABEL, tone: 'muted'}};
    },
    run: (key, el) => { const item = itemOf(el); if (item) run(key, item); }});
  host.addEventListener('click', event => {
    const b = event.target.closest?.('[data-now-act]'); if (!b || !host.contains(b)) return;
    const el = b.closest(row), item = el && itemOf(el); if (!item) return;
    event.preventDefault(); event.stopPropagation();
    run(b.dataset.nowAct, item);
  }, true);
  // 줄 ⋯(data-now-more, 노트 'News에서 › 보관한 글' 줄 — note-news-marks.js): 우클릭과 같은 줄 메뉴를 그 ⋯ 옆에 연다.
  host.addEventListener('click', event => {
    const b = event.target.closest?.('[data-now-more]'); if (!b || !host.contains(b) || !enabled()) return;
    const el = b.closest(row), item = el && itemOf(el); if (!item) return;
    event.preventDefault(); event.stopPropagation();
    openRowMenu(b, {key: 'now:' + item.type + ':' + item.id, title: (titleOf(el) || '').replace(/\s+/g, ' ').trim(), items: menuItems(item), run: key => run(key, item)});
  }, true);
  // S51-27 UI-PC우클릭: PC에서 줄을 우클릭(또는 Shift+F10)하면 크롬 기본 메뉴 대신 누른 자리에 같은 [보관][숨기기]([보관] 탭은 [보관 풀기]) — 공용 줄 메뉴(row-menu.js).
  host.addEventListener('contextmenu', event => {
    const el = event.target.closest?.(row); if (!el || !host.contains(el) || !enabled()) return;
    const item = itemOf(el); if (!item) return;
    const at = appMenuPoint(event, el); if (!at) return;
    const title = (titleOf(el) || '').replace(/\s+/g, ' ').trim();
    if (openRowMenu(el, {key: 'now:' + item.type + ':' + item.id, title, items: menuItems(item), at, run: key => run(key, item)})) event.preventDefault();
  });
  return swipe;
}
