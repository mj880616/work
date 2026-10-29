import {waitHtml, emptyHtml} from './wait-state.js';
// HOME-모바일홈채우기: 폰·중간 폭 홈(1023px 이하)의 한 줄 요약('새 소식 12 · 나한테 온 요청 1')과 새 칸 셋(놓친 약속 · 정리 안 된 것 · 내일)의
// 유일한 renderer. PC 홈(1024px~)에서는 이 칸들을 만들지 않고 숨긴다. home-read.js는 내일 일정만 넘기고
// (setTomorrow), 원장·텔레그램 소식·정리함 숫자는 home-fill-data.js로 여기서 읽는다.
// 규칙: 놓친 약속·내일이 비면 '없음' 한 줄, 정리 안 된 것은 0건이면 줄 자체를 그리지 않음, 새 소식을 알 수 없으면 요약에서 뺀다.
import {summaryText, pickMissed, missedTag, tomorrowLine} from './home-fill-model.mjs';
import {readMissedPromises, readNewsCount, readInbox} from './home-fill-data.js';
import {eventAttrs} from './event-open.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clock = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const timeOf = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : clock.format(d); };

const head = (key, title, goto, label) => `<header><h3 id="home-${key}-title">${title}</h3><button type="button" data-goto="${goto}">${label} ›</button></header>`;

export function mountHomeFill({main, rt = window.KPTURuntime}) {
  if (!main) return null;
  const mq = window.matchMedia('(min-width:1024px)');
  const state = {news: null, tomorrow: 'loading', tomorrowOpen: false, missed: 'loading', missedRows: [], inbox: null, asks: null};
  let alive = true;

  const summary = document.createElement('p');
  summary.className = 'home-summary'; summary.dataset.homeSummary = ''; summary.hidden = true;
  main.prepend(summary);
  const card = (key, cls = '') => {
    const el = document.createElement('section');
    el.className = `home-card home-fill ${cls}`.trim(); el.dataset.homeCard = key; el.setAttribute('aria-labelledby', `home-${key}-title`); el.hidden = true;
    return el;
  };
  const missed = card('missed'), inbox = card('inbox', 'home-fill-inbox'), tomorrow = card('tomorrow');
  // MENU-HOME-편집: 세 칸의 자리는 home-read.js(placeCards)가 홈 칸 순서대로 정한다. 여기서는 만들어 돌려주기만 한다.

  function paintMissed() {
    const rows = pickMissed(state.missedRows);
    const body = state.missed === 'loading' ? waitHtml({rows:2})
      : state.missed === 'failed' ? '<p class="home-status">확인하지 못했어요</p>'
      : rows.length ? rows.map(r => {
        const who = typeof r.counterparty === 'string' && r.counterparty.trim() ? `<small>${esc(r.counterparty.trim())}</small>` : '';
        // HOME-줄누르기 ⑤: 누르면 원장의 그 약속(home-read.js가 연다).
        return `<button type="button" class="home-event home-event-open" data-home-missed="${esc(r.id)}" aria-label="${esc(r.title)} 원장에서 보기"><span class="home-title">${esc(r.title)}</span>${who}<span class="home-day-tag">${esc(missedTag(r))}</span></button>`;
      }).join('')
      : emptyHtml();
    missed.innerHTML = `${head('missed', '놓친 약속', 'ledger', '원장')}<div data-home-body>${body}</div>`;
  }
  function paintInbox() {
    const n = state.inbox;
    // 0건·알 수 없음이면 줄 자체를 그리지 않는다.
    inbox.hidden = mq.matches || !(n > 0);
    inbox.innerHTML = n > 0 ? `<header><h3 id="home-inbox-title">정리 안 된 것</h3><button type="button" class="home-fill-inbox-line" data-goto="basket">${n}건 ›</button></header>` : '';
  }
  // HOME-줄누르기 ③: 첫 일정 줄을 누르면 그 일정 수정 창(home-read.js가 data-google-event로 연다), '외 n건'을 누르면 내일 하루 일정이
  // 이 칸 안에 펼쳐지고(각 줄도 수정 창), 다시 누르면 접힌다. 펼침은 이 칸의 메모리에만 있다.
  const eventLine = (row, tail = '') => {
    const text = `<time>${esc(row.allDay ? '종일' : timeOf(row.start))}</time><span class="home-title">${esc(row.title || '(제목 없음)')}</span>${tail}`;
    return row.id ? `<button type="button" class="home-event home-event-open" ${eventAttrs(row.id, row.calendarId)} aria-label="${esc(row.title || '제목 없음')} 일정 열기">${text}</button>` : `<div class="home-event">${text}</div>`;
  };
  function paintTomorrow() {
    const t = state.tomorrow;
    let body;
    if (t === 'loading') body = waitHtml({rows:2});
    else if (t === 'unavailable') body = '<p class="home-status">확인하지 못했어요</p>';
    else {
      const line = tomorrowLine(t, timeOf);
      if (!line) body = emptyHtml();
      else if (state.tomorrowOpen && line.more) body = t.map(row => eventLine(row)).join('') + '<button type="button" class="home-more" data-home-tomorrow-more="close" aria-expanded="true">접기</button>';
      else body = `<div class="home-tomorrow-line">${eventLine(t[0])}${line.more ? `<button type="button" class="home-tomorrow-more" data-home-tomorrow-more="open" aria-expanded="false">외 ${line.more}건</button>` : ''}</div>`;
    }
    tomorrow.innerHTML = `${head('tomorrow', '내일', 'calendar', '달력')}<div data-home-body>${body}</div>`;
  }
  function paintSummary() {
    const text = summaryText({news: state.news, asks: state.asks});
    summary.textContent = text; summary.hidden = mq.matches || !text;
  }
  function apply() {
    const off = mq.matches;
    missed.hidden = off; tomorrow.hidden = off;
    paintSummary(); paintInbox();
  }
  tomorrow.addEventListener('click', e => {
    const b = e.target.closest?.('[data-home-tomorrow-more]'); if (!b) return;
    state.tomorrowOpen = b.dataset.homeTomorrowMore === 'open'; paintTomorrow();
    tomorrow.querySelector(state.tomorrowOpen ? '[data-home-tomorrow-more="close"]' : '[data-home-tomorrow-more="open"]')?.focus({preventScroll: true});
  });
  paintMissed(); paintTomorrow(); apply();
  mq.addEventListener('change', apply);

  async function refresh() {
    const titles = (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);
    const [m, news, inboxN] = await Promise.all([readMissedPromises(rt), readNewsCount(rt), readInbox(rt, titles)]);
    if (!alive) return;
    state.missed = m.ok ? 'ok' : 'failed'; state.missedRows = m.rows; state.news = news; state.inbox = inboxN.total; state.asks = inboxN.asks;
    paintMissed(); paintSummary(); paintInbox();
  }
  // PC 홈은 이 칸들을 그리지 않으므로 읽지도 않는다. 폭이 좁아질 때 처음 한 번 읽는다.
  let loaded = false;
  const load = () => { if (loaded || mq.matches) return; loaded = true; void refresh(); };
  mq.addEventListener('change', load);
  load();

  return {
    cards: {missed, inbox, tomorrow},
    // rows: 내일 일정 목록, null: 달력을 읽지 못함(연결 전 등).
    setTomorrow(rows) { state.tomorrow = rows === null ? 'unavailable' : rows; paintTomorrow(); },
    refresh,
    destroy() { alive = false; mq.removeEventListener('change', apply); mq.removeEventListener('change', load); summary.remove(); missed.remove(); inbox.remove(); tomorrow.remove(); }
  };
}
