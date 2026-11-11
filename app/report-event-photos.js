// CAL-일정첨부 요청 6번 '사업 보고로 넘기기'(S59-23, 시안 docs/design/mockups/event-attach.html ③, 설계 docs/design/event-attach.md 5절):
// 일정에서 연 사업 보고 쓰기 창(일정 창 [결과 남기기]·사업 보고 달력 [보고 쓰기]) 사진 칸 아래 한 줄 '일정에 붙인 사진 n · 넣으려면 누르기'.
// - 그 일정의 첨부 중 사진만 작은 칸으로 보인다(작은 그림은 일정 창과 같은 서버 file-photo — event-files.js eventPhotoUrl).
//   처음엔 모두 안 고른 상태(일정에 붙인 것은 참고 그림이 대부분이라 저절로 섞이지 않게). 누르면 넣기·빼기(aria-pressed). 서버에는 아무것도 가지 않는다.
// - [저장]하면 쓰기 창이 먼저 닫힌 뒤(BIZ-저장먼저닫기) 고른 사진만 서버 document-actions link-event-photo로 하나씩 그 사업 보고에 잇는다
//   — 같은 Drive 원본을 가리키는 자료 행(올리기·복사 없음). 못 넣은 사진은 하단바 위 한 줄(공용 announceDock), 거절이면 [다시 넣기].
// - 목록·그림·고른 것은 이 창 메모리에만(기기 저장 없음). 옛 서버(일정에 files 칸 없음)·사진이 없는 일정·일정에서 열지 않은 창이면 줄을 두지 않는다.
// - '그 시각 사진 미리 고르기'(time-photos.js, BIZ-보고할일정 ⑤)는 그대로 — 이 줄은 그 아래 따로 있다. 모양은 그 줄의 공용 칸(.tp-item)을 그대로 쓴다.
import {eventPhotoUrl, isEventPhoto, cleanFiles} from './event-files.js';
import {slotBox, slotImg, slotFailed} from './img-slot.js';
import {announceDock} from './upload-progress.js';
import {loadDocumentCategories, documentCategories} from './document-categories.js';
import {eventPhotoHead, eventPhotoNote, linkBody, linkOutcome, linkFailNotice} from './report-event-photos-model.mjs';

const userOf = rt => rt?.context?.read?.()?.user?.id || '';

// 넣는 중이면 새로 고치기 전에 묻는다(쓰기 창의 다른 뒤 일과 같은 알림 — kptu:before-reload).
let pending = 0;
if (typeof window !== 'undefined') window.addEventListener('kptu:before-reload', e => { if (pending > 0 && e?.detail) e.detail.otherDraft = true; });

// 그 일정의 첨부 목록(서버 google-calendar action=event — 일정 창이 쓰는 같은 읽기). 서버가 files 칸을 주지 않으면(옛 서버) null.
async function readEventFiles(rt, ev) {
  const u = new URL(rt.config.url + '/functions/v1/google-calendar');
  u.searchParams.set('action', 'event'); u.searchParams.set('eventId', ev.id); u.searchParams.set('calendarId', ev.calendarId);
  const d = await rt.api(u.toString(), {singleFlight: false});
  return Array.isArray(d?.event?.files) ? cleanFiles(d.event.files) : null;
}

