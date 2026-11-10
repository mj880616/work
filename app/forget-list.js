// S52-20 HOME-잊지말기한목록(요청함 11/07 14:37, 시안 docs/design/mockups/forget-one-list.html, 명진 14:44 '좋은데'): 정리함 화면 안의 한 목록.
// 텔레그램 요청·챙길 것·가족(잊지 말기 제안)·업데이트는 들어오는 곳만 다를 뿐 같은 결정이라, 칸을 나누지 않고 같은 줄·같은 버튼으로 한 목록(새 것이 위)에 둔다.
// - 줄 = 공용 부품 notice-box.mjs rowHtml 하나(새 모양 없음). 다른 점은 아래 작은 줄 맨 앞 흐린 출처 꼬리표뿐.
// - FORGET-소식바로잡기(요청함 11/09 01:45, 시안 docs/design/mockups/forget-news-fix.html, 명진 'ㅇ'): 출처와 상관없이 모든 줄이 같은 버튼 일곱
//   [할 일로][일정으로][노트로][조직][사업][이미 함] ×(NB_REPORT_ACTS). 가족 줄만 [조직][사업] 없이 다섯(보고 길 막음 유지).
//   [조직]은 담당조직 고르기 창(맨 위에 '조직 › ○○에 넣기' — 줄의 조직이 내 담당조직과 맞을 때 한 번에), [사업]은 사업 고르기 창이고,
//   고르면 기존 기록 길(quick-save.js 담당조직 기록 → 이번 주 조직보고 제안 / 사업 기록 → 사업 보고·주간보고 사업 칸)로 넣는다.
// - 위 오른쪽 [처리 전 ▾] 하나(공용 작은 메뉴 anchored-menu.js): 처리 전·보냄·이미 함·무시·연결 완료(업데이트), 아래쪽에 출처 거르기.
// - 서버·원본·버튼 동작은 그대로다. 챙길 것·텔레그램 줄은 기존 후보 길(todo-radar-data.js, 소유자 RLS 표), 가족 줄은 기존 잊지 말기 길
//   (family-notes-data.js, 서버 운영자 기능 family + 소유자 RLS — 화면 숨김은 보안이 아니다), 업데이트 줄은 정리함(basket.js)의 기존 길에 맡긴다
//   (basket.js가 줄 재료를 set으로 넘기고, 업데이트 줄의 버튼은 onUpdateAct로 돌려준다).
// - FORGET-소식합치기(11/08): 업무일지 '기억할 통화·텔레그램' 줄도 출처 '소식'(꼬리표 '소식 · 텔레그램'/'소식 · 통화')으로 이 목록에 둔다.
//   읽기·쓰기는 forget-news-data.js(서버 표 app_journal_memorable 그대로). 버튼은 다른 줄과 같은 일곱(옛 소식 줄만의 ⋯·[무시]는 없앰 — ×가 무시).
//   운영자 기능(통화·텔레그램)은 서버 판정 그대로다.
// - 가족 줄은 이 화면에 보이기만 한다. 업데이트·원장·주간보고·업무일지·AI 길에는 넘기지 않는다(docs/design/tg-personal.md 7절).
// 이 파일이 이 목록 자리의 유일한 renderer다. 기기 저장 없음.
import {createAnchoredMenu} from './anchored-menu.js';
import {setHomeAsks} from './home-asks.js';
import {esc, rowHtml, foldActs} from './notice-box.mjs';
import {waitHtml, waitInlineHtml, emptyHtml} from './wait-state.js';
import {copyText} from './copy-text.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {seoulDateKey} from './meeting-time.js';
import {dueLabel} from './task-due.mjs';
import {readInboxCandidates, dismissCandidate, reopenCandidate, markDone, markTasked, markNotMine, undoNotMine, candidateToTask, validateTaskDraft,
  notPlanned, quickDue, dotDay, radarScope, RADAR_SOURCE_LABEL, logFeedback, dropFeedback, ledgerRequestText, linkCandidateToTask, unlinkCandidate, dropCandidateOnly, taskLinks, sourceText} from './todo-radar-data.js';
import {similarTasks} from './todo-link-model.mjs';
import {FIRM_LABEL, draftOf, metaLine, noteLine} from './family-notes-model.mjs';
import {decide as decideFamily, hasFamily, readNotes} from './family-notes-data.js';
import {newsOn, readNews, pickTodayNews, decideNews, openNews, oldNews, recheckNews, newsText, matchOrg, openNewsSource, NEWS_SOURCE_TAG} from './forget-news-data.js';

const CHANGED = 'kptu:todo-radar-changed';
// FORGET-노트고르기: 업무 줄 [노트]의 처음 폴더(맨 위 폴더 이름, 없으면 폴더 없음).
export const WORK_NOTE_FOLDER = '01. 업무메모';
// 보기(처리 상태)와 출처. 이름은 시안 그대로.
export const FORGET_VIEWS = Object.freeze([['open', '처리 전'], ['tasked', '보냄'], ['done', '이미 함'], ['dismissed', '무시'], ['linked', '연결 완료']]);
export const FORGET_SOURCES = Object.freeze([['all', '모든 출처'], ['telegram', '텔레그램'], ['news', '소식'], ['family', '가족'], ['update', '업데이트'], ['todo', '챙길 것']]);
export const SOURCE_TAG = Object.freeze({telegram: '텔레그램', news: '소식', family: '가족', update: '업데이트', todo: '챙길 것', promise: '상대 약속'});
// FORGET-소식합치기: 소식 줄이 그 보기에 드는가(처리 전 = suggested, 연결 완료 = 조직·사업에 넣음 kept, 무시 = dropped).
export const NEWS_VIEW = Object.freeze({open: 'suggested', linked: 'kept', dismissed: 'dropped'});
// 처리 전은 새 기준(AI가 종류를 정한) 줄만 — 빨간 숫자와 같은 기준(forget-news-data.js openNews). picks: 종류를 읽을 수 있었는가.
export const newsFor = (view, rows, picks = false) => view === 'open' ? openNews(rows, picks) : (rows || []).filter(r => NEWS_VIEW[view] && r.status === NEWS_VIEW[view]);
// AI가 정한 종류 → 굵게 보일 버튼(같은 이름). 누르는 건 사람이다.
export const NEWS_HINT = Object.freeze({task: 'task', event: 'event', note: 'note', org: 'org', area: 'area'});
export const newsDone = r => { const d = shortDay(r.decidedAt ? seoulDateKey(new Date(r.decidedAt)) : ''); const t = r.status === 'kept' ? '처리함' : '무시함'; return d ? `${t} · ${d}` : t; };

