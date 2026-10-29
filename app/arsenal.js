import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
// 주소 개편 ② E1(docs/design/domain-move.md 2절, 시안 docs/design/mockups/domain-move.html): '아스날' 화면(?view=arsenal). #arsenalView의 유일한 그리기 주인.
// - 자료 app/arsenal/matches.js(window.ARSENAL_MATCHES)는 이 화면을 처음 열 때만 불러온다(view-loader가 이 모듈도 열 때만 부름 → 첫 화면 속도 영향 없음).
// - 위 줄: 시즌·대회 고르기·상대 검색·경기 수. 아래: 경기 목록(최신순) + 고른 경기 리뷰.
//   PC(1024px~)는 목록 1/3 · 리뷰 2/3 두 칸, 폰은 목록 → 리뷰 한 칸(KPTURouter.layer, 뒤로 한 번 = 목록).
// - 리뷰: 날짜·대회·경기장 줄, 점수, 득점·도움, 판정(한 문장 요약, 늘 보임), 묶음 넷(첫 묶음만 펼침), 주요 통계, 영상·참고 링크(https만, 새 탭).
// 저장하는 것 없음(읽기 전용 화면, 기기 저장 없음). 거르기 값은 이 탭 메모리에만.
import {ALL, normalizeMatches, seasonsOf, competitionsOf, competitionText, filterMatches, pickMatch, dateText, scoreText,
  goalsOf, reviewSections, statsOf, linksOf, safeUrl, RESULT_KIND} from './arsenal-model.mjs';

