// HOME-모바일홈채우기: 폰·중간 폭 홈(1023px 이하)의 한 줄 요약('일정 3 · 할 일 4 · 새 소식 12')과 새 칸 셋(놓친 약속 · 정리 안 된 것 · 내일)의
// 유일한 renderer. PC 홈(1024px~)에서는 이 칸들을 만들지 않고 숨긴다. home-read.js는 일정·할 일·내일 일정 숫자만 넘기고
// (setEvents·setTasks·setTomorrow), 원장·텔레그램 소식·정리함 숫자는 home-fill-data.js로 여기서 읽는다.
// 규칙: 놓친 약속·내일이 비면 '없음' 한 줄, 정리 안 된 것은 0건이면 줄 자체를 그리지 않음, 새 소식을 알 수 없으면 요약에서 뺀다.
import {summaryText, pickMissed, missedTag, tomorrowLine} from './home-fill-model.mjs';
import {readMissedPromises, readNewsCount, readInbox} from './home-fill-data.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clock = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const timeOf = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : clock.format(d); };

const head = (key, title, goto, label) => `<header><h3 id="home-${key}-title">${title}</h3><button type="button" data-goto="${goto}">${label} ›</button></header>`;

export function mountHomeFill({main, rt = window.KPTURuntime}) {
  const tasksCard = main?.querySelector('[data-home-card="tasks"]');
  if (!main || !tasksCard) return null;
  const mq = window.matchMedia('(min-width:1024px)');
  const state = {events: null, tasks: null, news: null, tomorrow: 'loading', missed: 'loading', missedRows: [], inbox: null};
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
  tasksCard.after(missed, inbox, tomorrow);

  function paintMissed() {
    const rows = pickMissed(state.missedRows);
    const body = state.missed === 'loading' ? '<p class="home-status">불러오는 중…</p>'
      : state.missed === 'failed' ? '<p class="home-status">확인하지 못했어요</p>'
      : rows.length ? rows.map(r => {
        const who = typeof r.counterparty === 'string' && r.counterparty.trim() ? `<small>${esc(r.counterparty.trim())}</small>` : '';
        return `<div class="home-line" data-home-missed="${esc(r.id)}"><span class="home-title">${esc(r.title)}</span>${who}<span class="home-day-tag">${esc(missedTag(r))}</span></div>`;
      }).join('')
      : '<p class="home-status">없음</p>';
    missed.innerHTML = `${head('missed', '놓친 약속', 'ledger', '원장')}<div data-home-body>${body}</div>`;
  }
  function paintInbox() {
    const n = state.inbox;
    // 0건·알 수 없음이면 줄 자체를 그리지 않는다.
    inbox.hidden = mq.matches || !(n > 0);
    inbox.innerHTML = n > 0 ? `<button type="button" class="home-fill-inbox-line" data-goto="basket"><span>정리 안 된 것</span><span class="home-fill-inbox-n">${n}건 ›</span></button>` : '';
  }
  function paintTomorrow() {
    const t = state.tomorrow;
    let body;
    if (t === 'loading') body = '<p class="home-status">불러오는 중…</p>';
    else if (t === 'unavailable') body = '<p class="home-status">확인하지 못했어요</p>';
    else {
      const line = tomorrowLine(t, timeOf);
      body = line ? `<div class="home-line"><time>${esc(line.time)}</time><span class="home-title">${esc(line.title)}</span>${line.more ? `<small>외 ${line.more}건</small>` : ''}</div>` : '<p class="home-status">없음</p>';
    }
    tomorrow.innerHTML = `${head('tomorrow', '내일', 'calendar', '달력')}<div data-home-body>${body}</div>`;
  }
  function paintSummary() {
    const text = summaryText({events: state.events, tasks: state.tasks, news: state.news});
    summary.textContent = text; summary.hidden = mq.matches || !text;
  }
  function apply() {
    const off = mq.matches;
    missed.hidden = off; tomorrow.hidden = off;
    paintSummary(); paintInbox();
  }
  paintMissed(); paintTomorrow(); apply();
  mq.addEventListener('change', apply);

  async function refresh() {
    const titles = (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);
    const [m, news, inboxN] = await Promise.all([readMissedPromises(rt), readNewsCount(rt), readInbox(rt, titles)]);
    if (!alive) return;
    state.missed = m.ok ? 'ok' : 'failed'; state.missedRows = m.rows; state.news = news; state.inbox = inboxN;
    paintMissed(); paintSummary(); paintInbox();
  }
  void refresh();

  return {
    // home-read.js가 읽은 숫자. null = 아직 모르거나 읽을 수 없음(요약에서 뺀다).
    setEvents(n) { state.events = n; paintSummary(); },
    setTasks(n) { state.tasks = n; paintSummary(); },
    // rows: 내일 일정 목록, null: 달력을 읽지 못함(연결 전 등).
    setTomorrow(rows) { state.tomorrow = rows === null ? 'unavailable' : rows; paintTomorrow(); },
    refresh,
    destroy() { alive = false; mq.removeEventListener('change', apply); summary.remove(); missed.remove(); inbox.remove(); tomorrow.remove(); }
  };
}
