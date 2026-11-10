// HOME-하루채우기(2026-11-09 명진 요청 08:19, 시안 ④ 승인 09:43): 홈 [하루] 아래 세 칸 — ① 오늘 사진 한 줄 ② 읽을 만한 글 ③ 이런 기록은 어때요?
// 이 파일이 세 칸의 하나뿐인 renderer다(journal.js renderDay가 고른 날을 넘겨 부른다).
// HOME-오늘사진빨리(2026-11-10): '오늘 사진' 칸은 [하루]를 그릴 때부터 자리를 잡고(사진 한 줄 높이), 사진이 없는 날은 '0 · 없음'(할 일 칸과 같은 모양).
//   ②·③은 결과가 있을 때만 보인다 — [하루] 맨 아래(주간보고 재료 위)라 늦게 나타나도 위쪽 칸을 밀지 않는다.
// ① 사진: 일기와 같은 목록(일기에 넣은 사진 + 원드라이브 그날 사진 + 폰 앱이면 폰 사진, 이 기기 사진 출처 설정 그대로)을 읽어
//    home-day-photos-model.mjs 규칙(별표 → 일정 시간 → 나머지 → 캡처, 연속 촬영 하나만)으로 늘어놓는다. AI·서버 저장 없음.
//    목록·그림은 이 탭 메모리에만 있다. 일기 쪽 저장 코드(사진 넣기·지우기·별표 바꾸기)는 부르지 않는다(읽기만).
//    칸은 공용 사진 칸(.act-photo-thumb, ui-standard.css) — 화면 폭에 들어가는 만큼 한 줄, 넘치면 마지막 칸 '+n'. 누르면 그날 일기(사진 보기).
// ②·③: 서버(ai-assist)가 고른 결과를 받아 그리기만 한다(home-day-picks-model.mjs로 거름). 결과가 없으면 칸째 없다.
//    AI 한도에 닿았으면(limit) ② 칸 머리에 기존 한도 알림 한 줄을 보인다(고른 것이 없어도 칸째 숨기지 않음). 일기를 쓴 제안(done)은 그리지 않는다.
//    [일기 쓰기]는 공용 ② 작은 버튼(button.secondary). 누르면 부르는 화면이 일기 쓰기를 연다(onWrite).
import {rankDayPhotos, stripFit, eventWindows, CELL_PX, GAP_PX} from './home-day-photos-model.mjs';
import {emptyHtml, failHtml} from './wait-state.js';
import {cleanReads, openSuggests, suggestTime, readAtLabel, pickedNote, limitNote, READS_OPEN} from './home-day-picks-model.mjs';

const PHOTO_FRESH_MS = 10 * 60 * 1000;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

// 그날 사진 목록 읽기(일기 화면과 같은 함수들). 무거운 모듈은 처음 필요할 때 부른다(홈 첫 화면을 늦추지 않게).
let kitFlight = null;
const kit = () => (kitFlight ||= Promise.all([import('./diary-onedrive.js'), import('./diary-data.js'), import('./phone-photos.js'),
  import('./time-photos-model.mjs'), import('./photo-sources-device.js'), import('./phone-folders-sync.js')])
  .then(([od, diary, phone, time, sources, folders]) => ({od, diary, phone, time, sources, folders}))
  .catch(error => { kitFlight = null; throw error; }));