// host 안에 한 줄. busy() = 저장 중이면 참(누르기 막음). reset(event|null)로 창을 열 때마다 다시 맞춘다. chosen() = 지금 고른 사진.
export function mountEventPhotoPick(host, {busy = () => false, rt = () => window.KPTURuntime} = {}) {
  if (!host) return {reset() {}, chosen: () => []};
  host.classList.add('tp', 'tp-preset', 'ev-pick');
  host.hidden = true;
  host.innerHTML = '<div class="tp-line"><span class="tp-head" data-ev-head></span><span class="tp-note" data-ev-note></span></div><div class="tp-strip" data-ev-strip role="group" aria-label="일정에 붙인 사진 선택"></div>';
  const strip = host.querySelector('[data-ev-strip]');
  let run = 0, event = null, photos = [], picked = new Set();
  const paintHead = () => {
    host.querySelector('[data-ev-head]').textContent = eventPhotoHead(photos.length);
    host.querySelector('[data-ev-note]').textContent = '· ' + eventPhotoNote(picked.size);
  };
  function paintThumb(button, f) {
    const ev = event, box = button.querySelector('.ev-pick-img');
    slotBox(box);
    const again = () => { box.replaceChildren(); paintThumb(button, f); };
    eventPhotoUrl(ev.calendarId, ev.id, f.drive_file_id, 'small', {rt: rt()}).then(url => {
      if (!box.isConnected || event !== ev) return;
      const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.draggable = false;
      box.replaceChildren();
      slotImg(box, img, url, {retry: again});
    }, () => { if (box.isConnected) slotFailed(box, again, 'photo'); });
  }
  function paint() {
    strip.replaceChildren(...photos.map((f, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tp-item'; b.dataset.evItem = f.drive_file_id;
      b.setAttribute('aria-pressed', String(picked.has(f.drive_file_id)));
      b.setAttribute('aria-label', `일정에 붙인 사진 ${i + 1}: ${f.file_name}`);
      b.title = f.file_name;
      b.innerHTML = '<span class="ev-pick-img"></span>';
      return b;
    }));
    paintHead();
    for (const b of strip.children) paintThumb(b, photos.find(f => f.drive_file_id === b.dataset.evItem));
  }
  host.addEventListener('click', e => {
    const b = e.target.closest?.('[data-ev-item]');
    if (!b || !host.contains(b) || busy()) return;
    const id = b.dataset.evItem;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    b.setAttribute('aria-pressed', String(picked.has(id)));
    paintHead();
  });
  async function reset(next) {
    const mine = ++run;
    event = next?.id ? {id: String(next.id), calendarId: String(next.calendarId || 'primary')} : null;
    photos = []; picked = new Set(); host.hidden = true; strip.replaceChildren();
    if (!event) return;
    let files = null;
    try { files = await readEventFiles(rt(), event); } catch (e) { console.warn('event photos read failed', e?.status || e?.name || 'Error'); }
    if (mine !== run || !files) return;
    photos = files.filter(isEventPhoto);
    if (!photos.length) return;
    paint();
    host.hidden = false;
  }
  return {
    reset,
    chosen: () => (event && !host.hidden ? photos.filter(f => picked.has(f.drive_file_id)).map(f => ({...f, calendarId: event.calendarId, eventId: event.id})) : []),
  };
}

// 창이 닫힌 뒤: 고른 사진을 그 사업 보고에 하나씩 잇는다. target = {id, kind, day}(새 사업 보고). 계정이 바뀌면 멈춘다.
// 다 되면 자료 목록을 다시 읽게 알린다(kptu:documents-changed). 못 넣은 것이 있으면 한 줄 + 거절이면 [다시 넣기](그 사진만).
export async function linkEventPhotos(target, picks, {rt = window.KPTURuntime} = {}) {
  const list = Array.isArray(picks) ? picks.filter(Boolean) : [];
  if (!target?.id || !list.length || !rt) return {linked: 0, failed: [], unknown: 0};
  const who = userOf(rt);
  pending++;
  let linked = 0, unknown = 0, message = '';
  const failed = [];
  try {
    let categories = documentCategories();
    try { categories = await loadDocumentCategories({rt}); } catch { /* 기본 종류로 */ }
    for (const pick of list) {
      if (!who || userOf(rt) !== who) return {linked, failed, unknown};
      let error = null;
      try { await rt.api('/functions/v1/document-actions', {method: 'POST', body: linkBody(pick, target, categories), refreshSession: false, singleFlight: false}); }
      catch (e) { error = e || new Error('failed'); console.warn('event photo link failed', e?.status || e?.name || 'Error'); }
      const out = linkOutcome(error);
      if (out === 'linked') linked++;
      else if (out === 'unknown') unknown++;
      else { failed.push(pick); message = message || String(error?.message || ''); }
    }
  } finally { pending--; }
  if (linked || unknown) window.dispatchEvent(new CustomEvent('kptu:documents-changed', {detail: {project_id: null, meeting_id: target.id}}));
  const notice = linkFailNotice(failed.length, unknown, message);
  if (notice) announceDock({text: notice.text, note: notice.note, error: true, ms: 0,
    actions: notice.retry && failed.length ? [{label: '다시 넣기', aria: '못 넣은 일정 사진 다시 넣기', run: () => void linkEventPhotos(target, failed, {rt})}] : []});
  return {linked, failed, unknown};
}
