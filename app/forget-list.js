// S52-20 HOME-잊지말기한목록(요청함 11/07 14:37, 시안 docs/design/mockups/forget-one-list.html, 명진 14:44 '좋은데'): 정리함 화면 안의 한 목록.
// 텔레그램 요청·챙길 것·가족(잊지 말기 제안)·업데이트는 들어오는 곳만 다를 뿐 같은 결정이라, 칸을 나누지 않고 같은 줄·같은 버튼으로 한 목록(새 것이 위)에 둔다.
// - 줄 = 공용 부품 notice-box.mjs rowHtml 하나(새 모양 없음). 다른 점은 아래 작은 줄 맨 앞 흐린 출처 꼬리표뿐.
// - FORGET-소식바로잡기(요청함 11/09 01:45, 시안 docs/design/mockups/forget-news-fix.html, 명진 'ㅇ'): 출처와 상관없이 모든 줄이 같은 버튼 일곱
//   [할 일로][일정으로][노트로][조직][사업][이미 함] ×(NB_REPORT_ACTS). 가족 줄만 [조직][사업] 없이 다섯(보고 길 막음 유지).
//   UI-잊지말기줄단추(요청함 11/10 11:23, 명진 '추천대로'): 보이는 법만 바뀜 — 폰·폴드는 줄에 [할 일로][이미 함] ⋯, 나머지는 줄 ⋯ 메뉴(아래 more) 안 같은 이름,
//   PC는 마우스 올린 줄·초점 줄에만 전부(notice-box.mjs·ui-standard.css). 줄 버튼과 메뉴 항목은 같은 길 rowAct 하나.
//   [조직]은 담당조직 고르기 창(맨 위에 '조직 › ○○에 넣기' — 줄의 조직이 내 담당조직과 맞을 때 한 번에), [사업]은 사업 고르기 창이고,
//   고르면 기존 기록 길(quick-save.js 담당조직 기록 → 이번 주 조직보고 제안 / 사업 기록 → 사업 보고·주간보고 사업 칸)로 넣는다.
// - FORGET-처리전만(S71-58, 사용자 결정 2026-11-26 "들어온 걸 쳐내는 게 중요하지 기록 관리는 별로 안 중요함"): 보기·출처 거르기([처리 전 ▾])는 없다.
//   목록은 늘 처리 전 줄만(출처 구분 없이 한 목록, 새 것이 위). 처리하면 그 줄은 바로 빠지고, 아래 공용 되돌리기 알림 하나(offerUndoNotice)로만 되돌린다.
//   처리한 줄을 다시 모아 보는 화면·메뉴는 두지 않는다(처리 상태 값·출처 데이터는 서버에 그대로).
// - 서버·원본·버튼 동작은 그대로다. 챙길 것·텔레그램 줄은 기존 후보 길(todo-radar-data.js, 소유자 RLS 표), 가족 줄은 기존 잊지 말기 길
//   (family-notes-data.js, 서버 운영자 기능 family + 소유자 RLS — 화면 숨김은 보안이 아니다), 업데이트 줄은 정리함(basket.js)의 기존 길에 맡긴다
//   (basket.js가 줄 재료를 set으로 넘기고, 업데이트 줄의 버튼은 onUpdateAct로 돌려준다).
// - FORGET-소식합치기(11/08): 업무일지 '기억할 통화·텔레그램' 줄도 출처 '소식'(꼬리표 '소식 · 텔레그램'/'소식 · 통화')으로 이 목록에 둔다.
//   읽기·쓰기는 forget-news-data.js(서버 표 app_journal_memorable 그대로). 버튼은 다른 줄과 같은 일곱(옛 소식 줄만의 ⋯·[무시]는 없앰 — ×가 무시).
//   운영자 기능(통화·텔레그램)은 서버 판정 그대로다.
// - 가족 줄은 이 화면에 보이기만 한다. 업데이트·원장·주간보고·업무일지·AI 길에는 넘기지 않는다(docs/design/tg-personal.md 7절).
// 이 파일이 이 목록 자리의 유일한 renderer다. 기기 저장 없음.
import {createAnchoredMenu, keepMenus} from './anchored-menu.js';
import {setHomeAsks} from './home-asks.js';
import {lockedLineHtml} from './locked-line.mjs';
import {esc, rowHtml, groupHtml, foldActs, openFromMeta, plainText} from './notice-box.mjs';
import {waitHtml, emptyHtml} from './wait-state.js';
import {copyText} from './copy-text.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {seoulDateKey} from './meeting-time.js';
import {compileFind} from './find-match-model.mjs'; // S70-67 SEARCH-비슷한것찾기: 공용 판정(화면에서는 screen-find.js findFor, 순수 시험에서는 같은 규칙 그대로)
import {dueLabel} from './task-due.mjs';
import {readInboxCandidates, dismissCandidate, reopenCandidate, markDone, markTasked, markNotMine, undoNotMine,
  notPlanned, radarScope, RADAR_SOURCE_LABEL, logFeedback, dropFeedback, ledgerRequestText, unlinkCandidate, taskLinks, sourceText, starredCandidate, bundleDay} from './todo-radar-data.js';
