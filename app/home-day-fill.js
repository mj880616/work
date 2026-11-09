// HOME-하루채우기(2026-11-09 명진 요청 08:19, 시안 ④ 승인 09:43): 홈 [하루] 아래 세 칸 — ① 오늘 사진 한 줄 ② 읽을 만한 글 ③ 이런 기록은 어때요?
// 이 파일이 세 칸의 하나뿐인 renderer다(journal.js renderDay가 고른 날을 넘겨 부른다). 셋 다 비면 아무것도 보이지 않는다(빈 안내문 없음).
// ① 사진: 일기와 같은 목록(일기에 넣은 사진 + 원드라이브 그날 사진 + 폰 앱이면 폰 사진, 이 기기 사진 출처 설정 그대로)을 읽어
//    home-day-photos-model.mjs 규칙(별표 → 일정 시간 → 나머지 → 캡처, 연속 촬영 하나만)으로 늘어놓는다. AI·서버 저장 없음.
//    목록·그림은 이 탭 메모리에만 있다. 일기 쪽 저장 코드(사진 넣기·지우기·별표 바꾸기)는 부르지 않는다(읽기만).
//    칸은 공용 사진 칸(.act-photo-thumb, ui-standard.css) — 화면 폭에 들어가는 만큼 한 줄, 넘치면 마지막 칸 '+n'. 누르면 그날 일기(사진 보기).
// ②·③: 서버(ai-assist)가 고른 결과를 받아 그리기만 한다(home-day-picks-model.mjs로 거름). 결과가 없으면 칸째 없다.
//    [일기 쓰기]는 공용 ② 작은 버튼(button.secondary). 누르면 부르는 화면이 일기 쓰기를 연다(onWrite).
import {rankDayPhotos, stripFit, eventWindows, CELL_PX, GAP_PX} from './home-day-photos-model.mjs';
import {cleanReads, cleanSuggests, suggestTime, readAtLabel, pickedNote, READS_OPEN} from './home-day-picks-model.mjs';

const PHOTO_FRESH_MS = 10 * 60 * 1000;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

// 그날 사진 목록 읽기(일기 화면과 같은 함수들). 무거운 모듈은 처음 필요할 때 부른다(홈 첫 화면을 늦추지 않게).
let kitFlight = null;
const kit = () => (kitFlight ||= Promise.all([import('./diary-onedrive.js'), import('./diary-data.js'), import('./phone-photos.js'),
  import('./time-photos-model.mjs'), import('./photo-sources-device.js'), import('./phone-folders-sync.js')])
  .then(([od, diary, phone, time, sources, folders]) => ({od, diary, phone, time, sources, folders}))
  .catch(error => { kitFlight = null; throw error; }));

// 폰 사진(폰 앱만): 앱 다리 읽기는 홈이 잠깐 머문 뒤에, 그때도 홈일 때만 한다(바로 다른 탭으로 가면 그 탭의 읽기와 겹치지 않게).
// 건너뛰면 null → 다음에 홈을 그릴 때 다시 읽는다.
const PHONE_SETTLE_MS = 2000;
const settle = () => new Promise(resolve => setTimeout(resolve, PHONE_SETTLE_MS));
const onHome = () => { const view = globalThis.window?.KPTURouter?.current; return !view || view === 'home'; };
async function phoneDay(k, day) {
  const phone = k.phone.phonePhotos();
  if (!phone.usable || !k.sources.readDeviceSources().phone) return [];
  await settle();
  if (!onHome()) return null;
  const s = await phone.hello();
  if (s.access === 'none' || !s.key) return [];
  const page = await phone.page({sort:'taken_desc', filter:'all', before:k.time.dayEndMs(day), limit:200, hide:await k.folders.phoneHideList(phone)});
  return (page.items || []).filter(it => it.day === day);
}
// 원드라이브 그달 목록·그달 별표는 날을 바꿔 가며 볼 때 다시 묻지 않게 이 탭 메모리에 10분 둔다(로그인한 사람·달마다).
const monthKeep = new Map(); // `${what}:${owner}:${y}-${m}` → {at, flight}
function kept(key, read) {
  const hit = monthKeep.get(key);
  if (hit && Date.now() - hit.at < PHOTO_FRESH_MS) return hit.flight;
  const flight = read().catch(error => { monthKeep.delete(key); throw error; });
  monthKeep.set(key, {at:Date.now(), flight});
  return flight;
}
// 연결 상태는 앱 시작 때 미리 받기(od-warm.js)가 물은 것만 쓴다(홈이 따로 묻지 않음). 미리 받기가 끝나기 전에는 원드라이브 없이 그리고,
// 끝나면('kptu-od-warm') 다시 읽는다. 받아 둔 상태가 없으면(연결 안 됨·30분 지남) 30분에 한 번만 서버에 묻는다.
const OD_ASK_MS = 30 * 60 * 1000;
let odAskedAt = 0;
async function odMonth(k, rt, year, month) {
  const warm = globalThis.window?.KPTUOdWarm;
  if (!k.sources.readDeviceSources().onedrive || !warm?.firstDone) return null;
  let status = k.od.odStatusIfWarm(rt);
  if (!status) {
    if (Date.now() - Math.max(odAskedAt, warm.firstAt || 0) < OD_ASK_MS) return null;
    odAskedAt = Date.now(); status = k.od.odStatusCached(rt);
  }
  const st = await status;
  if (!st?.connected || !st?.folder) return null;
  return kept(`od:${k.diary.ownerScope(rt)}:${year}-${month}`, () => k.od.odPhotos(rt, year, month));
}
// → {items, starred:Set<'source:key'>}. 한 출처를 못 읽어도 나머지는 보인다.
export async function readDayPhotos(day, rt) {
  const k = await kit();
  const year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7)) - 1;
  const [row, od, phone, stars] = await Promise.all([
    k.diary.readDiaryDay(day, rt).catch(() => null),
    odMonth(k, rt, year, month).catch(() => null),
    phoneDay(k, day).catch(() => []),
    kept(`star:${k.diary.ownerScope(rt)}:${year}-${month}`, () => k.od.readStars(year, month, rt)).catch(() => []),
  ]);
  const items = k.od.dayItems(day, row, od).concat(k.time.phoneDayItems(phone || [], day, od?.days?.[day] || []));
  return {items, starred:new Set(stars.map(s => k.od.starKey(s.source, s.item_key))), partial:phone === null};
}
function thumbOf(k, item, rt) {
  const opts = {label:'', link:false, rt};
  if (item.kind === 'od') return k.od.odPhotoElement(item, 'small', opts);
  if (item.kind === 'phone') return k.phone.phonePhotos().element(item, 'small', opts);
  return k.diary.photoElement(item.row, item.file, 'small', opts);
}

