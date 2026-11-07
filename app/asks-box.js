// S52-09 UI-요청상자통일(요청함 11/07 10:52, 시안 docs/design/mockups/home-asks-box.html, 명진 'ㅇ'): '나한테 온 요청' 상자 하나.
// 홈 [하루] 카드 맨 위(home-summary.js가 숫자·줄 재료를 넘김)와 정리함 [챙길 것] 처리 전 위(inbox-todos.js가 넘김)가 같은 이 부품을 쓴다.
// - 상자·머리 줄·줄·버튼은 '잊지 말기' 상자와 같은 공용 부품(notice-box.mjs). 색만 톤다운 파랑.
// - 머리 줄 '나한테 온 요청 n · 텔레그램 · 정리함 열기 ›'(홈만 [정리함 열기 ›]). 없으면 한 줄 '나한테 온 요청 · 새 요청 없음 ·'.
// - 줄 = 요청 한 줄 + 아래 작은 줄(왼쪽 방 이름 · 날짜, 오른쪽 [할 일로][이미 함][일정으로][노트로] ×).
//   [할 일로]·[일정으로]는 그 창에서 저장돼야, [노트로]는 새 노트가 저장돼야 상태가 바뀐다. [이미 함]·[×]는 바로 빠지고 5초 되돌리기.
//   상태는 기존 챙길 것 길(todo-radar-data.js: tasked·done·dismissed + 결과 기록)만 쓴다. 일정·노트로 보낸 것은 '이미 함'(done)으로 남긴다.
// - 홈은 맨 아래 흐린 한 줄 '챙길 것 n · 정리 안 된 것 n ›'(+ ' · 내일 약속 n ›')을 둔다(옛 날짜 밑 요약 줄을 옮김).
// - 텔레그램 요청은 운영자 기능(서버 허용 표의 telegram)인 작업공간만 상자를 그린다(on). 그 밖은 홈의 흐린 한 줄만. 화면 숨김은 보안이 아니다(표는 서버가 막음).
// 이 파일이 그 자리의 유일한 renderer다(부른 쪽은 set()으로 재료만 넘김). 기기 저장 없음.
import {NB_UNDO_MS, boxHtml, esc, headHtml, markBox, rowHtml} from './notice-box.mjs';
import {dismissCandidate, reopenCandidate, markDone, markTasked, logFeedback, dropFeedback, radarScope} from './todo-radar-data.js';
import {dueLabel} from './task-due.mjs';
import {setHomeAsks} from './home-asks.js';

