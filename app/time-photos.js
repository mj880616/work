// S46-20 사진 정리 ⑥(명진 11/01 01:04 추천대로): 사업 보고 쓰기·상세 창 사진 줄 안 한 줄 '그 시각 사진 [골라 붙이기]'.
// - 누르면 그 보고 시각 앞뒤 3시간에 찍은 폰·원드라이브 사진을 작은 칸 한 줄로 보인다(시각만으로 추천, 위치는 쓰지 않음).
//   폰 사진은 앱 다리(phone-photos.js, 폰 안에서만 읽음), 원드라이브 사진은 일기·사진 메뉴와 같은 목록·그림(diary-onedrive.js).
// - 칸을 눌러 고르고 [붙이기 n]을 누르면 고른 사진만 파일로 만들어 부르는 쪽(onPick)에 넘긴다. 부르는 쪽은 기존 사진 첨부와 같은 길
//   (새 보고 = 저장할 때 차례로 올림, 상세 = 바로 올림 — 둘 다 library-upload.js uploadFileForMeeting, Drive 첨부 app_documents.meeting_id)을 쓴다.
//   고르지 않은 사진은 어디에도 올리지 않고, 목록·그림·고른 것은 이 창 메모리에만 있다(기기·서버 저장 없음).
// - 출처는 사진 메뉴 출처 켜기/끄기(view_prefs.photo_sources)와 끈 폰 폴더(view_prefs.phone_folders_off)를 따른다. 쓸 출처가 없으면 줄을 그리지 않는다.
import {phonePhotos} from './phone-photos.js';
import {odStatusCached, odStatusIfWarm, odPhotos, odPhotoElement, odMediaUrl, odPhotoBlob, odErrorText} from './diary-onedrive.js';
import {parseSources, phoneErrorText} from './photo-sources-model.mjs';
import {parsePhoneOff} from './phone-folders-model.mjs';
import {viewPrefs} from './view-prefs.js';
import {waitInlineHtml} from './wait-state.js';
import {reportAtMs, nearWindow, windowMonths, odMonthItems, nearPhotos, attachName, nearHead, pickLabel, PICK_MAX} from './time-photos-model.mjs';
import {isPhotoFile} from './activity-photo-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const PHONE_READ = 200;

// 쓸 수 있는 출처: 폰(앱 안·사진 접근 허용·출처 켜짐), 원드라이브(연결·폴더·출처 켜짐).
// quiet: 서버에 묻지 않는다(원드라이브는 받아 둔 연결 상태만 본다). 줄을 보일지 정할 때 쓰고, [골라 붙이기]를 누르면 다시 확인한다.
export async function timePhotoSources({rt = globalThis.window?.KPTURuntime, phone = phonePhotos(), quiet = false} = {}) {
  const on = parseSources(viewPrefs.get('photo_sources'));
  const out = {phone:false, onedrive:false};
  const jobs = [];
  if (on.phone && phone.usable) jobs.push(phone.hello().then(s => { out.phone = s.access !== 'none' && !!s.key; }, () => {}));
  if (on.onedrive && rt) jobs.push(Promise.resolve(quiet ? odStatusIfWarm(rt) : odStatusCached(rt)).then(s => { out.onedrive = !!(s?.connected && s?.folder); }, () => {}));
  await Promise.all(jobs);
  return out;
}

// 폰: 그 시각 창 안에서 찍은 것(찍은 날 최근 먼저로 창 끝부터 읽는다). 끈 폰 폴더는 빼고 읽는다.
async function phoneNear(phone, win) {
  const hide = [...parsePhoneOff(viewPrefs.get('phone_folders_off'))];
  const page = await phone.page({sort:'taken_desc', filter:'all', before:win.to + 1, limit:PHONE_READ, hide});
  return page.items.filter(it => Date.parse(it.taken_at) >= win.from);
}
async function odNear(rt, win) {
  const out = [];
  for (const key of windowMonths(win)) {
    const [y, m] = key.split('-').map(Number);
    out.push(...odMonthItems(await odPhotos(rt, y, m - 1)));
  }
  return out;
}