// host: 세 칸이 들어갈 자리. onOpenDay(day): 그날 사진 보기(일기). onWrite(day, text, id): 일기 쓰기 열기.
export function mountDayFill(host, {rt = window.KPTURuntime, owner = () => '', onOpenDay = () => {}, onWrite = () => {}, readPhotos = readDayPhotos} = {}) {
  host.innerHTML = '<section class="journal-group journal-photos" data-journal-photos hidden></section>'
    + '<section class="journal-group journal-reads" data-journal-reads hidden></section>'
    + '<section class="journal-group journal-suggests" data-journal-suggests hidden></section>';
  host.hidden = true;
  const photosHost = host.querySelector('[data-journal-photos]'), readsHost = host.querySelector('[data-journal-reads]'), suggestHost = host.querySelector('[data-journal-suggests]');
  const photoReads = new Map(); // `${owner}:${day}` → {state:'loading'|'ok'|'failed', items, at}
  let last = null, k = null, drawnWidth = -1;

  function rankedFor(day, events) {
    const read = photoReads.get(`${owner()}:${day}`);
    if (read?.state !== 'ok') return [];
    return rankDayPhotos(read.items, {starred:item => read.starred.has(`${item.source}:${item.key}`), windows:eventWindows(events)});
  }
  const busy = new Map(); // 지금 읽고 있는 날 → 그사이 다시 읽어야 할 일이 생겼는지
  function ensurePhotos(day, {force = false} = {}) {
    const key = `${owner()}:${day}`, read = photoReads.get(key);
    if (busy.has(key)) { if (force) busy.set(key, true); return; }
    if (!onHome()) return; // 홈이 아닐 때는 읽지 않는다(돌아와 그릴 때 읽음)
    if (!force && read && Date.now() - read.at < PHOTO_FRESH_MS) return;
    busy.set(key, false);
    Promise.all([readPhotos(day, rt), kit()]).then(([out, loaded]) => {
      k = loaded;
      photoReads.set(key, {state:'ok', items:out.items, starred:out.starred, at:out.partial ? 0 : Date.now()});
    }, () => { if (read?.state !== 'ok') photoReads.set(key, {state:'failed', items:[], starred:new Set(), at:Date.now()}); })
      .then(() => {
        const again = busy.get(key); busy.delete(key);
        if (last && `${owner()}:${last.day}` === key) draw();
        if (again) ensurePhotos(day, {force:true});
      });
  }
  function drawPhotos() {
    const {day, today, events} = last, list = k ? rankedFor(day, events) : [];
    if (!list.length) { photosHost.hidden = true; photosHost.replaceChildren(); drawnWidth = -1; return; }
    photosHost.hidden = false;
    const label = day === today ? '오늘 사진' : '그날 사진';
    photosHost.innerHTML = `<div class="journal-schedule-head"><span class="journal-head-name"><h4 class="journal-heading">${label}</h4><small class="journal-head-count" data-journal-photos-count>${list.length}</small></span><button type="button" class="row-act" data-journal-photos-open aria-label="${label} 보기">사진 보기 ›</button></div>`;
    const strip = document.createElement('div');
    strip.className = 'journal-photo-strip'; strip.dataset.journalPhotoStrip = '';
    strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', `${label} ${list.length}장`);
    photosHost.append(strip);
    drawnWidth = strip.clientWidth;
    const fit = stripFit(drawnWidth, list.length, {cell:CELL_PX, gap:GAP_PX});
    list.slice(0, fit.shown).forEach((item, i) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'act-photo-thumb journal-photo-cell'; button.dataset.journalPhoto = String(i); button.dataset.journalPhotoKey = item.key || '';
      button.setAttribute('aria-label', `${label} ${i + 1} — 사진 보기`);
      button.append(thumbOf(k, item, rt));
      strip.append(button);
    });
    if (fit.more) {
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'act-photo-thumb journal-photo-cell journal-photo-more'; more.dataset.journalPhotoMore = '';
      more.dataset.ext = `+${fit.more}`; more.setAttribute('aria-label', `사진 ${fit.more}장 더 — 사진 보기`);
      strip.append(more);
    }
  }
  function drawReads() {
    const {day, today, reads} = last, list = day === today ? cleanReads(reads?.items) : [];
    if (!list.length) { readsHost.hidden = true; readsHost.replaceChildren(); return; }
    readsHost.hidden = false;
    const note = pickedNote(reads?.picked_at, today);
    const row = item => `<li class="journal-read" data-journal-read="${esc(item.id)}"><b class="journal-read-title">${esc(item.title)}</b>`
      + `<span class="journal-read-line">무슨 일: ${esc(item.what)}</span><span class="journal-read-line">왜: ${esc(item.why)}</span>`
      + `<small class="journal-read-meta">${esc([item.source, readAtLabel(item.at, today)].filter(Boolean).join(' · '))}${item.url ? ` <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" data-journal-read-link>원문 ›</a>` : ''}</small></li>`;
    const open = list.slice(0, READS_OPEN), rest = list.slice(READS_OPEN);
    readsHost.innerHTML = `<div class="journal-schedule-head"><span class="journal-head-name"><h4 class="journal-heading">읽을 만한 글</h4><small class="journal-head-count">${list.length}</small></span>${note ? `<small class="journal-fill-note">${note}</small>` : ''}</div>`
      + `<ul class="journal-reads-list">${open.map(row).join('')}</ul>`
      + (rest.length ? `<details class="journal-fill-more" data-journal-reads-more><summary>${rest.length}개 더</summary><ul class="journal-reads-list">${rest.map(row).join('')}</ul></details>` : '');
  }
  function drawSuggests() {
    const {day, today, hour, suggests} = last, list = suggestTime({day, today, hour}) ? cleanSuggests(suggests?.items) : [];
    if (!list.length) { suggestHost.hidden = true; suggestHost.replaceChildren(); return; }
    suggestHost.hidden = false;
    suggestHost.innerHTML = '<div class="journal-schedule-head"><span class="journal-head-name"><h4 class="journal-heading">이런 기록은 어때요?</h4></span></div>'
      + `<ul class="journal-suggest-list">${list.map(item => `<li class="journal-suggest" data-journal-suggest="${esc(item.id)}"><span class="journal-suggest-text"><span>${esc(item.text)}</span>${item.basis ? `<small class="journal-suggest-basis">${esc(item.basis)}</small>` : ''}</span>`
        + `<button type="button" class="secondary" data-journal-suggest-write="${esc(item.id)}">일기 쓰기</button></li>`).join('')}</ul>`;
  }
  function draw() {
    if (!last) return;
    if (last.hidden) { host.hidden = true; return; }
    drawPhotos(); drawReads(); drawSuggests();
    host.hidden = photosHost.hidden && readsHost.hidden && suggestHost.hidden;
  }
  host.addEventListener('click', event => {
    if (!last) return;
    if (event.target.closest('[data-journal-photos-open],[data-journal-photo],[data-journal-photo-more]')) { onOpenDay(last.day); return; }
    const write = event.target.closest('[data-journal-suggest-write]');
    if (write) {
      const item = cleanSuggests(last.suggests?.items).find(x => x.id === write.dataset.journalSuggestWrite);
      if (item) onWrite(last.day, item.text, item.id);
    }
  });
  // 원드라이브 미리 받기가 끝나면 받아 둔 연결 상태로 그날 사진을 다시 읽는다.
  globalThis.window?.addEventListener?.('kptu-od-warm', () => {
    for (const read of photoReads.values()) read.at = 0;
    if (last && !last.hidden) ensurePhotos(last.day, {force:true});
  });
  // 폭이 바뀌면(폴드 펼치기·창 크기) 사진 칸 수만 다시 맞춘다.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
    const strip = photosHost.querySelector('[data-journal-photo-strip]');
    if (strip && strip.clientWidth !== drawnWidth) drawPhotos();
  }).observe(host);
  return {
    // state: {day, today, hour, events, reads:{items, picked_at}|null, suggests:{items}|null, hidden}
    render(state) {
      last = {...state};
      if (!state.hidden) ensurePhotos(state.day);
      draw();
    },
    forget() { photoReads.clear(); },
  };
}