// HOME-오늘사진빨리 ①(2026-11-10 명진 요청): 예전에는 앱을 켠 직후 홈에 2초 머문 뒤에야 읽기 시작했다. 이제 홈을 그릴 때 바로 읽고,
// 다른 화면으로 가면(alive()가 거짓) 다음 단계(폰 사진 목록·원드라이브 목록 기다리기)로 넘어가지 않고 멈춘다 — 다른 탭 읽기와 겹치지 않게 하던 목적은 '멈춤'으로 지킨다.
// 멈춘 읽기는 홈으로 돌아와 그릴 때 다시 한다.
const onHome = () => { const view = globalThis.window?.KPTURouter?.current; return !view || view === 'home'; };
async function phoneDay(k, day, alive) {
  const phone = k.phone.phonePhotos();
  if (!phone.usable || !k.sources.readDeviceSources().phone) return [];
  const s = await phone.hello();
  if (s.access === 'none' || !s.key || !alive()) return [];
  const page = await phone.page({sort:'taken_desc', filter:'all', before:k.time.dayEndMs(day), limit:200, hide:await k.folders.phoneHideList(phone)});
  return (page.items || []).filter(it => it.day === day);
}
// 원드라이브 지난달 목록은 날을 바꿔 가며 볼 때 다시 묻지 않게 이 탭 메모리에 10분 둔다(로그인한 사람·달마다). 이번 달은 미리 받기 것을 쓴다.
const monthKeep = new Map(); // `${owner}:${y}-${m}` → {at, flight}
function kept(key, read) {
  const hit = monthKeep.get(key);
  if (hit && Date.now() - hit.at < PHOTO_FRESH_MS) return hit.flight;
  const flight = read().catch(error => { monthKeep.delete(key); throw error; });
  monthKeep.set(key, {at:Date.now(), flight});
  return flight;
}
// HOME-오늘사진빨리 ②: 원드라이브는 앱 시작 미리 받기(od-warm.js)와 같은 길이다. 홈이 먼저 오면 미리 받기를 지금 시작시키고(run soon),
// 이번 달 목록 단계가 끝나기를(listed) 기다려 받아 둔 목록을 그대로 쓴다(두 번 받지 않음). 연결 상태도 미리 받기가 물은 것만 쓰고,
// 받아 둔 상태가 없으면(연결 안 됨·30분 지남) 30분에 한 번만 서버에 묻는다.
// → {data, pending}: pending은 미리 받기를 시작하지 못한 경우(앱이 가려짐 등) — 미리 받기가 끝나면('kptu-od-warm') 다시 읽는다.
const OD_ASK_MS = 30 * 60 * 1000;
let odAskedAt = 0;
async function warmApi() {
  const win = globalThis.window;
  if (!win) return null;
  if (!win.KPTUOdWarm) await import('./od-warm.js').catch(() => null);
  return win.KPTUOdWarm || null;
}
async function odMonth(k, rt, year, month, alive) {
  if (!k.sources.readDeviceSources().onedrive) return {data:null};
  const warm = await warmApi();
  if (!warm || !alive()) return {data:null, pending:true};
  if (!warm.listed && !warm.firstDone) warm.run?.({soon:true});
  if (!warm.listed && !warm.firstDone) return {data:null, pending:true};
  await warm.listed;
  if (!alive()) return {data:null, pending:true};
  const ready = k.od.odWarmMonthKept(rt, year, month);
  if (ready) return {data:await ready};
  let status = k.od.odStatusIfWarm(rt);
  if (!status) {
    if (Date.now() - Math.max(odAskedAt, warm.lastAt || 0, warm.firstAt || 0) < OD_ASK_MS) return {data:null};
    odAskedAt = Date.now(); status = k.od.odStatusCached(rt);
  }
  const st = await status;
  if (!st?.connected || !st?.folder || !alive()) return {data:null};
  return {data:await kept(`${k.diary.ownerScope(rt)}:${year}-${month}`, () => k.od.odPhotos(rt, year, month))};
}
// → {items, starred:Set<'source:key'>, odPending} 또는 null(홈을 떠나 멈춤). 한 출처를 못 읽어도 나머지는 보인다.
// HOME-오늘사진빨리 ③: 받는 대로 그린다 — 일기 사진·폰 사진·별표가 원드라이브보다 먼저 오면 onPart로 먼저 넘긴다.
export async function readDayPhotos(day, rt, {alive = onHome, onPart = () => {}} = {}) {
  if (!alive()) return null;
  const k = await kit();
  if (!alive()) return null;
  const year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7)) - 1;
  const build = (row, phone, stars, od) => ({items:k.od.dayItems(day, row, od).concat(k.time.phoneDayItems(phone, day, od?.days?.[day] || [])),
    starred:new Set(stars.map(s => k.od.starKey(s.source, s.item_key)))});
  let odDone = false;
  const local = Promise.all([
    k.diary.readDiaryDay(day, rt).catch(() => null),
    phoneDay(k, day, alive).catch(() => []),
    k.od.odWarmStars(rt, year, month).catch(() => []),
  ]);
  const odPart = odMonth(k, rt, year, month, alive).catch(() => ({data:null})).finally(() => { odDone = true; });
  local.then(([row, phone, stars]) => { if (!odDone && alive()) onPart(build(row, phone, stars, null)); });
  const [[row, phone, stars], od] = await Promise.all([local, odPart]);
  if (!alive()) return null;
  return {...build(row, phone, stars, od.data), odPending:!!od.pending};
}
function thumbOf(k, item, rt) {
  const opts = {label:'', link:false, rt};
  if (item.kind === 'od') return k.od.odPhotoElement(item, 'small', opts);
  if (item.kind === 'phone') return k.phone.phonePhotos().element(item, 'small', opts);
  return k.diary.photoElement(item.row, item.file, 'small', opts);
}