import {FIRM_LABEL, draftOf, metaLine, noteLine} from './family-notes-model.mjs';
import {decide as decideFamily, hasFamily, readNotes} from './family-notes-data.js';
import {newsOn, readNews, pickTodayNews, decideNews, openNews, promiseNews, newsText, matchOrg, openNewsSource, NEWS_SOURCE_TAG} from './forget-news-data.js';
import {word} from './brand/brand.mjs';

const CHANGED = 'kptu:todo-radar-changed';
// FORGET-노트고르기: 업무 줄 [노트]의 처음 폴더(맨 위 폴더 이름, 없으면 폴더 없음).
export const WORK_NOTE_FOLDER = '01. 업무메모';
// 줄 앞 흐린 출처 꼬리표(거르기가 아니라 어디서 왔는지 보이기만).
export const SOURCE_TAG = Object.freeze({telegram: '텔레그램', news: '소식', family: '가족', update: '업데이트', todo: 'AI 제안', promise: '상대 약속'});
// 소식 줄은 처리 전(suggested) 중 새 기준(AI가 종류를 정한) 줄만 — 빨간 숫자와 같은 기준(forget-news-data.js openNews).
// AI가 정한 종류 → 굵게 보일 버튼(같은 이름). 누르는 건 사람이다.
export const NEWS_HINT = Object.freeze({task: 'task', event: 'event', note: 'note', org: 'org', area: 'area'});
// S61-11: 상대 약속 소식 줄의 버튼. 받음 = 상대가 해 줌(소식 '처리함'), 무시 = 소식 '무시'. 둘 다 되돌리기 있음.
export const PROMISE_NEWS_ACTS = Object.freeze([['ledger', '원장으로'], ['done', '받음'], ['dismissed', '무시']]);
// 상대 약속 소식 → 원장 쓰기요청 글(챙길 것 약속과 같은 모양, 근거는 출처 이름만 — 사람 이름·연락처 없음).
export const promiseNewsLedger = r => ledgerRequestText({summary: newsText(r), due: '', evidence: '', source_kind: '', source_day: r?.day || ''})
  .replace('- 출처: 노동조합+ 기록', `- 출처: 노동조합+ 소식(${r?.source === 'telegram' ? '텔레그램' : '통화'})`);

