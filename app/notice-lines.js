// UI-앱안알림 2단계(docs/design/in-app-notices.md 4절 1·2): 맨 위 알림 줄의 '연결 끊김'·'수집 멈춤' 두 손님.
// 자리·높이는 notice-bar.js가 맡고, 이 파일은 두 줄의 상태 주인이자 유일한 렌더러다.
// - 연결 끊김(순서 1): link-state.js(이미 하던 Google 할 일·원드라이브 읽기 결과)만 본다. 새 서버 호출 없음.
//   [다시 연결]: Google은 할 일 화면과 같은 연결 시작(KPTUGoogleTasks.connect), 원드라이브는 다시 연결하는 사진 화면으로.
//   ✕는 지금은 이 탭에서만 닫힌다(메모리). 폰·PC가 같게 서버에 기억하려면 프로필 화면 설정 칸이 하나 더 필요하다(DB 변경 → 그 직전에 멈춤, PR 댓글).
// - 수집 멈춤(순서 2, 운영자 작업공간만): 내 프로필 '마지막 수집 시각' 칸과 같은 읽기·같은 기준(collection-status.js readCollectionAttention).
//   읽기는 그 칸과 같은 탭 메모리 10분을 함께 쓴다. [보기]는 내 프로필 수집 칸으로. 그 칸이 보이는 내 프로필 화면에서는 줄을 내린다(같은 안내 두 곳 금지).
//   ✕는 '오늘 하루 숨김'(서버 프로필 view_prefs.collect_hidden_on) — 다른 기기에서도 오늘은 안 뜨고, 다음 날 아직 멈춰 있으면 다시 뜬다.
// 상태가 풀리면(다시 연결됨·수집 재개) 줄은 저절로 사라진다.
import {putNotice, removeNotice} from './notice-bar.js';
import {onLinkState, brokenLinks, resetLinks} from './link-state.js';
import {readCollectionAttention, alertText, collectHiddenToday, hideCollectToday} from './collection-status.js';

const WARN_ICON = '<svg class="kptu-notice-line-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 16.5h15zM10 8.5v3.5M10 14.2v.3"/></svg>';
export const LINK_TEXT = Object.freeze({
  google:'Google 연결이 끊겨 일정·할 일 저장이 안 돼요',
  onedrive:'원드라이브 연결이 풀려 사진을 못 읽어요',
});
export function linkLineText(sources) {
  if (!sources.length) return '';
  return sources.length > 1 ? `${LINK_TEXT[sources[0]]} 외 ${sources.length - 1}` : LINK_TEXT[sources[0]];
}
function makeLine(key, label, action) {
  const el = document.createElement('aside');
  el.className = 'kptu-notice-line'; el.dataset.tone = 'warn'; el.dataset.notice = key; el.setAttribute('aria-label', label);
  el.innerHTML = `${WARN_ICON}<span role="status"></span><button type="button" class="kptu-notice-line-action" data-notice-act>${action}</button><button type="button" class="kptu-notice-line-close" data-notice-close aria-label="닫기">✕</button>`;
  return el;
}
const go = (view, opts = {}) => window.KPTURouter?.go?.(view, {source:'delegated', ...opts});

export function startNoticeLines({rt = window.KPTURuntime} = {}) {
  // ---- 연결 끊김 ----
  const closedLinks = new Set(); // 이 탭에서 ✕로 닫은 출처(메모리만)
  let linkLine = null;
  function paintLinks() {
    const sources = brokenLinks().filter(source => !closedLinks.has(source));
    for (const source of [...closedLinks]) if (!brokenLinks().includes(source)) closedLinks.delete(source); // 풀렸다가 다시 끊기면 다시 뜬다
    if (!sources.length) { if (linkLine) { removeNotice('link'); linkLine = null; } return; }
    if (!linkLine) {
      linkLine = makeLine('link', '연결 끊김 안내', '다시 연결');
      linkLine.querySelector('[data-notice-act]').onclick = () => {
        const first = brokenLinks().find(source => !closedLinks.has(source));
        if (first === 'google' && typeof window.KPTUGoogleTasks?.connect === 'function') void window.KPTUGoogleTasks.connect();
        else go(first === 'onedrive' ? 'photos' : 'tasks');
      };
      linkLine.querySelector('[data-notice-close]').onclick = () => { for (const source of brokenLinks()) closedLinks.add(source); paintLinks(); };
    }
    linkLine.dataset.sources = sources.join(' ');
    linkLine.querySelector('[role="status"]').textContent = linkLineText(sources);
    putNotice('link', {priority:10, element:linkLine});
  }
  const offLinks = onLinkState(paintLinks);

  // ---- 수집 멈춤 ----
  let collectLine = null, run = 0;
  function dropCollect() { if (collectLine) { removeNotice('collect'); collectLine = null; } }
  async function refreshCollect() {
    const mine = ++run;
    if (window.KPTURouter?.current === 'profile' || collectHiddenToday()) { dropCollect(); return; }
    const sum = await readCollectionAttention(rt).catch(() => null);
    if (mine !== run) return;
    if (!sum?.attention?.length || window.KPTURouter?.current === 'profile' || collectHiddenToday()) { dropCollect(); return; }
    if (!collectLine) {
      collectLine = makeLine('collect', '수집 멈춤 안내', '보기');
      collectLine.querySelector('[data-notice-act]').onclick = () => {
        go('profile');
        requestAnimationFrame(() => document.getElementById('psStatusPanel')?.scrollIntoView({block:'start'}));
      };
      collectLine.querySelector('[data-notice-close]').onclick = () => { hideCollectToday(); run++; dropCollect(); };
    }
    collectLine.querySelector('[role="status"]').textContent = alertText(sum.attention);
    putNotice('collect', {priority:20, element:collectLine});
  }
  const onView = () => { void refreshCollect(); };
  const onVisible = () => { if (document.visibilityState === 'visible') void refreshCollect(); };
  window.addEventListener('kptu:view-changed', onView);
  window.addEventListener('kptu:view-prefs-ready', onView);
  document.addEventListener('visibilitychange', onVisible);

  // 로그인한 사람이 바뀌면 앞사람의 줄과 연결 상태를 버린다(같은 사람의 토큰 갱신은 그대로).
  const owner = rt?.session?.read?.()?.user?.id;
  function sessionChanged(event) {
    if (owner && event.detail?.session?.user?.id === owner) return;
    run++; dropCollect(); closedLinks.clear(); resetLinks();
    offLinks(); window.removeEventListener('kptu:view-changed', onView); window.removeEventListener('kptu:view-prefs-ready', onView);
    document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('kptu:session-changed', sessionChanged);
  }
  window.addEventListener('kptu:session-changed', sessionChanged);
  paintLinks();
  void refreshCollect();
  return {refreshCollect, paintLinks};
}
