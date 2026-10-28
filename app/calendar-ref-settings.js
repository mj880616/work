import {waitInlineHtml, failHtml} from './wait-state.js';
// 원장 재료 C-4: 내 프로필의 '참고 일정' 칸 (docs/design/ledger-sources.md 5.1). profile-settings.js가 칸 자리를 만들고 이 모듈이 그 안을 그린다.
// 캘린더 하나 고르기 → 내 일정 색(0~5개) → [내가 만든 일정도 포함]. 바꾸면 바로 서버(app_profiles.ledger_calendar)에 저장하고 한 번 맞춰 본다.
// 이 칸은 프로필의 [저장] 버튼과 따로 바로 저장한다(고르기 값 하나라서, 저장 안 된 변경이 생기지 않음).
// 캘린더를 비우거나 바꾸면 저장된 참고 일정을 모두 지운다(지우기 → 저장 순서: 저장이 실패해도 개인 일정이 남지 않는다).
import {readChoice, saveChoice, readCalendars, clearRefs, syncRefs, defaultSyncRange} from './calendar-ref-data.js';
import {toggleColor, COLORS_MAX} from './calendar-ref-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const COLOR_IDS = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);

export function mountCalendarRefSettings(host, {rt, userId, confirm = message => window.confirm(message)}) {
  let state = {phase: 'loading', choice: {calendar: '', colors: [], mine: false}, calendars: [], eventColors: {}, busy: false, note: ''};
  let run = 0;

  function render() {
    if (!host.isConnected) return;
    const {phase, choice, calendars, eventColors, busy, note} = state;
    const head = `<div class="ps-panel-head"><h3>참고 일정</h3><span class="ps-state" data-ps-calref-state role="status" aria-live="polite">${esc(note)}</span></div>`;
    if (phase !== 'ready') {
      const line = phase === 'loading' ? waitInlineHtml() : phase === 'disconnected' ? '<span class="ps-calref-line">Google 캘린더를 연결하면 고를 수 있어요.</span>' : failHtml();
      host.innerHTML = `${head}<div class="ps-calref">${line}</div>`;
      return;
    }
    const known = calendars.some(c => c.id === choice.calendar);
    const options = ['<option value="">고르지 않음</option>',
      ...(choice.calendar && !known ? [`<option value="${esc(choice.calendar)}" selected>고른 캘린더(목록에 없음)</option>`] : []),
      ...calendars.map(c => `<option value="${esc(c.id)}"${c.id === choice.calendar ? ' selected' : ''}>${esc(c.summary || '이름 없는 캘린더')}</option>`)].join('');
    const colors = choice.calendar ? `<div class="ps-calref-row" role="group" aria-label="내 일정 색"><span class="ps-calref-label">내 일정 색</span><span class="ps-calref-colors">${COLOR_IDS.map(id => {
      const bg = eventColors?.[id]?.background, on = choice.colors.includes(id);
      return `<button type="button" class="ps-calref-color" data-ps-calref-color="${id}" aria-pressed="${on}" aria-label="색 ${id}"${bg ? ` style="--ps-calref-swatch:${esc(bg)}"` : ''}${busy ? ' disabled' : ''}>${on ? '✓' : id}</button>`;
    }).join('')}</span></div>
      <label class="ps-calref-row ps-calref-check"><input type="checkbox" data-ps-calref-mine${choice.mine ? ' checked' : ''}${busy ? ' disabled' : ''}><span>내가 만든 일정도 포함</span></label>` : '';
    host.innerHTML = `${head}<div class="ps-calref"><label class="ps-calref-row"><span class="ps-calref-label">캘린더</span><select class="ps-calref-select" data-ps-calref-calendar aria-label="참고할 개인 공유 캘린더"${busy ? ' disabled' : ''}>${options}</select></label>${colors}</div>`;
  }
  const say = note => { state = {...state, note}; const el = host.querySelector('[data-ps-calref-state]'); if (el) el.textContent = note; };

  async function load() {
    const mine = ++run;
    state = {...state, phase: 'loading', note: ''};
    render();
    try {
      const [{choice, unavailable}, cal] = await Promise.all([readChoice(rt, userId()), readCalendars(rt).catch(() => null)]);
      if (mine !== run) return;
      if (unavailable) state = {...state, phase: 'failed'};
      else if (!cal) state = {...state, phase: choice.calendar ? 'ready' : 'failed', choice, calendars: [], eventColors: {}};
      else if (!cal.connected && !choice.calendar) state = {...state, phase: 'disconnected', choice};
      else state = {...state, phase: 'ready', choice, calendars: cal.calendars, eventColors: cal.eventColors};
    } catch { if (mine !== run) return; state = {...state, phase: 'failed'}; }
    render();
  }

  // 새 값 저장 → (캘린더가 있으면) 지금 범위를 한 번 맞춰 결과 한 줄을 보인다.
  async function apply(next) {
    if (state.busy) return;
    const prev = state.choice;
    const calendarChanged = next.calendar !== prev.calendar;
    if (calendarChanged && prev.calendar && !confirm('고른 캘린더가 바뀌면 지금 저장된 참고 일정을 모두 지워요. 계속할까요?')) { render(); return; }
    state = {...state, busy: true}; render(); say('저장 중…');
    try {
      if (calendarChanged && prev.calendar) await clearRefs(rt);
      await saveChoice(rt, next, userId());
      state = {...state, choice: next};
    } catch { state = {...state, busy: false}; render(); say('저장하지 못했어요. 다시 골라 주세요.'); return; }
    let note = next.calendar ? '저장했어요' : '비웠어요';
    if (next.calendar) {
      try {
        const { first, end } = defaultSyncRange();
        const result = await syncRefs(rt, next, first, end);
        note = result?.summary || note;
        if (result?.fallback) note += ' · 달력 화면에 보이는 캘린더만 읽혀요(서버 갱신 전)';
        else if (result?.legacy && next.mine) note += ' · 내가 만든 일정은 서버 갱신 뒤부터 가려져요';
      } catch { note = '저장했어요 · 일정은 지금 읽지 못했어요'; }
    }
    state = {...state, busy: false}; render(); say(note);
  }

  host.addEventListener('change', event => {
    const select = event.target.closest?.('[data-ps-calref-calendar]');
    if (select) { const calendar = select.value; apply({calendar, colors: calendar === state.choice.calendar ? state.choice.colors : [], mine: calendar && !state.choice.calendar ? true : state.choice.mine}); return; }
    const mine = event.target.closest?.('[data-ps-calref-mine]');
    if (mine) apply({...state.choice, mine: mine.checked});
  });
  host.addEventListener('click', event => {
    const button = event.target.closest?.('[data-ps-calref-color]');
    if (!button || state.busy) return;
    const colors = toggleColor(state.choice.colors, button.dataset.psCalrefColor);
    if (!colors) { say(`색은 ${COLORS_MAX}개까지 고를 수 있어요.`); return; }
    apply({...state.choice, colors});
  });
  return {load};
}