const CHANGED = 'kptu:todo-radar-changed';
const shortDay = v => { const m = String(v ?? '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${Number(m[1])}/${Number(m[2])}` : ''; };
// 아래 작은 줄 왼쪽: 누가(방 이름, 모르면 '텔레그램') · 날짜(+ 제안 기한). 출처 '텔레그램'은 머리 줄에 한 번만 쓴다(폰 한 줄에 맞춤).
export function askMeta(c) {
  return [c?.tg?.room_label || '텔레그램', shortDay(c?.source_day), dueLabel(c?.due) ? `기한 ${dueLabel(c.due)}` : ''].filter(Boolean).join(' · ');
}
// 할 일·일정·노트 창에 미리 채울 글. 날짜는 바꾸지 않는다(명진이 창에서 고름).
export const askDraft = c => ({title: [...String(c?.summary || '')].slice(0, 100).join(''),
  memo: ['텔레그램', c?.tg?.room_label || '', shortDay(c?.source_day)].filter(Boolean).join(' · ')});

// 홈 맨 아래 흐린 한 줄(누르면 정리함·원장, 옛 요약 줄과 같은 data 이름).
function footHtml({todos, unsorted, promises = 0}) {
  const label = `챙길 것 ${todos}, 정리 안 된 것 ${unsorted}. 정리함 열기`;
  return `<div class="nbx-foot"><button type="button" class="row-act nbx-foot-open" data-goto="basket" aria-label="${esc(label)}">챙길 것 <span data-home-summary-todos>${todos}</span> · 정리 안 된 것 <span data-home-summary-unsorted>${unsorted}</span> ›</button>`
    + (promises > 0 ? `<span aria-hidden="true">·</span><button type="button" class="row-act nbx-foot-open" data-goto="ledger" data-home-summary-promises aria-label="${esc(`내일 약속 ${promises}. 원장 열기`)}">내일 약속 ${promises} ›</button>` : '')
    + '</div>';
}

// where: 'home'(머리 줄에 [정리함 열기 ›], 맨 아래 흐린 한 줄) | 'inbox'(정리함 안이라 둘 다 없음).
export function mountAsksBox(host, {rt = window.KPTURuntime, where = 'home', win = window} = {}) {
  if (!host) return null;
  let data = null, rows = [], busy = '', status = '', undo = null, undoTimer = 0, scope = radarScope(rt);
  const changed = () => win.dispatchEvent(new CustomEvent(CHANGED, {detail: {reload: true}}));
  const tellCount = () => { if (data?.on) setHomeAsks(rows.length); };

  function render() {
    if (!data || (!data.on && !data.foot)) { host.hidden = true; host.replaceChildren(); return; }
    host.hidden = false;
    const foot = data.foot ? footHtml(data.foot) : '';
    if (!data.on) {
      // 운영자 기능 telegram이 없는 작업공간: 상자 없이 흐린 한 줄만(같은 자리).
      host.classList.remove('nbx'); host.classList.add('nbx-plain'); delete host.dataset.nbxTone; host.setAttribute('aria-label', '정리함 숫자');
      host.innerHTML = foot;
      return;
    }
    host.classList.remove('nbx-plain'); markBox(host, 'ask'); host.setAttribute('aria-label', '나한테 온 요청');
    const head = headHtml({title: '나한테 온 요청', count: rows.length, countAttr: 'data-asks-count', faint: rows.length ? '· 텔레그램 ·' : '· 새 요청 없음 ·',
      open: where === 'home' ? {attr: 'data-goto="basket"', label: '정리함 열기 ›'} : null});
    host.innerHTML = boxHtml({head, rows: rows.map(c => rowHtml({id: c.id, body: c.summary, meta: askMeta(c), busy: busy === c.id})), status, undo: !!undo, foot});
  }
  // data: null(못 읽음·숨김) 또는 {on, rows, foot}. 진행 중인 되돌리기·상태 글은 그대로 둔다.
  function set(next) {
    data = next || null;
    rows = data?.on ? (Array.isArray(data.rows) ? data.rows.filter(c => c?.status === 'open') : []) : [];
    render();
  }
  const say = text => { status = text; render(); };
  function startUndo(u) {
    clearTimeout(undoTimer); undo = u; render();
    undoTimer = setTimeout(() => { undo = null; status = ''; render(); }, NB_UNDO_MS);
  }
  // 상태 바꾸기 하나(성공하면 줄을 빼고 결과를 기록). 실패하면 줄을 그대로 둔다.
  async function decide(c, run, outcome, done) {
    busy = c.id; status = ''; render();
    let ok = false;
    try { ok = await run(); } catch { ok = false; }
    busy = '';
    if (!ok) { say('저장하지 못했어요. 다시 눌러 주세요'); return null; }
    rows = rows.filter(r => r.id !== c.id); tellCount();
    const feedbackId = await logFeedback(c, outcome, {rt});
    status = done; render(); changed();
    return {feedbackId};
  }
  async function act(c, kind) {
    const draft = askDraft(c), mine = radarScope(rt);
    const live = () => mine === radarScope(rt);
    if (kind === 'dismissed' || kind === 'done') {
      clearTimeout(undoTimer); undo = null;
      const r = kind === 'dismissed'
        ? await decide(c, () => dismissCandidate(c.id, rt), 'dismissed', '지웠어요')
        : await decide(c, () => markDone(c.id, rt), 'done', '이미 한 일로 표시함');
      if (r) startUndo({c, from: kind, feedbackId: r.feedbackId});
      return;
    }
    if (kind === 'task') {
      try {
        await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
        win.KPTUGoogleTasks.openEditor(null, {title: draft.title, memo: draft.memo,
          onCreated: taskId => { if (live()) void decide(c, () => markTasked(c.id, taskId, rt, new Date(), null), 'tasked', '할 일로 만들었어요'); }});
      } catch { say('할 일 창을 열지 못했어요'); }
      return;
    }
    if (kind === 'event') {
      if (!win.KPTUEventCreate?.open) { say('일정 창을 열지 못했어요'); return; }
      win.KPTUEventCreate.open({title: draft.title, memo: draft.memo, onCreated: () => { if (live()) void decide(c, () => markDone(c.id, rt), 'done', '일정으로 만들었어요'); }});
      return;
    }
    if (kind === 'note') {
      try {
        const {openNoteWindow} = await import('./note-window.js');
        openNoteWindow({rt, text: `${c.summary}\n\n${draft.memo}`, onClose: ({saved}) => { if (saved && live()) void decide(c, () => markDone(c.id, rt), 'done', '노트로 저장했어요'); }});
      } catch { say('노트 창을 열지 못했어요'); }
    }
  }
  async function back() {
    const u = undo; clearTimeout(undoTimer); undo = null; render();
    if (!u) return;
    let ok = false;
    try { ok = await reopenCandidate(u.c.id, rt, u.from); } catch { ok = false; }
    if (!ok) { say('되돌리지 못했어요'); return; }
    if (u.feedbackId) await dropFeedback(u.feedbackId, rt);
    rows = [{...u.c, status: 'open'}, ...rows.filter(r => r.id !== u.c.id)]; tellCount();
    status = '되돌렸어요'; render(); changed();
  }
  host.addEventListener('click', event => {
    const b = event.target.closest?.('button');
    if (!b || !host.contains(b) || b.disabled) return;
    if ('nbxUndo' in b.dataset) { void back(); return; }
    const row = b.closest('[data-nbx-row]'), c = row && rows.find(r => r.id === row.dataset.nbxRow);
    if (c && b.dataset.nbxAct && !busy) void act(c, b.dataset.nbxAct);
  });
  win.addEventListener('kptu:session-changed', () => {
    if (scope === radarScope(rt)) return;
    scope = radarScope(rt); clearTimeout(undoTimer); data = null; rows = []; busy = ''; status = ''; undo = null; render();
  });
  return {set, rows: () => rows};
}