// host: 세 칸이 들어갈 자리. onOpenDay(day): 그날 사진 보기(일기). onWrite(day, text, id): 일기 쓰기 열기.
export function mountDayFill(host, {rt = window.KPTURuntime, owner = () => '', onOpenDay = () => {}, onWrite = () => {}, readPhotos = readDayPhotos} = {}) {
  // HOME-오늘사진빨리 ③: '오늘 사진' 칸은 [하루]를 그릴 때 처음부터 자리(제목 + 사진 한 줄 높이)를 차지하고, 사진은 받는 대로 그 자리에 채운다.
  host.innerHTML = '<section class="journal-group journal-photos" data-journal-photos>'
    + '<div class="journal-schedule-head"><span class="journal-head-name"><h4 class="journal-heading"></h4><small class="journal-head-count" data-journal-photos-count></small></span><button type="button" class="row-act" data-journal-photos-open>사진 보기 ›</button></div>'
    + '<div class="journal-photo-strip" data-journal-photo-strip role="group"></div></section>'
    + '<section class="journal-group journal-reads" data-journal-reads hidden></section>'
    + '<section class="journal-group journal-suggests" data-journal-suggests hidden></section>';
  host.hidden = true;
  const photosHost = host.querySelector('[data-journal-photos]'), readsHost = host.querySelector('[data-journal-reads]'), suggestHost = host.querySelector('[data-journal-suggests]');
  const strip = photosHost.querySelector('[data-journal-photo-strip]');
  const photoReads = new Map(); // `${owner}:${day}` → {state:'part'|'ok'|'failed', items, starred, at, odPending}
  let last = null, k = null, drawnWidth = -1;
  let gen = 0; // 홈을 떠날 때마다 늘어난다 — 그 전에 시작한 읽기는 다음 단계로 넘어가지 않고 멈춘다

  function rankedFor(day, events) {
    const read = photoReads.get(`${owner()}:${day}`);
    if (read?.state !== 'ok' && read?.state !== 'part') return [];
    return rankDayPhotos(read.items, {starred:item => read.starred.has(`${item.source}:${item.key}`), windows:eventWindows(events)});
  }
  const busy = new Map(); // 지금 읽고 있는 날 → 그사이 다시 읽어야 할 일이 생겼는지
  const showing = key => last && !last.hidden && `${owner()}:${last.day}` === key;
  function ensurePhotos(day, {force = false} = {}) {
    const key = `${owner()}:${day}`, read = photoReads.get(key);
    if (busy.has(key)) { if (force) busy.set(key, true); return; }
    if (!onHome()) return; // 홈이 아닐 때는 읽지 않는다(돌아와 그릴 때 읽음)
    if (!force && read && read.state !== 'part' && Date.now() - read.at < PHOTO_FRESH_MS) return;
    busy.set(key, false);
    const mine = gen, alive = () => mine === gen && onHome();
    const onPart = out => kit().then(loaded => {
      k = loaded;
      if (!alive() || photoReads.get(key)?.state === 'ok') return;
      photoReads.set(key, {state:'part', items:out.items, starred:out.starred, at:0});
      if (showing(key)) drawPhotos();
    }, () => {});
    Promise.all([readPhotos(day, rt, {alive, onPart}), kit()]).then(([out, loaded]) => {
      k = loaded;
      if (!out) return; // 홈을 떠나 멈춤 — 돌아와 그릴 때 다시 읽는다(먼저 받은 것은 그대로 보인다)
      photoReads.set(key, {state:'ok', items:out.items, starred:out.starred, at:Date.now(), odPending:!!out.odPending});
    }, () => { const now = photoReads.get(key); if (now?.state !== 'ok' && now?.state !== 'part') photoReads.set(key, {state:'failed', items:[], starred:new Set(), at:Date.now()}); })
      .then(() => {
        const again = busy.get(key); busy.delete(key);
        if (showing(key)) drawPhotos();
        if (again) ensurePhotos(day, {force:true});
      });
  }
  // 사진 줄은 지난번과 같으면 손대지 않고, 달라도 같은 사진의 칸은 그대로 둔 채 바뀐 칸만 고친다(칸을 지우고 새로 만들면 그림이 다시 떠 깜빡인다).
  const cells = new Map(); // 칸 이름(출처:키, 겹치면 번호) → 사진 칸 button
  const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
  const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
  // 칸 상태: 읽는 중(건수 빈칸, 자리만) → 사진 n장 / 0장이면 '0' + '없음' / 못 읽으면 실패 한 줄 + [다시]. 자리 높이는 늘 사진 한 줄(journal.css).
  function setBody(kind) { // kind: 'cells' | 'empty' | 'fail' | 'wait'
    if (strip.dataset.state === kind) return;
    strip.dataset.state = kind;
    if (kind === 'cells') { strip.querySelector('.wait-empty,.wait-fail')?.remove(); return; }
    for (const button of cells.values()) button.remove();
    cells.clear(); strip.querySelector('[data-journal-photo-more]')?.remove(); drawnWidth = -1;
    strip.innerHTML = kind === 'empty' ? emptyHtml('없음', {attrs:'data-journal-photos-empty'}) : kind === 'fail' ? failHtml({text:'사진을 불러오지 못했어요', retry:'data-journal-photos-retry'}) : '';
  }
  function drawPhotos() {
    if (!last) return;
    const {day, today, events} = last, read = photoReads.get(`${owner()}:${day}`);
    const list = k ? rankedFor(day, events) : [];
    const label = day === today ? '오늘 사진' : '그날 사진';
    setText(photosHost.querySelector('.journal-heading'), label);
    setAttr(photosHost.querySelector('[data-journal-photos-open]'), 'aria-label', `${label} 보기`);
    const done = read?.state === 'ok', failed = read?.state === 'failed';
    setText(photosHost.querySelector('[data-journal-photos-count]'), list.length || done ? String(list.length) : '');
    setAttr(strip, 'aria-label', list.length ? `${label} ${list.length}장` : label);
    if (!list.length) { setBody(done ? 'empty' : failed ? 'fail' : 'wait'); return; }
    setBody('cells');
    drawnWidth = strip.clientWidth;
    if (!drawnWidth) return; // 아직 폭이 없으면(칸 자리가 숨겨져 있음) 그리지 않는다 — 폭 감시가 폭이 생기면 다시 부른다
    const fit = stripFit(drawnWidth, list.length, {cell:CELL_PX, gap:GAP_PX});
    const seen = new Set(), want = [];
    list.slice(0, fit.shown).forEach((item, i) => {
      let id = `${item.source || item.kind || ''}:${item.key || ''}`;
      if (!item.key || seen.has(id)) id += `#${i}`;
      seen.add(id);
      let button = cells.get(id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button'; button.className = 'act-photo-thumb journal-photo-cell'; button.dataset.journalPhotoKey = item.key || '';
        button.append(thumbOf(k, item, rt));
        cells.set(id, button);
      }
      setAttr(button, 'data-journal-photo', String(i));
      setAttr(button, 'aria-label', `${label} ${i + 1} — 사진 보기`);
      want.push([id, button]);
    });
    let more = strip.querySelector('[data-journal-photo-more]');
    if (fit.more) {
      if (!more) {
        more = document.createElement('button');
        more.type = 'button'; more.className = 'act-photo-thumb journal-photo-cell journal-photo-more'; more.dataset.journalPhotoMore = '';
      }
      setAttr(more, 'data-ext', `+${fit.more}`); setAttr(more, 'aria-label', `사진 ${fit.more}장 더 — 사진 보기`);
      want.push(['', more]);
    } else more?.remove();
    const keep = new Set(want.map(([id]) => id));
    for (const [id, button] of cells) if (!keep.has(id)) { button.remove(); cells.delete(id); }
    // 이미 그 자리에 있는 칸은 옮기지 않는다.
    want.forEach(([, button], i) => { if (strip.children[i] !== button) strip.insertBefore(button, strip.children[i] || null); });
  }
  // 읽을 만한 글·이런 기록은 어때요?: 그릴 내용(html)이 지난번과 같으면 다시 쓰지 않는다(펼쳐 둔 '더 보기'도 그대로 남는다).
  const painted = new Map(); // 칸 element → 마지막에 쓴 html
  function paint(el, html) {
    if (painted.get(el) === html) return;
    painted.set(el, html); el.innerHTML = html;
  }
  function drawReads() {
    const {day, today, reads} = last, list = day === today ? cleanReads(reads?.items) : [];
    const limit = day === today ? limitNote(last.limit) : '';
    if (!list.length && !limit) { readsHost.hidden = true; readsHost.replaceChildren(); painted.delete(readsHost); return; }
    readsHost.hidden = false;
    const note = limit || pickedNote(reads?.picked_at, today);
    const row = item => `<li class="journal-read" data-journal-read="${esc(item.id)}"><b class="journal-read-title">${esc(item.title)}</b>`
      + `<span class="journal-read-line">무슨 일: ${esc(item.what)}</span><span class="journal-read-line">왜: ${esc(item.why)}</span>`
      + `<small class="journal-read-meta">${esc([item.source, readAtLabel(item.at, today)].filter(Boolean).join(' · '))}${item.url ? ` <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" data-journal-read-link>원문 ›</a>` : ''}</small></li>`;
    const open = list.slice(0, READS_OPEN), rest = list.slice(READS_OPEN);
    paint(readsHost, `<div class="journal-schedule-head"><span class="journal-head-name"><h4 class="journal-heading">읽을 만한 글</h4>${list.length ? `<small class="journal-head-count">${list.length}</small>` : ''}</span>${note ? `<small class="journal-fill-note"${limit ? ' data-journal-fill-limit' : ''}>${esc(note)}</small>` : ''}</div>`
      + (open.length ? `<ul class="journal-reads-list">${open.map(row).join('')}</ul>` : '')
      + (rest.length ? `<details class="journal-fill-more" data-journal-reads-more><summary>${rest.length}개 더</summary><ul class="journal-reads-list">${rest.map(row).join('')}</ul></details>` : ''));
  }
  function drawSuggests() {
    const {day, today, hour, suggests} = last, list = suggestTime({day, today, hour}) ? openSuggests(suggests?.items, suggests?.done) : [];
    if (!list.length) { suggestHost.hidden = true; suggestHost.replaceChildren(); painted.delete(suggestHost); return; }
    suggestHost.hidden = false;
    paint(suggestHost, '<div class="journal-schedule-head"><span class="journal-head-name"><h4 class="journal-heading">이런 기록은 어때요?</h4></span></div>'
      + `<ul class="journal-suggest-list">${list.map(item => `<li class="journal-suggest" data-journal-suggest="${esc(item.id)}"><span class="journal-suggest-text"><span>${esc(item.text)}</span>${item.basis ? `<small class="journal-suggest-basis">${esc(item.basis)}</small>` : ''}</span>`
        + `<button type="button" class="secondary" data-journal-suggest-write="${esc(item.id)}">일기 쓰기</button></li>`).join('')}</ul>`);
  }
  function draw() {
    if (!last) return;
    if (last.hidden) { host.hidden = true; return; }
    host.hidden = false; // '오늘 사진' 자리는 [하루]에 늘 있다(HOME-오늘사진빨리 ③). 읽을 만한 글·기록 제안은 결과가 있을 때만.
    drawPhotos(); drawReads(); drawSuggests();
  }
  host.addEventListener('click', event => {
    if (!last) return;
    if (event.target.closest('[data-journal-photos-retry]')) { ensurePhotos(last.day, {force:true}); return; }
    if (event.target.closest('[data-journal-photos-open],[data-journal-photo],[data-journal-photo-more]')) { onOpenDay(last.day); return; }
    const write = event.target.closest('[data-journal-suggest-write]');
    if (write) {
      const item = openSuggests(last.suggests?.items, last.suggests?.done).find(x => x.id === write.dataset.journalSuggestWrite);
      if (item) onWrite(last.day, item.text, item.id);
    }
  });
  // 원드라이브 미리 받기를 시작하지 못했던 읽기(odPending)만, 미리 받기가 끝나면 다시 읽는다(이미 원드라이브까지 읽은 날은 그대로).
  globalThis.window?.addEventListener?.('kptu-od-warm', () => {
    for (const read of photoReads.values()) if (read.odPending) read.at = 0;
    const read = last && !last.hidden && photoReads.get(`${owner()}:${last.day}`);
    if (read?.odPending) ensurePhotos(last.day, {force:true});
  });
  // 홈을 떠나면 하던 사진 읽기를 멈추고, 돌아오면 이어서 읽는다.
  globalThis.window?.addEventListener?.('kptu:view-changed', event => {
    if (event.detail?.view !== 'home') { gen++; return; }
    if (last && !last.hidden) ensurePhotos(last.day);
  });
  // 폭이 바뀌면(폴드 펼치기·창 크기) 사진 칸 수만 다시 맞춘다.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
    if (strip.dataset.state === 'cells' && strip.clientWidth !== drawnWidth) drawPhotos();
  }).observe(host);
  return {
    // state: {day, today, hour, events, reads:{items, picked_at}|null, suggests:{items, done}|null, limit:''|'monthly_limit'|'daily_limit', hidden}
    render(state) {
      last = {...state};
      if (!state.hidden) ensurePhotos(state.day);
      draw();
    },
    forget() { photoReads.clear(); },
  };
}