const shortDay = v => { const m = String(v ?? '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${Number(m[1])}/${Number(m[2])}` : ''; };
const cut = (v, n) => [...String(v ?? '')].slice(0, n).join('');
export const candidateSource = c => c?.source_kind === 'telegram' ? 'telegram' : 'todo';
// 아래 작은 줄 왼쪽 글(출처 꼬리표 뒤). 텔레그램: 방 이름 · 날짜 · 기한. 챙길 것: '업데이트에서' 같은 원래 기록 · 날짜 · 기한.
export function candidateMeta(c) {
  const from = c?.source_kind === 'telegram' ? (c?.tg?.room_label || '') : RADAR_SOURCE_LABEL[c?.source_kind] ? `${RADAR_SOURCE_LABEL[c.source_kind]}에서` : '';
  return [from, shortDay(c?.source_day), dueLabel(c?.due) ? `기한 ${dueLabel(c.due)}` : ''].filter(Boolean).join(' · ');
}
// 할 일·일정·노트 창에 미리 채울 글. 날짜는 바꾸지 않는다(명진이 창에서 고름).
export const candidateDraft = c => ({title: cut(plainText(c?.summary), 100), // S59-20: 제목에는 마크다운 기호(`**`)를 넣지 않는다
  memo: [c?.source_kind === 'telegram' ? '텔레그램' : RADAR_SOURCE_LABEL[c?.source_kind] || '', c?.tg?.room_label || '', shortDay(c?.source_day)].filter(Boolean).join(' · ')});
// 처리 전 후보(새 것이 위, 만든 때). 이미 할 일 목록에 같은 제목이 있는 줄은 뺀다(notPlanned).
export const openCandidates = (rows, taskTitles = []) => notPlanned((rows || []).filter(r => r.status === 'open'), taskTitles);
// 여러 출처의 줄을 새 것이 위로 하나로(같은 때는 들어온 순서 그대로).
export const newestFirst = items => items.map((x, i) => [x, i]).sort((a, b) => String(b[0].at || '').localeCompare(String(a[0].at || '')) || a[1] - b[1]).map(([x]) => x);
const taskTitles = () => (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);

// host: 줄을 그릴 <ul>(바깥 칸은 notice-box 'list' 톤). statusEl: 목록 아래 상태 줄.
// updates(): {loading, items:[{id, at, body, meta, below, tail, attrs, open}]} — basket.js가 처리 전(미분류) 업데이트 줄 재료를 준다.
// onUpdateAct(id, act, button): 업데이트 줄 버튼(org·area·task·event·note·done·dismissed).
// radarPromises(): 찾기가 돌려준 상대 약속(저장하지 않음, todo-radar.js) — 처리 전 맨 아래 같은 줄로, 버튼은 [원장으로](쓰기요청 글 복사) 하나. 세지 않는다.
export function mountForgetList(host, {rt = window.KPTURuntime, win = window, statusEl = null, updates = () => ({loading: false, items: []}), onUpdateAct = () => {}, radarPromises = () => [], openSource = () => {}, updateCount = () => null} = {}) {
  if (!host) return null;
  let rows = [], cState = 'loading', notes = [], fOn = false, fWs = '', run = 0, status = '', scope = radarScope(rt);
  let query = ''; // S70-57 UI-메뉴별검색: '잊지 말기에서 찾기' 글자(맨 위 칸, basket.js가 setQuery로 넘김). 메모리만, 거르기는 아래 items() 한 곳.
  let news = [], nOn = false, nPicks = false, nRun = 0, orgRead = null; // 소식 줄(FORGET-소식합치기)과 조직 이름 맞추기에 쓰는 내 담당조직(readOrganizations, 한 번)
  const busy = new Set(), openBundles = new Set();
  const ws = () => rt.context?.read?.()?.workspace?.id || '';
  const changed = () => win.dispatchEvent(new CustomEvent(CHANGED, {detail: {reload: true}}));
  const byId = id => rows.find(r => r.id === id);
  const say = text => { status = text; paint(); };

  // 줄 ⋯(UI-잊지말기줄단추, 처리 전 줄마다 하나 — 우클릭도 같은 메뉴): 폰에서 줄에 없는 [일정으로][노트로][조직][사업]·×([무시])를 줄 버튼과
  // 같은 이름·같은 길(rowAct)로 먼저, 그 아래 챙길 것 줄만의 [내 일 아님]. 가족 줄은 조직·사업 없음.
  const rowKind = key => String(key || '').slice(0, 1);
  const more = createAnchoredMenu({id: 'forgetRowMenu', className: 'radar-row-menu', label: '잊지 말기 줄 메뉴', historyKey: 'kptuForgetRowMenu',
    key: trigger => trigger.dataset.forgetMore, canOpen: trigger => !trigger.disabled, row: trigger => trigger.closest('[data-nbx-row]'),
    render: key => {
      const kind = rowKind(key), c = kind === 'c' ? byId(key.slice(2)) : null;
      const hint = host.querySelector(`[data-nbx-row="${CSS.escape(key)}"] [data-nbx-hint]`)?.dataset.nbxAct || ''; // AI가 고른 버튼은 메뉴에서도 굵게
      const folded = foldActs({report: kind !== 'f'}).map(([act, label]) => `<button type="button" class="row-act${act === hint ? ' nbx-hint' : ''}" data-nbx-menu-act="${act}">${esc(label)}</button>`).join('');
      return folded + (c && candidateSource(c) === 'todo'
        ? '<button type="button" class="row-act" data-forget-menu="not-mine">내 일 아님</button>' : '');
    },
    onAction: (button, active) => {
      const key = active.trigger.dataset.forgetMore;
      if (button.dataset.nbxMenuAct) { rowAct(key, button.dataset.nbxMenuAct, active.trigger); return; }
      const c = rowKind(key) === 'c' ? byId(key.slice(2)) : null, act = button.dataset.forgetMenu;
      if (!c || c.status !== 'open' || busy.has(c.id)) return;
      if (act === 'not-mine') void notMine(c);
    }});

  function items() {
    const out = [];
    // SEC-기능PIN잠금 ②: 통화·텔레그램 소식을 잠갔고 아직 안 풀었으면 그 줄들은 그리지 않고 맨 아래 '잠김' 한 줄만(몇 줄인지만). 누르면 그 자리 PIN 창(S67-25, feature-lock.js askHere).
    const lockOf = feature => !!win.KPTUFeatureLock?.hides?.(feature) && !!win.KPTUFeatureLock?.settings?.();
    const locked = {telegram: lockOf('telegram'), call: lockOf('calls')};
    let hidden = 0;
    // 찾기: 줄 글(요청·제안 글, 아래 작은 줄)이 맞는 줄만 — 공용 판정(띄어쓰기 무시·오타·초성·앞부분, 비슷한 말, S70-67). 잠긴 줄 수 세기는 그대로.
    const q = query.trim().toLowerCase(), find = q ? (win.KPTUScreenFind?.findFor?.('forget', query) || compileFind(query)) : null, hit = (...parts) => !find || !!(find.hit || find.best)(...parts.filter(Boolean));
    // FORGET-기본이미함(S70-20b): 처리 전 업무 제안 중 ★(마감·직접 부름)는 맨 위에 한 줄씩, 어제 들어온 나머지는 '어제 들어온 요청 n개' 한 줄 묶음.
    // 묶음은 그냥 두면 서버 예약(app_forget_auto_expire)이 다음 날 0시(서울)에 '이미 함(지남)'으로 옮긴다 — 화면은 묶어 보이기만 한다.
    const stars = [], bundle = [], today = seoulDateKey();
    for (const c of openCandidates(rows, taskTitles())) {
      const s = candidateSource(c);
      if (s === 'telegram' && locked.telegram) { hidden++; continue; }
      if (!hit(plainText(c.summary), candidateMeta(c))) continue;
      const star = starredCandidate(c), into = star ? stars : bundleDay(c, today, d => seoulDateKey(d)) ? bundle : out;
      into.push({at: c.created_at, html: rowHtml({id: `c:${c.id}`, body: c.summary, meta: candidateMeta(c), src: SOURCE_TAG[s], busy: busy.has(c.id), report: true,
        // 내용을 누르면 원래 기록(업데이트·노트·사업 보고·조직 기록·텔레그램 방)을 연다 — 기존 출처 열기 길(todo-radar.js openSource).
        open: {attrs: `data-forget-source="${esc(c.id)}" aria-label="${esc(`${plainText(c.summary)} — 출처 열기: ${sourceText(c)}`)}"`},
        more: `data-forget-more="c:${esc(c.id)}"`, attrs: `data-forget-src="${s}"${star ? ' data-nbx-star' : ''}`})});
    }
    if (fOn) {
      for (const n of notes) if (hit(n.body, metaLine(n))) out.push({at: n.at || n.day, html: rowHtml({id: `f:${n.id}`, body: n.body, meta: metaLine(n), src: SOURCE_TAG.family, busy: busy.has(`f:${n.id}`),
        prefix: FIRM_LABEL[n.firmness] ? `<span class="nbx-tag">${esc(FIRM_LABEL[n.firmness])}</span> ` : '', more: `data-forget-more="f:${esc(n.id)}"`, attrs: 'data-forget-src="family"'})});
    }
    if (nOn) {
      for (const r of openNews(news, nPicks)) {
        if (locked[r.source]) { hidden++; continue; }
        const label = newsText(r);
        if (!hit(label)) continue;
        out.push({at: r.at, html: rowHtml({id: `n:${r.id}`, body: label, meta: shortDay(r.day), src: NEWS_SOURCE_TAG[r.source], busy: busy.has(`n:${r.id}`),
          open: {attrs: `data-forget-news-open="${esc(r.id)}" aria-label="${esc(`${label} — 원본 ${r.source === 'telegram' ? '텔레그램' : '통화'} 열기`)}"`},
          report: true, hint: NEWS_HINT[r.kind] || '', why: r.reason, more: `data-forget-more="n:${esc(r.id)}"`, attrs: `data-forget-src="news"`})});
      }
    }
    for (const u of updates().items || []) if (hit(u.text ?? u.body, u.meta)) out.push({at: u.at, html: rowHtml({id: `u:${u.id}`, body: u.body, meta: u.meta, src: SOURCE_TAG.update, busy: !!u.busy,
      report: true, open: u.open, tail: u.tail || '', below: u.below || '', attrs: `data-forget-src="update" ${u.attrs || ''}`})});
    if (bundle.length) {
      const rowsIn = newestFirst(bundle), shut = !openBundles.has('yesterday');
      out.push({at: rowsIn[0].at, html: groupHtml({key: 'yesterday', label: `어제 들어온 요청 ${bundle.length}개`, faint: '· 두면 내일 이미 함', rows: rowsIn.map(x => x.html), open: !shut})});
    }
    const sorted = [...newestFirst(stars), ...newestFirst(out)];
    // 상대 약속: 맨 아래(시각 없음). 세지 않는다(상대가 할 일).
    // S61-11 FORGET-요청방향 2단계(명진 11/13 05:19): 내가 남에게 부탁해 상대가 하기로 한 일은 어느 길에서 왔든 여기 한 곳에 모은다. 꼬리표 = '상대 약속 · 출처'.
    // - 챙길 것 찾기가 돌려준 약속(radarPromises, 저장하지 않음): 버튼 [원장으로] 하나(그대로).
    // - 소식(통화·텔레그램, 서버 표 종류 promise): [원장으로][받음][무시] — 받음·무시는 소식 줄의 기존 상태 길(되돌리기 있음).
    if (cState === 'ok') (radarPromises() || []).forEach((p, i) => hit(p.summary) && sorted.push({html: rowHtml({id: `p:${i}`, body: p.summary, src: `${SOURCE_TAG.promise} · ${SOURCE_TAG.todo}`,
      meta: [RADAR_SOURCE_LABEL[p.source_kind] || '', dueLabel(p.due) ? `기한 ${dueLabel(p.due)}` : ''].filter(Boolean).join(' · '), acts: [['ledger', '원장으로']], attrs: 'data-forget-src="promise" data-inbox-promise'})}));
    if (nOn) for (const r of promiseNews(news)) {
      if (locked[r.source]) { hidden++; continue; }
      const label = newsText(r);
      if (!hit(label)) continue;
      sorted.push({html: rowHtml({id: `n:${r.id}`, body: label, meta: shortDay(r.day), src: `${SOURCE_TAG.promise} · ${r.source === 'telegram' ? '텔레그램' : '통화'}`, busy: busy.has(`n:${r.id}`),
        open: {attrs: `data-forget-news-open="${esc(r.id)}" aria-label="${esc(`${label} — 원본 ${r.source === 'telegram' ? '텔레그램' : '통화'} 열기`)}"`},
        why: r.reason, acts: PROMISE_NEWS_ACTS, attrs: 'data-forget-src="promise" data-forget-promise-news'})});
    }
    if (hidden) sorted.push({html: lockedLineHtml({features: ['calls', 'telegram'], label: '통화·텔레그램', count: hidden, cls: 'nbx-faint forget-locked', attrs: 'data-forget-locked'})});
    return sorted;
  }
  // FILES-다시그리기메뉴자리: 메뉴가 열린 채 다시 그려도(재조회·다른 화면 알림) 열린 ⋯ 메뉴는 같은 줄의 새 칸에 붙는다(공용 keepMenus).
  function paint() { return keepMenus([more], {attrs:['data-forget-more']}, paintNow); }
  function paintNow() {
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
      const fail = cState === 'failed' ? 'AI 제안을 불러오지 못했어요. <button type="button" class="row-act" data-forget-retry>다시 시도</button>' : '';
      statusEl.innerHTML = [esc(status), fail].filter(Boolean).join(' ');
    }
    if (focus?.row) host.querySelector(`[data-nbx-row="${CSS.escape(focus.row)}"] ${focus.act ? `[data-nbx-act="${CSS.escape(focus.act)}"]` : 'button'}`)?.focus({preventScroll: true});
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
  // FORGET-넣기되돌리기: 알림은 '○○ 기록에 넣었어요 · [되돌리기]'(2초, 공용 되돌리기 알림). 잘못 고른 조직·사업이면 바로 뺀다.
  const orgDone = org => `${org.name || word('조직')} 기록에 넣었어요.`;
  const areaDone = project => `${project.name || '사업'} 기록에 넣었어요.`;
  // [조직]: 담당조직 고르기 창. guess(read)가 내 담당조직 하나를 돌려주면(소식: AI가 쓴 조직 이름, 텔레그램 요청·챙길 것: 후보에 붙은 조직)
  // 창 맨 위에 '조직 › ○○에 넣기'(한 번 누르면 그 조직). 옛 소식 줄 ⋯의 같은 항목을 여기로 옮겼다.
  async function pickOrg(trigger, {guess = () => null, onPick}) {
    let read;
    try { read = await myOrgs(); } catch { say(word('담당조직 목록을 읽지 못했어요. 다시 눌러 주세요')); return; }
    const match = guess(read), {openOrgPicker} = await import('./feed-link.js');
    if (!trigger?.isConnected) return;
    await openOrgPicker(trigger, {orgs: read.orgs, mine: read.mine, selected: '', title: word('넣을 조직'),
      top: match ? [{key: `o:${match.id}`, name: word`조직 › ${match.name}에 넣기`, attrs: 'data-forget-org-match'}] : null,
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
  // FORGET-넣기되돌리기: 넣은 기록 한 줄을 {kind, id, orgId}로 돌려준다(되돌리기가 그 줄만 지운다). 이미 들어가 있던 줄(409, 돌려받은 줄 없음)은 null —
  // 이번에 넣은 것이 아니므로 지우지 않는다.
  const savedOf = (kind, rows, orgId = null) => { const id = Array.isArray(rows) ? rows[0]?.id : null; return id ? {kind, id: String(id), orgId} : null; };
  const saveOrg = async (org, text, from = null) => savedOf('org', await (await import('./quick-save.js')).saveOrganizationUpdate({organization_id: org.id, raw_text: text, created_by: user(), ...(from ? {source_kind: 'memorable', source_id: from} : {})}, rt), org.id);
  // BIZ-기록하나로 B-3(설계 record-one.md 4절): [사업] = 그 사업의 사업 기록 한 줄(app_business_records). 소식 줄은 source_kind memorable·원래 소식 줄 번호·
  // 날짜 = 소식 날짜, 챙길 것 후보는 원래 줄을 남기는 출처가 없어 직접 쓰기(user)·오늘 날짜. 옛 사업 진행 기록(app_project_progress_updates)에는 더 넣지 않는다.
  const saveArea = async (project, text, news = null) => savedOf('area', await (await import('./business-now-data.js')).saveBusinessRecord({space_id: project.id, day: news?.day || seoulDateKey(), body: text,
    ...(news?.id ? {source_kind: 'memorable', source_id: news.id} : {source_kind: 'user'})}, rt));
  // [되돌리기]의 앞 반: 방금 넣은 그 한 줄만 기존 소유자 삭제 길로 지운다(조직 기록 org-row-delete.js, 사업 기록 business-now-data.js). 새 권한·DB 변경 없음.
  async function dropSaved(saved) {
    if (saved.kind === 'org') {
      const {deleteOrgUpdate} = await import('./org-row-delete.js');
      await deleteOrgUpdate((path, opts) => rt.api(path, opts), saved.id, saved.orgId);
      win.dispatchEvent(new CustomEvent('kptu:record-window-changed', {detail: {source: 'forget-list'}})); // 열려 있는 조직 창·조직보고 창이 다시 읽는다
      return;
    }
    const {deleteBusinessRecord} = await import('./business-now-data.js');
    await deleteBusinessRecord(saved.id, rt); // 사업 화면 알림(BIZ_NOW_EVENT)은 그 함수가 낸다
  }
  // 넣기 되돌리기 한 번: 기록 삭제 → 줄 되살리기(reopen). 삭제가 안 되면 줄도 그대로 두고, 삭제만 되고 되살리기가 안 되면 그대로 알린다(반쯤 된 것을 숨기지 않음).
  const SAVED_UNDO = {failed: '되돌리지 못했어요. 다시 시도해 주세요.', half: '기록은 뺐지만 이 줄을 다시 보이게 하지 못했어요. [최신화]를 눌러 주세요.', done: '기록에서 빼고 다시 보이게 했어요.'};
  async function undoSaved(saved, reopen) {
    try { await dropSaved(saved); } catch { return {status: 'failed', message: SAVED_UNDO.failed}; }
    let back = false;
    try { back = await reopen(); } catch { back = false; }
    return back ? {status: 'done', message: SAVED_UNDO.done} : {status: 'failed', message: SAVED_UNDO.half};
  }

  // ── 소식 줄(FORGET-소식합치기 → 소식바로잡기): 다른 줄과 같은 일곱 버튼. 상태는 표가 허락한 셋뿐 — 처리하면 kept, ×는 dropped ──
  const newsById = id => news.find(r => r.id === id);
  // FORGET-처리전만: 처리하면 줄이 빠지고 늘 되돌리기 알림 하나. kept = 되돌려도 남는 것(만든 할 일·일정·노트) 한마디.
  async function newsMark(r, next, done, undo = false, saved = null, kept = '') {
    const key = `n:${r.id}`;
    if (busy.has(key) || r.status !== 'suggested') return;
    busy.add(key); status = ''; paint();
    let ok = false;
    try { ok = await decideNews(rt, r.id, next, next === 'kept' ? r.line : null); } catch { ok = false; }
    busy.delete(key);
    if (!ok) { say(next === 'kept' && (!undo || kept) ? '만들었지만 이 줄은 목록에서 빼지 못했어요. ×로 빼 주세요.' : '저장하지 못했어요. 다시 눌러 주세요'); return; }
    r.status = next; r.decidedAt = new Date().toISOString(); say(done);
    if (saved) offerUndoNotice({text: done, onUndo: () => undoSaved(saved, async () => {
      const back = await decideNews(rt, r.id, 'suggested');
      if (back) { r.status = 'suggested'; r.decidedAt = ''; status = ''; paint(); }
      return back;
    })});
    else if (undo) offerUndoNotice({text: done, onUndo: async () => {
      let back = false;
      try { back = await decideNews(rt, r.id, 'suggested'); } catch { back = false; }
      if (!back) return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
      r.status = 'suggested'; r.decidedAt = ''; status = ''; paint();
      return {status: 'done', message: kept ? `다시 보이게 했어요. ${kept}` : '다시 보이게 했어요.'};
    }});
  }
  const KEPT = Object.freeze({task: '만든 할 일은 그대로예요.', event: '만든 일정은 그대로예요.', note: '저장한 노트는 그대로예요.'});
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
    // UI-잊지말기줄단추: 폰은 [노트로]가 줄 ⋯ 안 — 다시 그린 뒤에는 보이는 [노트로], 없으면 그 줄의 ⋯ 옆.
    const shown = el => el && el.getClientRects().length ? el : null;
    return openNoteQuick({...args, anchor, reanchor: () => {
      const row = rowKey ? [...document.querySelectorAll('[data-nbx-row]')].find(r => r.dataset.nbxRow === rowKey) : null;
      return shown(row?.querySelector('[data-nbx-act="note"]')) || shown(row?.querySelector('.nbx-more')) || null;
    }});
  }
  async function newsKeep(r, save, done) {
    const key = `n:${r.id}`;
    if (busy.has(key) || r.status !== 'suggested') return;
    busy.add(key); status = ''; paint();
    let saved = null;
    try { saved = await save(); }
    catch { busy.delete(key); say('넣지 못했어요. 다시 눌러 주세요'); return; }
    busy.delete(key);
    await newsMark(r, 'kept', done, false, saved);
  }
  async function newsAct(r, act, button) {
    if (r.status !== 'suggested' || busy.has(`n:${r.id}`)) return;
    const text = newsText(r), memo = [NEWS_SOURCE_TAG[r.source], shortDay(r.day)].filter(Boolean).join(' · '), mine = radarScope(rt), live = () => mine === radarScope(rt);
    if (act === 'dismissed') return newsMark(r, 'dropped', '무시했어요.', true);
    if (act === 'done') return newsMark(r, 'kept', r.kind === 'promise' ? '받음으로 뺐어요.' : '이미 한 일로 뺐어요.', true);
    if (act === 'ledger') { void copyText(promiseNewsLedger(r)).then(ok => say(ok ? '원장에 넣을 약속 문구를 복사했어요.' : '복사하지 못했어요.')); return; }
    // [조직]: 그 조직 이름이 이미 줄 앞에 있으면 줄만, 다른 조직에 넣으면 AI가 쓴 이름까지 그대로 남긴다.
    if (act === 'org') return pickOrg(button, {guess: read => matchOrg(r.org, read.orgs, read.mine),
      onPick: org => void newsKeep(r, () => saveOrg(org, matchOrg(r.org, [org], new Set([org.id])) ? r.line : text, r.id), orgDone(org))});
    if (act === 'area') return pickArea(button, project => void newsKeep(r, () => saveArea(project, text, r), areaDone(project)));
    if (act === 'task') {
      try {
        await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
        win.KPTUGoogleTasks.openEditor(null, {title: cut(text, 100), memo, onCreated: () => { if (live()) void newsMark(r, 'kept', '할 일로 만들었어요', true, null, KEPT.task); }});
      } catch { say('할 일 창을 열지 못했어요'); }
      return;
    }
    if (act === 'event') {
      if (!win.KPTUEventCreate?.open) { say('일정 창을 열지 못했어요'); return; }
      win.KPTUEventCreate.open({title: cut(text, 100), memo, onCreated: () => { if (live()) void newsMark(r, 'kept', '일정으로 만들었어요', true, null, KEPT.event); }});
      return;
    }
    if (act === 'note') {
      try {
        await openWorkNote(`${text}\n\n${memo}`, () => { if (live()) void newsMark(r, 'kept', '노트로 저장했어요', true, null, KEPT.note); }, button);
      } catch { say('노트 창을 열지 못했어요'); }
    }
  }

  // ── 챙길 것·텔레그램 후보 줄(기존 정리함 챙길 것·나한테 온 요청 길 그대로) ──
  async function decideCandidate(c, runIt, outcome, done, undo = null, saved = null, kept = '') {
    busy.add(c.id); status = ''; paint();
    let ok = false;
    try { ok = await runIt(); } catch { ok = false; }
    busy.delete(c.id);
    if (!ok) { say('저장하지 못했어요. 다시 눌러 주세요'); return; }
    c.status = outcome === 'dismissed' || outcome === 'already_tasked' ? 'dismissed' : outcome === 'tasked' ? 'tasked' : 'done'; c.outcome = outcome; c.decided_at = new Date().toISOString();
    const feedbackId = await logFeedback(c, outcome, {rt});
    say(done); changed();
    if (saved) offerUndoNotice({text: done, onUndo: () => undoSaved(saved, async () => {
      const back = await reopenCandidate(c.id, rt, outcome);
      if (back) { if (feedbackId) await dropFeedback(feedbackId, rt); c.status = 'open'; c.decided_at = null; delete c.outcome; status = ''; paint(); changed(); }
      return back;
    })});
    else if (undo) offerUndoNotice({text: done, onUndo: async () => {
      let back = false;
      try { back = await (undo === 'tasked' ? unlinkCandidate(c.id, rt) : reopenCandidate(c.id, rt, undo)); } catch { back = false; } // 할 일로 보낸 줄은 이은 할 일 번호도 비운다
      if (!back) return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
      if (feedbackId) await dropFeedback(feedbackId, rt);
      c.status = 'open'; c.decided_at = null; delete c.outcome; status = ''; paint(); changed();
      return {status: 'done', message: kept ? `다시 보이게 했어요. ${kept}` : '다시 보이게 했어요.'};
    }});
  }
  // [할 일로]: 어느 줄이든(AI 제안·텔레그램) 제목·출처 연결을 채운 할 일 창을 연다 — 고쳐서 저장하면 tasked(결과 기록 tasked), 되돌리기는 이은 할 일 번호를 비운다.
  // (2026-11-27 사용자 결정: AI 제안 줄의 옛 [수정해서 할 일로]와 합침. 창만 열고 닫으면 줄·기록은 그대로.)
  async function candidateTask(c) {
    const draft = candidateDraft(c), mine = radarScope(rt), live = () => mine === radarScope(rt);
    try {
      await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
      win.KPTUGoogleTasks.openEditor(null, {title: draft.title, memo: draft.memo, links: taskLinks(c),
        onCreated: taskId => { if (live()) void decideCandidate(c, () => markTasked(c.id, taskId, rt, new Date(), null), 'tasked', '할 일로 만들었어요', 'tasked', null, KEPT.task); }});
    } catch { say('할 일 창을 열지 못했어요'); }
  }
  // [조직]·[사업]: 고른 곳에 그 줄 글을 기록으로 넣고, 후보는 '이미 함'과 같은 처리(done)로 뺀다.
  async function candidateReport(c, save, done) {
    if (c.status !== 'open' || busy.has(c.id)) return;
    busy.add(c.id); status = ''; paint();
    let saved = null;
    try { saved = await save(); } catch { busy.delete(c.id); say('넣지 못했어요. 다시 눌러 주세요'); return; }
    busy.delete(c.id);
    await decideCandidate(c, () => markDone(c.id, rt), 'done', done, null, saved);
  }
  async function candidateAct(c, kind, button) {
    if (c.status !== 'open' || busy.has(c.id)) return;
    const draft = candidateDraft(c), mine = radarScope(rt), live = () => mine === radarScope(rt);
    if (kind === 'org') return pickOrg(button, {guess: read => (read.orgs || []).find(o => o?.id && o.id === c.organization_id && o.active !== false && read.mine?.has?.(o.id)) || null,
      onPick: org => void candidateReport(c, () => saveOrg(org, c.summary), orgDone(org))});
    if (kind === 'area') return pickArea(button, project => void candidateReport(c, () => saveArea(project, c.summary), areaDone(project)));
    if (kind === 'dismissed') return decideCandidate(c, () => dismissCandidate(c.id, rt), 'dismissed', '무시했어요.', 'dismissed');
    if (kind === 'done') return decideCandidate(c, () => markDone(c.id, rt), 'done', '이미 한 일로 뺐어요.', 'done');
    if (kind === 'task') return candidateTask(c);
    if (kind === 'event') {
      if (!win.KPTUEventCreate?.open) { say('일정 창을 열지 못했어요'); return; }
      win.KPTUEventCreate.open({title: draft.title, memo: draft.memo, onCreated: () => { if (live()) void decideCandidate(c, () => markDone(c.id, rt), 'done', '일정으로 만들었어요', 'done', null, KEPT.event); }});
      return;
    }
    if (kind === 'note') {
      try {
        await openWorkNote(`${c.summary}\n\n${draft.memo}`, () => { if (live()) void decideCandidate(c, () => markDone(c.id, rt), 'done', '노트로 저장했어요', 'done', null, KEPT.note); }, button);
      } catch { say('노트 창을 열지 못했어요'); }
    }
  }
  // 묶음을 펼친 채로 다시 그리기(줄을 처리해도 접히지 않게). 이 화면 동안만 기억한다(저장하지 않음).
  host.addEventListener('toggle', e => { const b = e.target?.closest?.('[data-nbx-group]'); if (!b) return; if (e.target.open) openBundles.add(b.dataset.nbxGroup); else openBundles.delete(b.dataset.nbxGroup); }, true);
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
  function familyUndo(n, text, done = null, kept = '') {
    offerUndoNotice({text, onUndo: async () => {
      try { await decideFamily(rt, ws(), n.id, 'new'); } catch { return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'}; }
      notes = [{...n, status: 'new'}, ...notes.filter(x => x.id !== n.id)]; status = ''; paint();
      // [이미 함]이면 노트에 더한 그 줄도 뺀다(못 빼면 제안만 돌아오고 알린다).
      if (done) {
        try { const {undoDone} = await import('./family-note-send.js'); await undoDone(rt, done); }
        catch { return {status: 'done', message: '제안은 돌렸지만 노트의 줄은 남았어요'}; }
      }
      return {status: 'done', message: kept ? `되돌렸어요. ${kept}` : '되돌렸어요.'};
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
          onSent: ({folderName}) => { const text = folderName ? `'${folderName}' 폴더 노트에 넣었어요` : '노트에 넣었어요'; void familyChange(n, 'kept', text).then(ok => ok && familyUndo(n, text, null, KEPT.note)); }});
      } catch { say('노트로 보내는 창을 열지 못했어요'); }
      return;
    }
    if (kind === 'task') {
      try {
        await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
        win.KPTUGoogleTasks.openEditor(null, {title: draft.title, memo: draft.memo, onCreated: () => void familyChange(n, 'tasked', '할 일로 만들었어요').then(ok => ok && familyUndo(n, '할 일로 만들었어요', null, KEPT.task))});
      } catch { say('할 일 창을 열지 못했어요'); }
      return;
    }
    if (kind === 'event') {
      if (!win.KPTUEventCreate?.open) { say('일정 창을 열지 못했어요'); return; }
      win.KPTUEventCreate.open({title: draft.title, memo: draft.memo, onCreated: () => void familyChange(n, 'scheduled', '일정으로 만들었어요').then(ok => ok && familyUndo(n, '일정으로 만들었어요', null, KEPT.event))});
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
    if (openFromMeta(b)) return;
    if (b.dataset.forgetMore) { more.open(b); return; }
    if (b.dataset.forgetNewsOpen) { const r = newsById(b.dataset.forgetNewsOpen); if (r) void openNewsSource(r, rt).then(ok => { if (!ok) say('원본을 열지 못했어요.'); }, () => say('원본을 열지 못했어요. 다시 시도해 주세요.')); return; }
    const d = b.dataset;
    if (d.forgetSource) { const c = byId(d.forgetSource); if (c) openSource(c); return; }
    const act = b.dataset.nbxAct, row = b.closest('[data-nbx-row]')?.dataset.nbxRow || '';
    if (!act || !row) return;
    const [kind, id] = [row.slice(0, 1), row.slice(2)];
    if (kind !== 'p') { rowAct(row, act, b); return; }
    if (act === 'ledger') { const p = (radarPromises() || [])[Number(id)]; if (p) void copyText(ledgerRequestText(p)).then(ok => say(ok ? '원장에 넣을 약속 문구를 복사했어요.' : '복사하지 못했어요.')); }
  });
  statusEl?.addEventListener('click', event => {
    if (event.target.closest?.('[data-forget-retry]')) { cState = 'loading'; paint(); void loadCandidates(); }
  });
  win.addEventListener(CHANGED, event => {
    if (!host.isConnected || scope !== radarScope(rt)) return;
    if (event.detail?.reload && !busy.size) void loadCandidates(); else paint();
  });
  win.addEventListener('kptu:google-tasks-changed', () => { if (cState === 'ok') paint(); });
  win.addEventListener('kptu:feature-lock-changed', () => { if (cState === 'ok') paint(); });
  win.addEventListener('kptu:session-changed', () => {
    if (scope === radarScope(rt)) return;
    run++; nRun++; rows = []; notes = []; news = []; nOn = false; nPicks = false; orgRead = null; cState = 'loading'; fOn = false; fWs = ''; status = ''; busy.clear();  scope = radarScope(rt);
    paint();
  });
  const api = {refresh, paint,
    // S70-57: 맨 위 칸 '잊지 말기에서 찾기'(basket.js registerScreenFind)가 부른다. 같은 글자면 다시 그리지 않는다.
    query: () => query, setQuery: (raw, {again} = {}) => { const next = String(raw ?? ''); if (next === query && !again) return; query = next; paint(); },
    // 처리 안 한 줄 수(연결 안 된 업데이트 포함, 홈 한 줄과 같은 기준 — 상대 약속은 세지 않음). 모르면 null.
    // FORGET-소식합치기(명진 '넣어'): 처리 전 소식도 센다.
    openCount: count => cState === 'ok' && Number.isInteger(count) ? openCandidates(rows, taskTitles()).length + (fOn ? notes.length : 0) + (nOn ? openNews(news, nPicks).length : 0) + count : null};
  paint();
  return api;
}
