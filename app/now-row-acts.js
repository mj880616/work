import {bindRowSwipe} from './row-swipe.js';
import {notify} from './small-notice.js';
import {setMark, setSaved, release, savedAction, sendSignal} from './now-marks.js';
// NOW-줄밀기(S49-3, 명진 11/03 08:55): Now 글 줄(사회운동·뉴스·보관)의 밀기·마우스 단추를 한 곳에서. 공용 줄 밀기(row-swipe.js)를 그대로 쓴다.
// 왼쪽 밀기 = 숨기기(사회운동 '관심 없음' 표시 + 목록에서 감춤, 뉴스 hidden_at), 오른쪽 밀기 = 보관(사회운동 보관 표시, 뉴스 별표). 보관된 줄을 다시 밀면 풀기.
// [보관] 탭의 오른쪽 밀기 = 보관 풀기. 저장은 모두 서버(상세와 같은 now-marks.js), 누른 일마다 환류 기록. 알림 '숨겼어요 [되돌리기]'.
// PC·중간 폭은 밀기 대신 줄 위에 마우스를 올리면(또는 키보드 초점) 작은 [보관][숨기기]([보관] 탭은 [보관 풀기]).
// 쓰는 법: bindNowRows(목록 칸, {row:'줄 선택자', itemOf:줄→{type,id}|null, isSaved:item→bool, saved:bool, changed:(item,kind,on)=>void})

export const HIDE_LABEL = '숨기기', SAVE_LABEL = '보관', RELEASE_LABEL = '보관 풀기';

// 줄에 넣는 마우스 단추(밀기를 못 하는 기기용). 폰 폭에서는 CSS가 감춘다.
export function hoverActsHtml({saved = false, isSaved = false} = {}) {
  const save = saved ? `<button type="button" class="now-hov-btn" data-now-act="release">${RELEASE_LABEL}</button>`
    : `<button type="button" class="now-hov-btn" data-now-act="save">${isSaved ? RELEASE_LABEL : SAVE_LABEL}</button><button type="button" class="now-hov-btn" data-now-act="hide">${HIDE_LABEL}</button>`;
  return `<span class="now-hov" role="group" aria-label="이 글 처리">${save}</span>`;
}

export function bindNowRows(host, {row, itemOf, isSaved = () => false, saved = false, changed = () => {}, enabled = () => true} = {}) {
  if (!host) return {close() {}};
  const fail = () => notify('저장하지 못했어요 · 잠시 뒤 다시', {error: true});
  // 하나를 하고 되돌리기 길을 알림에 건다.
  async function run(key, item) {
    try {
      if (key === 'hide') {
        await setMark(item, 'dismiss', true); sendSignal(item, 'dismiss'); changed(item, 'hide', true);
        notify('숨겼어요', {label: '글 숨기기', undo: async () => { await setMark(item, 'dismiss', false); sendSignal(item, 'undismiss'); changed(item, 'hide', false); }});
      } else if (key === 'release') {
        await release(item); sendSignal(item, item.type === 'news' ? 'unstar' : 'unarchive'); changed(item, 'release', true);
        notify('보관을 풀었어요', {label: '보관 풀기', undo: async () => { await setSaved(item, true); sendSignal(item, savedAction(item)); changed(item, 'save', true); }});
      } else if (key === 'save') {
        const on = !isSaved(item);
        await setSaved(item, on); sendSignal(item, on ? savedAction(item) : 'un' + savedAction(item)); changed(item, 'save', on);
        notify(on ? '보관했어요' : '보관을 풀었어요', {label: on ? '글 보관' : '보관 풀기', undo: async () => { await setSaved(item, !on); sendSignal(item, !on ? savedAction(item) : 'un' + savedAction(item)); changed(item, 'save', !on); }});
      }
    } catch { fail(); }
  }
  const swipe = bindRowSwipe(host, {row, enabled,
    actions: el => {
      const item = itemOf(el); if (!item) return null;
      if (saved) return {start: {key: 'release', label: RELEASE_LABEL, tone: 'info'}, end: null};
      return {start: {key: 'save', label: isSaved(item) ? RELEASE_LABEL : SAVE_LABEL, tone: 'info'}, end: {key: 'hide', label: HIDE_LABEL, tone: 'muted'}};
    },
    run: (key, el) => { const item = itemOf(el); if (item) run(key, item); }});
  host.addEventListener('click', event => {
    const b = event.target.closest?.('[data-now-act]'); if (!b || !host.contains(b)) return;
    const el = b.closest(row), item = el && itemOf(el); if (!item) return;
    event.preventDefault(); event.stopPropagation();
    run(b.dataset.nowAct, item);
  }, true);
  return swipe;
}