// 고른 사진 → 파일. 폰은 원본(앱이 폰 안에서 답함), 원드라이브는 원본 받기 주소, 막히면 큰 그림(서버가 넘기는 바이트).
async function phoneFile(phone, item) {
  let blob = null;
  try { const r = await fetch(phone.mediaUrl(item), {cache:'no-store', credentials:'omit'}); if (r.ok) blob = await r.blob(); } catch { blob = null; }
  if (!blob || !/^image\//.test(blob.type || '')) blob = await phone.blob(item, 'large');
  return new File([blob], attachName(item.name, blob.type), {type:blob.type || 'image/jpeg'});
}
async function odFile(rt, item) {
  let blob = null;
  try {
    const m = await odMediaUrl(rt, item.id, 'download');
    const r = await fetch(m.url, {mode:'cors', credentials:'omit', referrerPolicy:'no-referrer'});
    if (r.ok) blob = await r.blob();
  } catch { blob = null; }
  if (!blob || !/^image\//.test(blob.type || '')) blob = await odPhotoBlob(rt, item.id, 'large');
  if (!blob) throw new Error('onedrive_media_unavailable');
  return new File([blob], attachName(item.name, blob.type), {type:blob.type || 'image/jpeg'});
}

// host 안에 한 줄을 그린다. at() = 보고 시각('YYYY-MM-DDTHH:MM' 서울 또는 ISO), onPick(files) = 붙이기(Promise 가능),
// busy() = 저장·올리는 중이면 참, allowed() = 지금 이 줄을 보여도 되는가(고칠 수 있는 보고), quiet = 창을 열 때 서버에 묻지 않기. 돌려준 함수로 다시 맞춘다(창을 다시 열 때 접기·고른 것 비우기).
export function mountTimePhotos(host, {at, onPick, busy = () => false, allowed = () => true, quiet = false, rt = globalThis.window?.KPTURuntime, phone = phonePhotos()} = {}) {
  if (!host) return () => {};
  let run = 0, items = [], picked = new Set(), open = false, src = {phone:false, onedrive:false}, attaching = false;
  host.classList.add('tp');
  host.hidden = true;
  host.innerHTML = `<div class="tp-line"><span class="tp-head" data-tp-head>그 시각 사진</span><button type="button" class="mini tp-open" data-tp-open aria-expanded="false">골라 붙이기</button></div>
<div class="tp-pick" data-tp-pick hidden><div class="tp-strip" data-tp-strip role="group" aria-label="그 시각 사진 고르기"></div><div class="tp-foot"><span class="tp-note" data-tp-note role="status" aria-live="polite"></span><button type="button" class="mini" data-tp-close>닫기</button><button type="button" class="mini tp-attach" data-tp-attach disabled>붙이기</button></div></div>`;
  const $ = s => host.querySelector(s);
  const note = t => { $('[data-tp-note]').textContent = t || ''; };
  const paintFoot = () => {
    const b = $('[data-tp-attach]');
    b.textContent = pickLabel(picked.size);
    b.disabled = attaching || !picked.size || busy();
  };
  const setOpen = on => {
    open = on;
    $('[data-tp-pick]').hidden = !on;
    $('[data-tp-open]').setAttribute('aria-expanded', String(on));
    if (!on) { picked = new Set(); items = []; $('[data-tp-strip]').replaceChildren(); $('[data-tp-head]').textContent = '그 시각 사진'; }
  };
  const element = it => (it.kind === 'phone' ? phone.element(it, 'small', {label:''}) : odPhotoElement(it, 'small', {label:'', rt, retry:true}));
  function paintStrip() {
    const strip = $('[data-tp-strip]');
    strip.replaceChildren(...items.map((it, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tp-item'; b.dataset.tpItem = it.id;
      b.setAttribute('aria-pressed', String(picked.has(it.id)));
      const hhmm = new Date(Date.parse(it.taken_at) + 9 * 3600 * 1000).toISOString().slice(11, 16);
      b.setAttribute('aria-label', `사진 ${i + 1} ${hhmm}${it.kind === 'phone' ? ' 폰' : ' 원드라이브'}`);
      b.append(element(it));
      const t = document.createElement('span'); t.className = 'tp-time'; t.setAttribute('aria-hidden', 'true'); t.textContent = hhmm;
      b.append(t);
      return b;
    }));
    paintFoot();
  }
  async function load() {
    const mine = ++run, atMs = reportAtMs(at?.());
    picked = new Set(); items = [];
    $('[data-tp-strip]').replaceChildren(); paintFoot();
    if (!Number.isFinite(atMs)) { $('[data-tp-head]').textContent = '그 시각 사진'; note('일시를 먼저 넣어 주세요'); return; }
    note(''); $('[data-tp-strip]').innerHTML = waitInlineHtml();
    // 누른 때 출처를 다시 확인한다(조용히 정한 줄이면 원드라이브 연결을 이때 서버에 묻는다).
    try { src = await timePhotoSources({rt, phone}); } catch { /* 이전 값 그대로 */ }
    if (mine !== run || !open) return;
    const win = nearWindow(atMs), fails = [];
    const [ph, od] = await Promise.all([
      src.phone ? phoneNear(phone, win).catch(e => { fails.push(phoneErrorText(e)); return []; }) : [],
      src.onedrive ? odNear(rt, win).catch(e => { fails.push(`원드라이브 사진을 읽지 못했어요: ${odErrorText(e)}`); return []; }) : [],
    ]);
    if (mine !== run || !open) return;
    items = nearPhotos({phone:ph, od, atMs});
    $('[data-tp-head]').textContent = nearHead(items.length);
    paintStrip();
    note(fails.join(' · '));
  }
  async function attach() {
    if (attaching || !picked.size || busy()) return;
    const chosen = items.filter(it => picked.has(it.id));
    attaching = true; paintFoot();
    const files = []; let failed = 0;
    try {
      for (const [i, it] of chosen.entries()) {
        note(`사진 준비 중 ${i + 1}/${chosen.length}`);
        try {
          const f = it.kind === 'phone' ? await phoneFile(phone, it) : await odFile(rt, it);
          if (isPhotoFile(f)) files.push(f); else failed++;
        } catch (error) { failed++; console.warn('time photo read failed', it.kind, error?.message || error); }
      }
      if (files.length) await onPick?.(files);
      const fail = failed ? `${failed}장은 읽지 못했어요` : '';
      if (files.length) { setOpen(false); note(''); host.querySelector('[data-tp-open]')?.focus({preventScroll:true}); }
      if (!files.length || failed) { if (!open) setOpen(true); note(files.length ? `${files.length}장 붙였어요 · ${fail}` : (fail || '붙이지 못했어요')); }
    } finally { attaching = false; paintFoot(); }
  }
  host.addEventListener('click', e => {
    const t = e.target.closest?.('button');
    if (!t || !host.contains(t)) return;
    if (t.matches('[data-tp-open]')) { if (open) { setOpen(false); note(''); return; } setOpen(true); void load(); return; }
    if (t.matches('[data-tp-close]')) { run++; setOpen(false); note(''); t.closest('.tp')?.querySelector('[data-tp-open]')?.focus({preventScroll:true}); return; }
    if (t.matches('[data-tp-attach]')) { void attach(); return; }
    if (t.matches('[data-tp-item]')) {
      const id = t.dataset.tpItem;
      if (picked.has(id)) picked.delete(id);
      else if (picked.size >= PICK_MAX) { note(`한 번에 ${PICK_MAX}장까지 붙여요`); return; }
      else picked.add(id);
      t.setAttribute('aria-pressed', String(picked.has(id)));
      paintFoot();
    }
  });
  // 다시 맞추기: 창을 새로 열 때·일시가 바뀔 때. 출처를 다시 확인하고 접는다.
  async function reset() {
    const mine = ++run;
    setOpen(false); note('');
    try { src = await timePhotoSources({rt, phone, quiet}); } catch { src = {phone:false, onedrive:false}; }
    if (mine !== run) return;
    host.hidden = !allowed() || !(src.phone || src.onedrive);
  }
  void reset();
  return reset;
}