(() => {
if (window.KPTUArsenal) return;
const DATA_SRC = './arsenal/matches.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pc = window.matchMedia('(min-width:1024px)');

function install() {
  if (document.getElementById('arsenalView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="arsenalView" class="view-panel hidden" aria-label="아스날">
<div id="arsenalRoot" class="ars">
<div class="ars-bar" role="group" aria-label="경기 거르기">
<label class="a11y-only" for="arsSeason">시즌</label><select id="arsSeason" class="ars-filter" data-ars-season><option value="${ALL}">전체 시즌</option></select>
<label class="a11y-only" for="arsCompetition">대회</label><select id="arsCompetition" class="ars-filter" data-ars-competition><option value="${ALL}">전체 대회</option></select>
<label class="a11y-only" for="arsSearch">상대 검색</label><input id="arsSearch" class="ars-search" data-ars-search type="search" placeholder="상대 검색" autocomplete="off" data-enter-field="off">
<span class="ars-count" data-ars-count role="status" aria-live="polite"></span>
</div>
<div class="ars-body"><div class="ars-list" data-ars-list aria-label="경기 목록"></div><div class="ars-detail" data-ars-detail aria-label="경기 리뷰"></div></div>
</div></section>`);
}
install();

const root = document.getElementById('arsenalRoot');
const $ = sel => root?.querySelector(sel);
let matches = null, loading = null, failed = false, selected = null, detailOpen = false, layer = null;
const filters = {season: ALL, competition: ALL, query: ''};

// 자료 한 번 불러오기(고전 스크립트, window.ARSENAL_MATCHES). 실패하면 [다시]로 다시 부를 수 있다.
function loadData() {
  if (matches) return Promise.resolve(matches);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (Array.isArray(window.ARSENAL_MATCHES)) return resolve(window.ARSENAL_MATCHES);
    const script = document.createElement('script');
    script.src = DATA_SRC; script.async = true; script.dataset.arsenalData = '';
    script.onload = () => Array.isArray(window.ARSENAL_MATCHES) ? resolve(window.ARSENAL_MATCHES) : reject(new Error('arsenal data'));
    script.onerror = () => { script.remove(); reject(new Error('arsenal data')); };
    document.head.append(script);
  }).then(raw => { matches = normalizeMatches(raw); failed = false; fillFilters(); return matches; })
    .catch(err => { failed = true; throw err; })
    .finally(() => { loading = null; });
  return loading;
}

function fillFilters() {
  const season = $('[data-ars-season]'), comp = $('[data-ars-competition]');
  if (!season || !comp) return;
  season.length = 1; comp.length = 1;
  for (const s of seasonsOf(matches)) season.append(new Option(s, s));
  for (const c of competitionsOf(matches)) comp.append(new Option(competitionText(c), c));
  season.value = filters.season; comp.value = filters.competition;
  if (season.value !== filters.season) filters.season = season.value = ALL;
  if (comp.value !== filters.competition) filters.competition = comp.value = ALL;
}

const resultHtml = m => `<span class="ars-res ars-res-${RESULT_KIND[m.result] || 'draw'}">${esc(m.result)}</span>`;
function rowHtml(m, current) {
  return `<button type="button" class="ars-row" data-ars-row="${esc(m.id)}" aria-pressed="${current ? 'true' : 'false'}" aria-label="${esc(m.title)} 리뷰 보기">
<span class="ars-row-top"><span class="ars-date">${esc(dateText(m.date))}</span>${resultHtml(m)}<span class="ars-row-title">${esc(m.title)}</span></span>
<span class="ars-row-meta">${esc(competitionText(m.competition))} · ${esc(m.round)}${m.subtitle ? ` · ${esc(m.subtitle)}` : ''}</span></button>`;
}

function goalSide(m, side) {
  const goals = goalsOf(m, side), team = side === 'home' ? m.home : m.away;
  const body = goals.length ? `<ul>${goals.map(g => `<li class="goal-entry ${esc(g.type)}"><b>${esc(g.minute)}′</b> ${esc(g.scorer)}${g.kind ? ` <span class="ars-faint">(${g.kind})</span>` : ''} <span class="ars-faint">· 도움 ${esc(g.assist)}</span></li>`).join('')}</ul>`
    : '<p class="ars-faint">득점 없음</p>';
  return `<div class="goal-side ${side}"><p class="ars-k">${esc(team)}</p>${body}</div>`;
}
const linkHtml = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;

function reviewHtml(m) {
  const goalsUrl = safeUrl(m.goalsSource), timeUrl = safeUrl(m.goalsTimeSource);
  const sections = reviewSections(m).map((s, i) => `<details class="ars-sec" data-ars-sec="${s.key}"${i === 0 ? ' open' : ''}><summary>${esc(s.title)}</summary><ul>${s.items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>`).join('');
  const media = linksOf(m.media), sources = linksOf(m.sources);
  return `<article class="ars-review" data-ars-review="${esc(m.id)}">
${pc.matches ? '' : '<button type="button" class="ars-back" data-ars-back>‹ 목록</button>'}
<p class="ars-meta">${[m.season, dateText(m.date), `${competitionText(m.competition)} · ${m.round}`, m.venue, `결과 ${m.result}`].filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('')}</p>
<div class="ars-score"><span class="ars-team">${esc(m.home)}</span><b class="ars-score-num">${esc(scoreText(m))}</b><span class="ars-team away">${esc(m.away)}</span></div>
<section class="goal-summary" aria-label="득점·도움 기록">${goalSide(m, 'home')}${goalSide(m, 'away')}</section>
${goalsUrl ? `<p class="goal-source ars-faint">${linkHtml(goalsUrl, '공식 득점·도움 기록')}${timeUrl ? ` · ${linkHtml(timeUrl, 'UEFA 공식 득점 시간')}` : ''} · 도움 —: 공식 기록상 도움 배정 없음</p>` : ''}
${m.verdict ? `<p class="ars-verdict">${esc(m.verdict)}</p>` : ''}
${sections}
<div class="ars-stats" aria-label="아스날 주요 통계">${statsOf(m).map(s => `<span class="ars-stat"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></span>`).join('')}</div>
${media.length ? `<p class="ars-links" data-ars-media><span class="ars-k">사진·영상</span>${media.map(l => linkHtml(l.url, l.label || '미디어 보기')).join('')}</p>` : ''}
<p class="ars-links" data-ars-sources><span class="ars-k">참고 자료</span>${sources.length ? sources.map(l => linkHtml(l.url, l.label || '출처')).join('') : '<span class="ars-faint">출처 정리 중</span>'}</p>
</article>`;
}

function paint() {
  if (!root) return;
  const list = $('[data-ars-list]'), detail = $('[data-ars-detail]'), count = $('[data-ars-count]');
  if (!matches) {
    count.textContent = '';
    list.innerHTML = failed ? failHtml({retry: 'data-ars-retry'}) : waitHtml({rows:5});
    detail.replaceChildren();
    root.dataset.open = 'false';
    return;
  }
  const shown = filterMatches(matches, filters), current = pickMatch(shown, selected);
  selected = current?.id || null;
  if (!current) closeLayer();
  count.textContent = `경기 ${shown.length}`;
  list.innerHTML = shown.length ? shown.map(m => rowHtml(m, m === current)).join('') : emptyHtml('맞는 경기 없음');
  detail.innerHTML = current ? reviewHtml(current) : '';
  root.dataset.open = String(!!current && (pc.matches || detailOpen));
}

function closeLayer() {
  detailOpen = false;
  const l = layer; layer = null; l?.close();
}
function openMatch(id) {
  selected = id;
  if (!pc.matches) {
    detailOpen = true;
    layer ||= window.KPTURouter?.layer?.open('arsenal-review', {close:() => { layer = null; detailOpen = false; paint(); $(`[data-ars-row="${CSS.escape(selected || '')}"]`)?.focus({preventScroll:true}); return true; }}) || null;
  }
  paint();
  if (pc.matches) $(`[data-ars-row="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
  else { $('[data-ars-back]')?.focus({preventScroll:true}); window.scrollTo({top:0, behavior:'instant'}); }
}

root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b || !root.contains(b)) return;
  if (b.matches('[data-ars-row]')) return openMatch(b.dataset.arsRow);
  if (b.matches('[data-ars-back]')) { const id = selected; closeLayer(); paint(); $(`[data-ars-row="${CSS.escape(id || '')}"]`)?.focus({preventScroll:true}); return; }
  if (b.matches('[data-ars-retry]')) { paint(); loadData().then(paint, paint); }
});
root?.addEventListener('change', event => {
  if (event.target.matches('[data-ars-season]')) filters.season = event.target.value;
  else if (event.target.matches('[data-ars-competition]')) filters.competition = event.target.value;
  else return;
  paint();
});
root?.addEventListener('input', event => {
  if (!event.target.matches('[data-ars-search]')) return;
  filters.query = event.target.value; paint();
});
pc.addEventListener('change', () => { if (pc.matches) closeLayer(); if (window.KPTURouter?.current === 'arsenal') paint(); });

function enter() {
  paint();
  if (!matches) loadData().then(paint, paint);
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'arsenal') return;
  layer = null; detailOpen = false;
});
window.KPTURouter?.on?.('arsenal', enter);
window.KPTUArsenal = {refresh: () => loadData().then(paint, paint)};
if (window.KPTURouter?.current === 'arsenal') enter();
})();