const shortDay = v => { const m = String(v ?? '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${Number(m[1])}/${Number(m[2])}` : ''; };
const cut = (v, n) => [...String(v ?? '')].slice(0, n).join('');
export const candidateSource = c => c?.source_kind === 'telegram' ? 'telegram' : 'todo';
// 아래 작은 줄 왼쪽 글(출처 꼬리표 뒤). 텔레그램: 방 이름 · 날짜 · 기한. 챙길 것: '업데이트에서' 같은 원래 기록 · 날짜 · 기한.
export function candidateMeta(c) {
  const from = c?.source_kind === 'telegram' ? (c?.tg?.room_label || '') : RADAR_SOURCE_LABEL[c?.source_kind] ? `${RADAR_SOURCE_LABEL[c.source_kind]}에서` : '';
  return [from, shortDay(c?.source_day), c?.status === 'open' && dueLabel(c?.due) ? `기한 ${dueLabel(c.due)}` : ''].filter(Boolean).join(' · ');
}
// 할 일·일정·노트 창에 미리 채울 글. 날짜는 바꾸지 않는다(명진이 창에서 고름).
export const candidateDraft = c => ({title: cut(c?.summary, 100),
  memo: [c?.source_kind === 'telegram' ? '텔레그램' : RADAR_SOURCE_LABEL[c?.source_kind] || '', c?.tg?.room_label || '', shortDay(c?.source_day)].filter(Boolean).join(' · ')});
const decidedDay = c => c?.decided_at && Number.isFinite(Date.parse(c.decided_at)) ? dotDay(seoulDateKey(new Date(c.decided_at))) : '';
const alreadyDropped = c => c.status === 'dismissed' && c.outcome === 'already_tasked';
// 처리한 후보 줄의 오른쪽 상태 글.
export function candidateDone(c) {
  const day = decidedDay(c), at = t => day ? `${t} · ${day}` : t;
  if (c.outcome === 'already_tasked' && (c.status === 'tasked' || c.status === 'dismissed')) return at('이미 할 일에 있음');
  if (c.status === 'dismissed') return at(c.outcome === 'not_mine' ? '내 일 아님' : '무시함');
  if (c.status === 'done') return at('이미 함');
  const due = c.task_due ? dotDay(c.task_due) : '';
  return due ? `할 일로 보냄 · ${due}` : '할 일로 보냄';
}
// 보기마다 그 보기에 드는 후보(새 것이 위: 처리 전은 만든 때, 그 밖은 처리한 때).
export function candidatesFor(view, rows, taskTitles = []) {
  if (view === 'open') return notPlanned(rows.filter(r => r.status === 'open'), taskTitles);
  if (view === 'tasked') return rows.filter(r => r.status === 'tasked' || alreadyDropped(r));
  if (view === 'dismissed') return rows.filter(r => r.status === 'dismissed' && !alreadyDropped(r));
  if (view === 'done') return rows.filter(r => r.status === 'done');
  return [];
}
// 여러 출처의 줄을 새 것이 위로 하나로(같은 때는 들어온 순서 그대로).
export const newestFirst = items => items.map((x, i) => [x, i]).sort((a, b) => String(b[0].at || '').localeCompare(String(a[0].at || '')) || a[1] - b[1]).map(([x]) => x);
const taskTitles = () => (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);

// host: 줄을 그릴 <ul>(바깥 칸은 notice-box 'list' 톤). statusEl: 목록 아래 상태 줄. viewButton: [처리 전 ▾].
// updates(): {loading, items:[{id, at, body, meta, done, below, tail, attrs, open}]} — basket.js가 지금 보기의 업데이트 줄 재료를 준다.
// onUpdateAct(id, act, button): 업데이트 줄 버튼(org·area·task·event·note·done·dismissed). onView(view): 보기가 바뀌면(업데이트 거르기를 맞춤).
// radarPromises(): 찾기가 돌려준 상대 약속(저장하지 않음, todo-radar.js) — 처리 전 맨 아래 같은 줄로, 버튼은 [원장으로](쓰기요청 글 복사) 하나. 세지 않는다.
export function mountForgetList(host, {rt = window.KPTURuntime, win = window, statusEl = null, viewButton = null, updates = () => ({loading: false, items: []}), onUpdateAct = () => {}, onView = () => {}, radarPromises = () => [], openSource = () => {}, updateCount = () => null} = {}) {
  if (!host) return null;
  let view = 'open', src = 'all', rows = [], cState = 'loading', notes = [], fOn = false, fWs = '', run = 0, status = '', scope = radarScope(rt);
  // fix: 옛 소식 정리(FORGET-소식바로잡기 ④) 한 줄의 상태 — null(안 함) · {phase:'preview'|'confirm'|'run', keep, drop, left}.
  let news = [], nOn = false, nPicks = false, nRun = 0, orgRead = null, fix = null; // 소식 줄(FORGET-소식합치기)과 조직 이름 맞추기에 쓰는 내 담당조직(readOrganizations, 한 번)
  const busy = new Set(), unknown = new Set(), linking = new Map();
  const ws = () => rt.context?.read?.()?.workspace?.id || '';
  const changed = () => win.dispatchEvent(new CustomEvent(CHANGED, {detail: {reload: true}}));
  const byId = id => rows.find(r => r.id === id);
  const say = text => { status = text; paint(); };

  // 보기 메뉴: 위쪽 보기 5개, 아래쪽 출처 5개. 고른 것만 aria-checked(선택 표시 규칙).
  const menu = viewButton ? createAnchoredMenu({id: 'forgetViewMenu', className: 'radar-row-menu forget-view-menu', label: '목록 보기', historyKey: 'kptuForgetViewMenu',
    key: () => 'view', boxWidth: 180,
    render: () => FORGET_VIEWS.map(([v, l]) => `<button type="button" class="row-act" role="menuitemradio" aria-checked="${v === view}" data-forget-view="${v}">${esc(l)}</button>`).join('')
      + '<hr class="forget-view-sep" aria-hidden="true">'
      + FORGET_SOURCES.map(([v, l]) => `<button type="button" class="row-act" role="menuitemradio" aria-checked="${v === src}" data-forget-src="${v}">${esc(l)}</button>`).join(''),
    onAction: button => {
      if (button.dataset.forgetView) setView(button.dataset.forgetView);
      else if (button.dataset.forgetSrc) { src = button.dataset.forgetSrc; status = ''; paint(); }
    }}) : null;
  // 줄 ⋯(UI-잊지말기줄단추, 처리 전 줄마다 하나 — 우클릭도 같은 메뉴): 폰에서 줄에 없는 [일정으로][노트로][조직][사업]·×([무시])를 줄 버튼과
  // 같은 이름·같은 길(rowAct)로 먼저, 그 아래 챙길 것 줄만의 기존 셋 [수정해서 할 일로] · [이미 할 일에 있음] · [내 일 아님]. 가족 줄은 조직·사업 없음.
  const rowKind = key => String(key || '').slice(0, 1);
  const more = createAnchoredMenu({id: 'forgetRowMenu', className: 'radar-row-menu', label: '잊지 말기 줄 메뉴', historyKey: 'kptuForgetRowMenu',
    key: trigger => trigger.dataset.forgetMore, canOpen: trigger => !trigger.disabled, row: trigger => trigger.closest('[data-nbx-row]'),
    render: key => {
      const kind = rowKind(key), c = kind === 'c' ? byId(key.slice(2)) : null;
      const hint = host.querySelector(`[data-nbx-row="${CSS.escape(key)}"] [data-nbx-hint]`)?.dataset.nbxAct || ''; // AI가 고른 버튼은 메뉴에서도 굵게
      const folded = foldActs({report: kind !== 'f'}).map(([act, label]) => `<button type="button" class="row-act${act === hint ? ' nbx-hint' : ''}" data-nbx-menu-act="${act}">${esc(label)}</button>`).join('');
      return folded + (c && candidateSource(c) === 'todo'
        ? '<button type="button" class="row-act" data-forget-menu="edit">수정해서 할 일로</button><button type="button" class="row-act" data-forget-menu="already">이미 할 일에 있음</button><button type="button" class="row-act" data-forget-menu="not-mine">내 일 아님</button>' : '');
    },
    onAction: (button, active) => {
      const key = active.trigger.dataset.forgetMore;
      if (button.dataset.nbxMenuAct) { rowAct(key, button.dataset.nbxMenuAct, active.trigger); return; }
      const c = rowKind(key) === 'c' ? byId(key.slice(2)) : null, act = button.dataset.forgetMenu;
      if (!c || c.status !== 'open' || busy.has(c.id)) return;
      if (act === 'not-mine') void notMine(c); else if (act === 'already') void startLinking(c); else if (act === 'edit') void editToTask(c);
    }});

  function paintViewButton() {
    if (!viewButton) return;
    const label = FORGET_VIEWS.find(([v]) => v === view)?.[1] || '처리 전';
    viewButton.textContent = `${label}${src === 'all' ? '' : ` · ${SOURCE_TAG[src]}`} ▾`;
    viewButton.dataset.forgetCurrent = view;
  }
  function items() {
    const out = [];
    if (src === 'all' || src === 'telegram' || src === 'todo') {
      for (const c of candidatesFor(view, rows, taskTitles())) {
        const s = candidateSource(c); if (src !== 'all' && src !== s) continue;
        const open = c.status === 'open', isBusy = busy.has(c.id);
        out.push({at: open ? c.created_at : (c.decided_at || c.created_at), html: rowHtml({id: `c:${c.id}`, body: c.summary, meta: candidateMeta(c), src: SOURCE_TAG[s], busy: isBusy, report: true,
          // 내용을 누르면 원래 기록(업데이트·노트·사업 보고·조직 기록·텔레그램 방)을 연다 — 기존 출처 열기 길(todo-radar.js openSource).
          open: {attrs: `data-forget-source="${esc(c.id)}" aria-label="${esc(`${c.summary} — 출처 열기: ${sourceText(c)}`)}"`},
          done: !open ? candidateDone(c) : unknown.has(c.id) ? '결과 확인 필요 · 할 일 화면에서 확인' : '', more: `data-forget-more="c:${esc(c.id)}"`, attrs: `data-forget-src="${s}"`, below: open ? linkingHtml(c) : ''})});
      }
    }
    if (view === 'open' && fOn && (src === 'all' || src === 'family')) {
      for (const n of notes) out.push({at: n.at || n.day, html: rowHtml({id: `f:${n.id}`, body: n.body, meta: metaLine(n), src: SOURCE_TAG.family, busy: busy.has(`f:${n.id}`),
        prefix: FIRM_LABEL[n.firmness] ? `<span class="nbx-tag">${esc(FIRM_LABEL[n.firmness])}</span> ` : '', more: `data-forget-more="f:${esc(n.id)}"`, attrs: 'data-forget-src="family"'})});
    }
    if (nOn && (src === 'all' || src === 'news')) {
      for (const r of newsFor(view, news, nPicks)) {
        const open = r.status === 'suggested', label = newsText(r);
        out.push({at: open ? r.at : (r.decidedAt || r.at), html: rowHtml({id: `n:${r.id}`, body: label, meta: shortDay(r.day), src: NEWS_SOURCE_TAG[r.source], busy: busy.has(`n:${r.id}`),
          open: {attrs: `data-forget-news-open="${esc(r.id)}" aria-label="${esc(`${label} — 원본 ${r.source === 'telegram' ? '텔레그램' : '통화'} 열기`)}"`},
          report: true, hint: open ? NEWS_HINT[r.kind] || '' : '', why: open ? r.reason : '', done: open ? '' : newsDone(r), more: `data-forget-more="n:${esc(r.id)}"`, attrs: `data-forget-src="news"`})});
      }
    }
    if (src === 'all' || src === 'update') {
      for (const u of updates().items || []) out.push({at: u.at, html: rowHtml({id: `u:${u.id}`, body: u.body, meta: u.meta, src: SOURCE_TAG.update, busy: !!u.busy,
        report: true, done: view === 'open' ? '' : (u.done || ' '), open: u.open, tail: u.tail || '', below: u.below || '', attrs: `data-forget-src="update" ${u.attrs || ''}`})});
    }
    const sorted = newestFirst(out);
    // 상대 약속: 처리 전·모든 출처일 때만, 맨 아래(시각 없음). 처리 상태가 없어 다른 보기에는 없다.
    if (view === 'open' && src === 'all' && cState === 'ok') (radarPromises() || []).forEach((p, i) => sorted.push({html: rowHtml({id: `p:${i}`, body: p.summary, src: SOURCE_TAG.promise,
      meta: [RADAR_SOURCE_LABEL[p.source_kind] || '', dueLabel(p.due) ? `기한 ${dueLabel(p.due)}` : ''].filter(Boolean).join(' · '), acts: [['ledger', '원장으로']], attrs: 'data-forget-src="promise" data-inbox-promise'})}));
    return sorted;
  }
  // ⋯ [이미 할 일에 있음]: 제목이 비슷한 열린 할 일 몇 개(같은 ③ 글자 버튼). 고르면 그 할 일과 잇고 목록에서 뺀다. 새 할 일은 만들지 않는다.
  function linkingHtml(c) {
    const l = linking.get(c.id); if (!l) return '';
    const id = esc(c.id), dis = busy.has(c.id) ? ' disabled' : '';
    const picks = l.tasks === null ? waitInlineHtml()
      : l.tasks.length ? l.tasks.map(t => `<button type="button" class="row-act" data-forget-link-task="${esc(t.id)}" data-forget-link-for="${id}"${dis}>${esc(t.title)}</button>`).join('')
      : `<span class="nbx-faint">${l.failed ? '할 일을 못 읽었어요.' : '비슷한 할 일을 못 찾았어요.'}</span>${l.failed ? `<button type="button" class="row-act" data-forget-link-retry="${id}"${dis}>다시</button>` : ''}`;
    return `<div class="nbx-below" data-forget-link="${id}" role="group" aria-label="이미 있는 할 일 선택">${picks}<button type="button" class="row-act" data-forget-link-none="${id}"${dis}>그냥 빼기</button><button type="button" class="row-act" data-forget-link-cancel="${id}"${dis}>취소</button></div>`;
  }
  function paint() {
    paintViewButton();
    // UI-앱안알림 3단계(A4) → S52-20: 메뉴 '홈' 표시는 홈 '잊지 말기' 한 줄과 같은 숫자(처리 안 한 수, 새 읽기 없음).
    { const n = api.openCount(updateCount()); if (n !== null) setHomeAsks(n); }
    const list = items(), u = updates();
    const focus = host.contains(document.activeElement) ? {row: document.activeElement.closest('[data-nbx-row]')?.dataset.nbxRow, act: document.activeElement.dataset.nbxAct || ''} : null;
    if (list.length) host.innerHTML = list.map(x => x.html).join('');
    // 업데이트를 읽는 동안의 기다림은 정리함의 상태 줄(basket.js)이 보인다. 여기서는 후보만 기다릴 때 그린다(기다림 표시 하나).
    else if (u.loading) host.innerHTML = '';
    else if (cState === 'loading') host.innerHTML = `<li>${waitHtml({rows: 2})}</li>`;
    else host.innerHTML = `<li>${emptyHtml('없음', {attrs: 'data-forget-empty'})}</li>`;
    if (statusEl) {
      const fail = cState === 'failed' ? '챙길 것을 불러오지 못했어요. <button type="button" class="row-act" data-forget-retry>다시 시도</button>' : '';
      statusEl.innerHTML = [esc(status), fail, fixHtml()].filter(Boolean).join(' ');
    }
    if (focus?.row) host.querySelector(`[data-nbx-row="${CSS.escape(focus.row)}"] ${focus.act ? `[data-nbx-act="${CSS.escape(focus.act)}"]` : 'button'}`)?.focus({preventScroll: true});
  }
  // FORGET-소식바로잡기 ④: 옛 기준으로 쌓인 처리 전 소식이 있을 때만 상태 줄에 작은 한 줄. [정리] → 서버 미리 보기 수 → [확인]으로 실행.
  // 판정·바꾸기는 모두 서버가 한다(forget-news-data.js recheckNews). 끝나면 옛 줄이 없어져 이 줄도 사라진다(한 번만 보임).
  function fixHtml() {
    if (!nOn || !nPicks || view !== 'open' || (src !== 'all' && src !== 'news')) return '';
    const n = oldNews(news, nPicks).length;
    if (!n && !fix) return '';
    if (fix?.phase === 'preview') return `<span class="nbx-faint" data-forget-fix>옛 소식 ${n}개 살펴보는 중…</span>`;
    if (fix?.phase === 'run') return `<span class="nbx-faint" data-forget-fix>옛 소식 정리하는 중…</span>`;
    if (fix?.phase === 'confirm') {
      const wait = fix.left ? ` · ${fix.left}개는 다음에` : '';
      return `<span data-forget-fix>옛 소식 ${n}개 중 ${fix.keep}개 남기고 ${fix.drop}개는 무시로${wait} <button type="button" class="row-act" data-forget-fix-go>확인</button><button type="button" class="row-act" data-forget-fix-cancel>취소</button></span>`;
    }
    return n ? `<span data-forget-fix>옛 소식 ${n}개 새 기준으로 정리 <button type="button" class="row-act" data-forget-fix-ask>정리</button></span>` : '';
  }
  async function fixNews(mode) {
    const owner = radarScope(rt);
    fix = {...(fix || {}), phase: mode}; status = ''; paint();
    const r = await recheckNews(rt, mode);
    if (owner !== radarScope(rt)) return;
    if (!r.ok) { fix = null; say('옛 소식을 정리하지 못했어요. 잠시 뒤 다시 눌러 주세요.'); return; }
    if (mode === 'preview') {
      if (!r.keep && !r.drop) { fix = null; say(r.left ? '지금은 정리할 옛 소식이 없어요.' : '정리할 옛 소식이 없어요.'); return; }
      fix = {phase: 'confirm', keep: r.keep, drop: r.drop, left: r.left}; paint(); return;
    }
    fix = null;
    status = `옛 소식 정리: ${r.keep}개 남김 · ${r.drop}개 무시`;
    await loadNews();
    paint();
  }
  function setView(next) {
    if (!FORGET_VIEWS.some(([v]) => v === next)) return;
    view = next; status = ''; onView(view); paint();
  }

  async function loadCandidates() {
    const mine = ++run; scope = radarScope(rt);
    const r = await readInboxCandidates(rt);
    if (mine !== run || scope !== radarScope(rt)) return;
    cState = r.missing ? 'missing' : r.ok ? 'ok' : 'failed';
    rows = r.ok ? r.rows : [];
    paint();
  }
  async function loadFamily() {
    const workspace = ws();
    if (!workspace) { fOn = false; notes = []; return; }
    if (fWs !== workspace) { fWs = workspace; fOn = await hasFamily(rt).catch(() => false); }
    if (!fOn) { notes = []; paint(); return; }
    try { const got = await readNotes(rt, workspace); if (workspace === ws()) { notes = got; paint(); } }
    catch { notes = []; paint(); } // 못 읽으면 가족 줄만 빠진다(업무 화면에 오류 줄을 남기지 않음)
  }
  // 소식(FORGET-소식합치기): 운영자 작업공간에서만 읽는다(서버가 다시 판정). 저장된 줄을 먼저 그리고, 오늘 고르기를 부탁해 새로 골랐으면 다시 읽는다.
  async function loadNews() {
    const mine = ++nRun, owner = radarScope(rt), live = () => mine === nRun && owner === radarScope(rt);
    const on = await newsOn(rt).catch(() => false);
    if (!live()) return;
    nOn = on;
    if (!on) { news = []; paint(); return; }
    const first = await readNews(rt);
    if (!live()) return;
    if (first.missing) { nOn = false; news = []; paint(); return; }
    if (first.ok) { news = first.rows; nPicks = !!first.picks; paint(); }
    if (await pickTodayNews(rt) && live()) { const again = await readNews(rt); if (live() && again.ok) { news = again.rows; nPicks = !!again.picks; paint(); } }
  }
  const refresh = () => Promise.all([loadCandidates(), loadFamily(), loadNews()]);

  // ── [조직]·[사업](가족 줄 빼고 모든 줄 같은 길): 고르기 창 → 기존 기록 길(quick-save.js) → 그 줄을 처리한 것으로 ──
  const myOrgs = () => { if (!orgRead) orgRead = import('./feed-data.js').then(m => m.readOrganizations(rt)).catch(error => { orgRead = null; throw error; }); return orgRead; };
  const user = () => rt.context?.read?.()?.user?.id || null;
  const orgDone = org => `${org.name || '조직'} 기록에 넣었어요. 이번 주 조직보고에 보여요.`;
  const areaDone = project => `${project.name || '사업'} 기록에 넣었어요. 주간보고 사업 칸에 올라가요.`;
  // [조직]: 담당조직 고르기 창. guess(read)가 내 담당조직 하나를 돌려주면(소식: AI가 쓴 조직 이름, 텔레그램 요청·챙길 것: 후보에 붙은 조직)
  // 창 맨 위에 '조직 › ○○에 넣기'(한 번 누르면 그 조직). 옛 소식 줄 ⋯의 같은 항목을 여기로 옮겼다.
  async function pickOrg(trigger, {guess = () => null, onPick}) {
    let read;
    try { read = await myOrgs(); } catch { say('담당조직 목록을 읽지 못했어요. 다시 눌러 주세요'); return; }
    const match = guess(read), {openOrgPicker} = await import('./feed-link.js');
    if (!trigger?.isConnected) return;
    await openOrgPicker(trigger, {orgs: read.orgs, mine: read.mine, selected: '', title: '넣을 조직',
      top: match ? [{key: `o:${match.id}`, name: `조직 › ${match.name}에 넣기`, attrs: 'data-forget-org-match'}] : null,
      onPick: id => { const org = id && read.orgs.find(o => o.id === id); if (org) onPick(org); }});
  }
  async function pickArea(trigger, onPick) {
    let tree;
    try {
      await import('./project-catalog.js');
      const c = rt.context.read();
      tree = (await win.KPTUProjectCatalog.load({workspaceId: c?.workspace?.id, userId: c?.user?.id})).tree.filter(x => x.project?.status === 'active');
    } catch { say('사업 목록을 읽지 못했어요. 다시 눌러 주세요'); return; }
    const {openAreaOrgPicker, usedKeysNow, catalogAreas} = await import('./area-org-picker.js');
    const used = await usedKeysNow(rt).catch(() => []);
    if (!trigger?.isConnected) return;
    await openAreaOrgPicker({kind: 'area', trigger, areas: catalogAreas(tree), used, multi: false, title: '넣을 사업', onCommit: keys => {
      const k = [...keys][0] || '', project = k.startsWith('p:') && tree.find(x => x.project.id === k.slice(2))?.project;
      if (project) onPick(project);
    }});
  }
  // ORG-기록하나로 O-4: 소식에서 온 기록은 원래 소식 줄을 함께 남긴다(source_kind memorable, 조직 상세 ⋯ [원래 글 보기]용).
  const saveOrg = async (org, text, from = null) => (await import('./quick-save.js')).saveOrganizationUpdate({organization_id: org.id, raw_text: text, created_by: user(), ...(from ? {source_kind: 'memorable', source_id: from} : {})}, rt);
  // BIZ-기록하나로 B-3(설계 record-one.md 4절): [사업] = 그 사업의 사업 기록 한 줄(app_business_records). 소식 줄은 source_kind memorable·원래 소식 줄 번호·
  // 날짜 = 소식 날짜, 챙길 것 후보는 원래 줄을 남기는 출처가 없어 직접 쓰기(user)·오늘 날짜. 옛 사업 진행 기록(app_project_progress_updates)에는 더 넣지 않는다.
  const saveArea = async (project, text, news = null) => (await import('./business-now-data.js')).saveBusinessRecord({space_id: project.id, day: news?.day || seoulDateKey(), body: text,
    ...(news?.id ? {source_kind: 'memorable', source_id: news.id} : {source_kind: 'user'})}, rt);

  // ── 소식 줄(FORGET-소식합치기 → 소식바로잡기): 다른 줄과 같은 일곱 버튼. 상태는 표가 허락한 셋뿐 — 처리하면 kept, ×는 dropped ──
  const newsById = id => news.find(r => r.id === id);
  async function newsMark(r, next, done, undo = false) {
    const key = `n:${r.id}`;
    if (busy.has(key) || r.status !== 'suggested') return;
    busy.add(key); status = ''; paint();
    let ok = false;
    try { ok = await decideNews(rt, r.id, next, next === 'kept' ? r.line : null); } catch { ok = false; }
    busy.delete(key);
    if (!ok) { say(next === 'kept' && !undo ? '만들었지만 이 줄은 목록에서 빼지 못했어요. ×로 빼 주세요.' : '저장하지 못했어요. 다시 눌러 주세요'); return; }
    r.status = next; r.decidedAt = new Date().toISOString(); say(done);
    if (undo) offerUndoNotice({text: done, onUndo: async () => {
      let back = false;
      try { back = await decideNews(rt, r.id, 'suggested'); } catch { back = false; }
      if (!back) return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
      r.status = 'suggested'; r.decidedAt = ''; status = ''; paint();
      return {status: 'done', message: '다시 보이게 했어요.'};
    }});
  }
  // FORGET-노트고르기(요청함 11/09 13:34, 명진 13:37): 업무 줄 [노트]는 노트 창 제목 줄 앞 [새 노트 ▾][폴더 ▾](note-pick.js).
  // 기본은 새 노트 · 폴더 '01. 업무메모'(그 폴더가 없으면 폴더 없음), 기존 노트는 미리 고르지 않는다. 기존 노트를 고르면 그 노트 끝에 더한다.
  // FORGET-노트작은창(요청함 11/09 21:39, 명진 21:42): [노트로]는 큰 창 대신 누른 줄 아래 작은 창(note-quick.js)이 먼저 뜨고, 길게 쓸 때만 [크게 수정 ↗]로 큰 창.
  async function openWorkNote(text, done, anchor = null) {
    const [{openNoteWindow}, {createNoteTarget}, {createNoteFolderPick}] = await Promise.all([import('./note-window.js'), import('./note-pick.js'), import('./note-folder-pick.js')]);
    const pick = createNoteFolderPick({rt, initial: WORK_NOTE_FOLDER, title: '노트를 넣을 폴더'});
    void pick.load();
    const args = {rt, text, noteFolder: {label: pick.label, open: pick.open, get: pick.get, put: pick.put, watch: pick.watch, close: pick.close, write: true},
      target: createNoteTarget({rt}), onClose: ({saved}) => { if (saved) done(); }};
    if (!anchor?.isConnected) return openNoteWindow(args);
    const rowKey = anchor.closest('[data-nbx-row]')?.dataset.nbxRow || '';
    const {openNoteQuick} = await import('./note-quick.js');
    return openNoteQuick({...args, anchor, reanchor: () => (rowKey ? [...document.querySelectorAll('[data-nbx-row]')].find(r => r.dataset.nbxRow === rowKey)?.querySelector('[data-nbx-act="note"]') : null) || null});
  }
  async function newsKeep(r, save, done) {
    const key = `n:${r.id}`;
    if (busy.has(key) || r.status !== 'suggested') return;
    busy.add(key); status = ''; paint();
    try { await save(); }
    catch { busy.delete(key); say('넣지 못했어요. 다시 눌러 주세요'); return; }
    busy.delete(key);
    await newsMark(r, 'kept', done);
  }
  async function newsAct(r, act, button) {
    if (r.status !== 'suggested' || busy.has(`n:${r.id}`)) return;
    const text = newsText(r), memo = [NEWS_SOURCE_TAG[r.source], shortDay(r.day)].filter(Boolean).join(' · '), mine = radarScope(rt), live = () => mine === radarScope(rt);
    if (act === 'dismissed') return newsMark(r, 'dropped', '무시했어요.', true);
    if (act === 'done') return newsMark(r, 'kept', '이미 한 일로 뺐어요.', true);
    // [조직]: 그 조직 이름이 이미 줄 앞에 있으면 줄만, 다른 조직에 넣으면 AI가 쓴 이름까지 그대로 남긴다.
    if (act === 'org') return pickOrg(button, {guess: read => matchOrg(r.org, read.orgs, read.mine),
      onPick: org => void newsKeep(r, () => saveOrg(org, matchOrg(r.org, [org], new Set([org.id])) ? r.line : text, r.id), orgDone(org))});
    if (act === 'area') return pickArea(button, project => void newsKeep(r, () => saveArea(project, text, r), areaDone(project)));
    if (act === 'task') {
      try {
        await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
        win.KPTUGoogleTasks.openEditor(null, {title: cut(text, 100), memo, onCreated: () => { if (live()) void newsMark(r, 'kept', '할 일로 만들었어요'); }});
      } catch { say('할 일 창을 열지 못했어요'); }
      return;
    }
    if (act === 'event') {
      if (!win.KPTUEventCreate?.open) { say('일정 창을 열지 못했어요'); return; }
      win.KPTUEventCreate.open({title: cut(text, 100), memo, onCreated: () => { if (live()) void newsMark(r, 'kept', '일정으로 만들었어요'); }});
      return;
    }
    if (act === 'note') {
      try {
        await openWorkNote(`${text}\n\n${memo}`, () => { if (live()) void newsMark(r, 'kept', '노트로 저장했어요'); }, button);
      } catch { say('노트 창을 열지 못했어요'); }
    }
  }

  // ── 챙길 것·텔레그램 후보 줄(기존 정리함 챙길 것·나한테 온 요청 길 그대로) ──
  async function decideCandidate(c, runIt, outcome, done, undo = null) {
    busy.add(c.id); status = ''; paint();
    let ok = false;
    try { ok = await runIt(); } catch { ok = false; }
    busy.delete(c.id);
    if (!ok) { say('저장하지 못했어요. 다시 눌러 주세요'); return; }
    c.status = outcome === 'dismissed' || outcome === 'already_tasked' ? 'dismissed' : outcome === 'tasked' ? 'tasked' : 'done'; c.outcome = outcome; c.decided_at = new Date().toISOString();
    const feedbackId = await logFeedback(c, outcome, {rt});
    say(done); changed();
    if (undo) offerUndoNotice({text: done, onUndo: async () => {
      let back = false;
      try { back = await reopenCandidate(c.id, rt, undo); } catch { back = false; }
      if (!back) return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
      if (feedbackId) await dropFeedback(feedbackId, rt);
      c.status = 'open'; c.decided_at = null; delete c.outcome; status = ''; paint(); changed();
      return {status: 'done', message: '다시 보이게 했어요.'};
    }});
  }
  // [할 일로]: 텔레그램 요청은 할 일 창(고쳐서 저장), 챙길 것은 제안 기한으로 바로 하나(출처 연결·업데이트 기록 포함, candidateToTask) — 기존 두 길 그대로.
  async function candidateTask(c) {
    const draft = candidateDraft(c), mine = radarScope(rt), live = () => mine === radarScope(rt);
    if (c.source_kind === 'telegram') {
      try {
        await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
        win.KPTUGoogleTasks.openEditor(null, {title: draft.title, memo: draft.memo,
          onCreated: taskId => { if (live()) void decideCandidate(c, () => markTasked(c.id, taskId, rt, new Date(), null), 'tasked', '할 일로 만들었어요'); }});
      } catch { say('할 일 창을 열지 못했어요'); }
      return;
    }
    const quick = {title: c.summary, due: quickDue(c, seoulDateKey())}, problem = validateTaskDraft(quick);
    if (problem) { say(problem); return; }
    busy.add(c.id); status = '넣는 중…'; paint();
    const result = await candidateToTask(c, quick);
    busy.delete(c.id);
    if (!live()) return;
    if (result.status === 'unknown') { unknown.add(c.id); say('결과를 확인하지 못했어요. 새로 만들지 않았어요. 할 일 화면에서 확인해 주세요.'); return; }
    if (result.status === 'failed') { say(result.code === 'session_required' ? '로그인이 필요해요. 다시 로그인한 뒤 눌러 주세요.' : '할 일로 넣지 못했어요. 다시 눌러 주세요.'); return; }
    win.KPTUGoogleTasks?.invalidateAfterCreate?.(); win.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
    if (result.status === 'marked_failed') { unknown.add(c.id); say('할 일은 만들었어요. 목록에서 빼지 못했어요.'); return; }
    c.status = 'tasked'; c.task_id = result.task.id; c.decided_at = new Date().toISOString(); c.task_due = quick.due || null;
    say('할 일로 보냈어요.'); changed();
  }
  // [조직]·[사업]: 고른 곳에 그 줄 글을 기록으로 넣고, 후보는 '이미 함'과 같은 처리(done)로 뺀다.
  async function candidateReport(c, save, done) {
    if (c.status !== 'open' || busy.has(c.id)) return;
    busy.add(c.id); status = ''; paint();
    try { await save(); } catch { busy.delete(c.id); say('넣지 못했어요. 다시 눌러 주세요'); return; }
    busy.delete(c.id);
    await decideCandidate(c, () => markDone(c.id, rt), 'done', done);
  }
  async function candidateAct(c, kind, button) {
    if (c.status !== 'open' || busy.has(c.id) || unknown.has(c.id)) return;
    const draft = candidateDraft(c), mine = radarScope(rt), live = () => mine === radarScope(rt);
    if (kind === 'org') return pickOrg(button, {guess: read => (read.orgs || []).find(o => o?.id && o.id === c.organization_id && o.active !== false && read.mine?.has?.(o.id)) || null,
      onPick: org => void candidateReport(c, () => saveOrg(org, c.summary), orgDone(org))});
    if (kind === 'area') return pickArea(button, project => void candidateReport(c, () => saveArea(project, c.summary), areaDone(project)));
    if (kind === 'dismissed') return decideCandidate(c, () => dismissCandidate(c.id, rt), 'dismissed', '무시했어요.', 'dismissed');
    if (kind === 'done') return decideCandidate(c, () => markDone(c.id, rt), 'done', '이미 한 일로 뺐어요.', 'done');
    if (kind === 'task') return candidateTask(c);
    if (kind === 'event') {
      if (!win.KPTUEventCreate?.open) { say('일정 창을 열지 못했어요'); return; }
      win.KPTUEventCreate.open({title: draft.title, memo: draft.memo, onCreated: () => { if (live()) void decideCandidate(c, () => markDone(c.id, rt), 'done', '일정으로 만들었어요'); }});
      return;
    }
    if (kind === 'note') {
      try {
        await openWorkNote(`${c.summary}\n\n${draft.memo}`, () => { if (live()) void decideCandidate(c, () => markDone(c.id, rt), 'done', '노트로 저장했어요'); }, button);
      } catch { say('노트 창을 열지 못했어요'); }
    }
  }
  // 할 일 모듈(google-tasks.js)은 첫 화면 뒤에 불러오므로 아직 없을 수 있다. 없으면 그 자리에서 불러온다(기존 읽기 길 그대로).
  async function openTasks() {
    try {
      if (!win.KPTUGoogleTasks) await import('./google-tasks.js');
      const gt = win.KPTUGoogleTasks, copy = gt?.peekTasks?.();
      if (copy && Array.isArray(copy.tasks)) return {ok: true, tasks: copy.tasks};
      const r = await gt?.listTasks?.();
      return r?.status === 'ok' ? {ok: true, tasks: r.tasks} : {ok: false, tasks: []};
    } catch { return {ok: false, tasks: []}; }
  }
  async function startLinking(c) {
    linking.set(c.id, {tasks: null}); status = ''; paint();
    const mine = radarScope(rt), got = await openTasks();
    if (mine !== radarScope(rt) || !linking.has(c.id)) return;
    linking.set(c.id, {tasks: similarTasks(c.summary, got.tasks), failed: !got.ok}); paint();
  }
  async function linkTask(c, task) {
    busy.add(c.id); paint();
    const due = /^\d{4}-\d{2}-\d{2}/.test(String(task.due || '')) ? String(task.due).slice(0, 10) : null;
    let ok = false;
    try { ok = await linkCandidateToTask(c.id, task.id, due, rt); } catch { ok = false; }
    busy.delete(c.id);
    if (!ok) { say('이어 두지 못했어요. 다시 눌러 주세요.'); return; }
    linking.delete(c.id);
    c.status = 'tasked'; c.task_id = task.id; c.task_due = due; c.outcome = 'already_tasked'; c.decided_at = new Date().toISOString(); status = ''; paint(); changed();
    const feedbackId = await logFeedback(c, 'already_tasked', {rt});
    offerUndoNotice({text: '이미 있는 할 일로 묶었어요.', onUndo: async () => {
      let back = false;
      try { back = await unlinkCandidate(c.id, rt); } catch { back = false; }
      if (!back) return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
      if (feedbackId) await dropFeedback(feedbackId, rt);
      c.status = 'open'; c.task_id = null; c.task_due = null; c.decided_at = null; delete c.outcome; paint(); changed();
      return {status: 'done', message: '다시 보이게 했어요.'};
    }});
  }
  // 이어 둘 할 일이 없을 때: 새 할 일 없이 목록에서만 뺀다(결과 기록은 같은 'already_tasked').
  async function dropAlready(c) {
    linking.delete(c.id);
    await decideCandidate(c, () => dropCandidateOnly(c.id, rt), 'already_tasked', '이미 할 일에 있는 것으로 뺐어요.', 'dismissed');
  }
  // ⋯ [고쳐서 할 일로]: 할 일 창에 제목·출처 연결을 채워 열고, 저장되면 tasked(결과 기록 tasked).
  async function editToTask(c) {
    const draft = candidateDraft(c), mine = radarScope(rt);
    try {
      await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
      win.KPTUGoogleTasks.openEditor(null, {title: c.summary, memo: draft.memo, links: taskLinks(c),
        onCreated: taskId => { if (mine === radarScope(rt)) void decideCandidate(c, () => markTasked(c.id, taskId, rt, new Date(), null), 'tasked', '할 일로 만들었어요'); }});
    } catch { say('할 일 창을 열지 못했어요'); }
  }
  // [내 일 아님]: [무시]처럼 빼고, 다음 찾기에서 비슷한 것을 거르는 예시를 남긴다(기존 길). [되돌리기]는 둘 다 되돌린다.
  async function notMine(c) {
    if (c.status !== 'open' || busy.has(c.id)) return;
    busy.add(c.id); status = ''; paint();
    let r = {ok: false};
    try { r = await markNotMine(c, rt); } catch { r = {ok: false}; }
    busy.delete(c.id);
    if (!r.ok) { say('빼지 못했어요. 다시 눌러 주세요.'); return; }
    c.status = 'dismissed'; c.outcome = 'not_mine'; c.decided_at = new Date().toISOString(); paint(); changed();
    offerUndoNotice({text: r.saved ? '내 일 아님으로 뺐어요. 다음 찾기부터 비슷한 것을 걸러요.' : '목록에서 뺐어요.', onUndo: async () => {
      let back = false;
      try { back = await undoNotMine(c.id, r.exampleId, rt, r.feedbackId); } catch { back = false; }
      if (!back) return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
      c.status = 'open'; c.decided_at = null; delete c.outcome; paint(); changed();
      return {status: 'done', message: '다시 보이게 했어요.'};
    }});
  }

  // ── 가족 줄(기존 잊지 말기 길 그대로: 상태 new → kept·tasked·scheduled·dismissed) ──
  async function familyChange(n, next, text) {
    const key = `f:${n.id}`;
    busy.add(key); status = ''; paint();
    try { await decideFamily(rt, ws(), n.id, next); }
    catch { busy.delete(key); say('저장하지 못했어요. 다시 눌러 주세요'); return false; }
    busy.delete(key); notes = notes.filter(x => x.id !== n.id); say(text);
    return true;
  }
  function familyUndo(n, text, done = null) {
    offerUndoNotice({text, onUndo: async () => {
      try { await decideFamily(rt, ws(), n.id, 'new'); } catch { return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'}; }
      notes = [{...n, status: 'new'}, ...notes.filter(x => x.id !== n.id)]; status = ''; paint();
      // [이미 함]이면 노트에 더한 그 줄도 뺀다(못 빼면 제안만 돌아오고 알린다).
      if (done) {
        try { const {undoDone} = await import('./family-note-send.js'); await undoDone(rt, done); }
        catch { return {status: 'done', message: '제안은 돌렸지만 노트의 줄은 남았어요'}; }
      }
      return {status: 'done', message: '되돌렸어요.'};
    }});
  }
  async function familyAct(n, kind, trigger) {
    if (busy.has(`f:${n.id}`)) return;
    const draft = draftOf(n);
    if (kind === 'dismissed') { if (await familyChange(n, 'dismissed', '삭제했어요')) familyUndo(n, '삭제했어요'); return; }
    if (kind === 'done') {
      const line = noteLine(n, true);
      busy.add(`f:${n.id}`); paint();
      let sent;
      try { const {markDone: keepDone} = await import('./family-note-send.js'); sent = await keepDone(rt, {line, body: n.body}); }
      catch { busy.delete(`f:${n.id}`); say('노트에 남기지 못했어요. 다시 눌러 주세요'); return; }
      busy.delete(`f:${n.id}`);
      if (await familyChange(n, 'kept', '이미 한 일로 표시함')) familyUndo(n, '이미 한 일로 표시함', {noteId: sent?.noteId || '', line});
      return;
    }
    if (kind === 'note') {
      try {
        const {openFamilyNoteWindow} = await import('./family-note-send.js');
        await openFamilyNoteWindow({rt, line: noteLine(n), body: n.body, anchor: trigger,
          onSent: ({folderName}) => void familyChange(n, 'kept', folderName ? `'${folderName}' 폴더 노트에 넣었어요` : '노트에 넣었어요')});
      } catch { say('노트로 보내는 창을 열지 못했어요'); }
      return;
    }
    if (kind === 'task') {
      try {
        await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
        win.KPTUGoogleTasks.openEditor(null, {title: draft.title, memo: draft.memo, onCreated: () => void familyChange(n, 'tasked', '할 일로 만들었어요')});
      } catch { say('할 일 창을 열지 못했어요'); }
      return;
    }
    if (kind === 'event') {
      if (!win.KPTUEventCreate?.open) { say('일정 창을 열지 못했어요'); return; }
      win.KPTUEventCreate.open({title: draft.title, memo: draft.memo, onCreated: () => void familyChange(n, 'scheduled', '일정으로 만들었어요')});
    }
  }

  // 줄 버튼과 ⋯ 메뉴 항목이 함께 쓰는 한 길(UI-잊지말기줄단추). anchor = 누른 줄 버튼 또는 그 줄의 ⋯(작은 창·고르기 창이 그 옆에 뜬다).
  function rowAct(row, act, anchor) {
    const [kind, id] = [row.slice(0, 1), row.slice(2)];
    if (kind === 'u') { onUpdateAct(id, act, anchor); return; }
    if (kind === 'c') { const c = byId(id); if (c) void candidateAct(c, act, anchor); return; }
    if (kind === 'f') { const n = notes.find(x => x.id === id); if (n) void familyAct(n, act, anchor); return; }
    if (kind === 'n') { const r = newsById(id); if (r) void newsAct(r, act, anchor); }
  }
  host.addEventListener('click', event => {
    const b = event.target.closest?.('button');
    if (!b || !host.contains(b) || b.disabled) return;
    if (b.dataset.forgetMore) { more.open(b); return; }
    if (b.dataset.forgetNewsOpen) { const r = newsById(b.dataset.forgetNewsOpen); if (r) void openNewsSource(r, rt).then(ok => { if (!ok) say('원본을 열지 못했어요.'); }, () => say('원본을 열지 못했어요. 다시 시도해 주세요.')); return; }
    const d = b.dataset;
    if (d.forgetSource) { const c = byId(d.forgetSource); if (c) openSource(c); return; }
    if (d.forgetLinkTask) { const c = byId(d.forgetLinkFor), t = c && linking.get(c.id)?.tasks?.find(x => x.id === d.forgetLinkTask); if (c && t && !busy.has(c.id)) void linkTask(c, t); return; }
    if (d.forgetLinkNone) { const c = byId(d.forgetLinkNone); if (c && c.status === 'open' && !busy.has(c.id)) void dropAlready(c); return; }
    if (d.forgetLinkRetry) { const c = byId(d.forgetLinkRetry); if (c && linking.has(c.id)) void startLinking(c); return; }
    if (d.forgetLinkCancel) { linking.delete(d.forgetLinkCancel); paint(); return; }
    const act = b.dataset.nbxAct, row = b.closest('[data-nbx-row]')?.dataset.nbxRow || '';
    if (!act || !row) return;
    const [kind, id] = [row.slice(0, 1), row.slice(2)];
    if (kind !== 'p') { rowAct(row, act, b); return; }
    if (act === 'ledger') { const p = (radarPromises() || [])[Number(id)]; if (p) void copyText(ledgerRequestText(p)).then(ok => say(ok ? '원장에 넣을 약속 문구를 복사했어요.' : '복사하지 못했어요.')); }
  });
  statusEl?.addEventListener('click', event => {
    if (event.target.closest?.('[data-forget-retry]')) { cState = 'loading'; paint(); void loadCandidates(); }
    if (fix?.phase !== 'preview' && fix?.phase !== 'run') {
      if (event.target.closest?.('[data-forget-fix-ask]')) void fixNews('preview');
      else if (event.target.closest?.('[data-forget-fix-go]') && fix?.phase === 'confirm') void fixNews('run');
      else if (event.target.closest?.('[data-forget-fix-cancel]')) { fix = null; paint(); }
    }
  });
  viewButton?.addEventListener('click', () => menu.open(viewButton));
  win.addEventListener(CHANGED, event => {
    if (!host.isConnected || scope !== radarScope(rt)) return;
    if (event.detail?.reload && !busy.size) void loadCandidates(); else paint();
  });
  win.addEventListener('kptu:google-tasks-changed', () => { if (cState === 'ok') paint(); });
  win.addEventListener('kptu:session-changed', () => {
    if (scope === radarScope(rt)) return;
    run++; nRun++; rows = []; notes = []; news = []; nOn = false; nPicks = false; orgRead = null; fix = null; cState = 'loading'; fOn = false; fWs = ''; view = 'open'; src = 'all'; status = ''; busy.clear(); unknown.clear(); linking.clear(); scope = radarScope(rt);
    onView(view); paint();
  });
  const api = {refresh, paint, setView, view: () => view, source: () => src,
    // 처리 안 한 줄 수(연결 안 된 업데이트 포함, 홈 한 줄과 같은 기준 — 상대 약속은 세지 않음). 모르면 null.
    // FORGET-소식합치기(명진 '넣어'): 처리 전 소식도 센다.
    openCount: count => cState === 'ok' && Number.isInteger(count) ? candidatesFor('open', rows, taskTitles()).length + (fOn ? notes.length : 0) + (nOn ? openNews(news, nPicks).length : 0) + count : null};
  paint();
  return api;
}
