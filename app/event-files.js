// CAL-일정첨부(요청함 11/11 11:11, 시안 docs/design/mockups/event-attach.html ①②, 설계 docs/design/event-attach.md):
// 일정 창 [메모] 아래 [사진·파일] 칸. 사진은 작은 그림(누르면 크게 보기), 다른 파일은 이름 한 줄, 줄 끝 ⋯
// = 크게 보기·열기 / 내려받기 / 이름 수정 / 빼기 / 삭제. 아래 [+ 붙이기](폰: 사진 고르기·찍기·파일, PC: 끌어 놓기·붙여넣기도).
// - 원본: Drive '자료실 › 일정 첨부' + Google 캘린더 첨부(서버 google-calendar attach-file). Web2 표·기기 저장 없음(파일은 탭 메모리만).
// - 고른 파일은 [변경사항 저장]·새 일정 [저장]으로 일정이 저장된 뒤, 창이 닫히고 뒤에서 하나씩 올라간다(UX-먼저묻고뒤에처리·BIZ-저장먼저닫기).
//   줄 세우기는 공용 createAttachQueue(노트·업데이트 첨부와 같은 부품), 올리는 중 표시·끝 알림·[다시 올리기]는 공용 upload-progress.js.
//   일정마다 줄 하나(같은 일정의 첨부 쓰기는 한 번에 하나 — 서버도 읽은 판일 때만 씀).
// - 고르는 칸은 할 일 첨부의 공용 부품(task-files.js mountNewTaskFilePick: 고르기·끌어 놓기·붙여넣기·× 빼기) 그대로.
// - ⋯ 의 [이름 수정]은 공용 file-rename.js(target 'event'), [삭제]는 공용 file-trash.js(target 'event'), 열기·내려받기는 file-actions.js.
// - 같이 쓰는 캘린더도 자동 공유 없음(Drive 공유 설정을 건드리지 않음). 일정을 지워도 Drive 파일은 남는다.
import {createAttachQueue} from './basket-upload.js';
import {trackUpload, mountUploadRows, announceDock, setUploadRetry} from './upload-progress.js';
import {sendUploadApi} from './upload-send.mjs';
import {uploadTimeoutMs} from './upload-budget.mjs';
import {mountNewTaskFilePick} from './task-files.js';
import {rowMore} from './row-more.js';
import {openInDrive, downloadFile, driveFileUrl} from './file-actions.js';
import {deleteAttachment} from './file-trash.js';
import {renameHostAttrs, eventSpecId, applyRenamed} from './file-rename.js';
import {holdToast} from './small-notice.js';
import {slotBox, slotImg, slotFailed} from './img-slot.js'; // 작은 그림 칸은 공용 칸(회색 칸·못 받으면 ↻)

export const MAX_EVENT_FILES = 25;
const PHOTO = /^image\/(jpeg|png|webp|gif)$/i;
const FILE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const FILE_ICON = '<svg class="ci-file-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 1.5h5l3 3v10H4z M9 1.5v3h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
export const isEventPhoto = f => PHOTO.test(String(f?.mime_type || '')) || (!f?.mime_type && /\.(jpe?g|png|webp|gif)$/i.test(String(f?.file_name || '')));
const lineKey = (calendarId, eventId) => `event:${calendarId || 'primary'}:${eventId}`;
const scopeOf = rt => { const c = rt?.context?.read?.(); return c?.user?.id ? `${c.user.id}:${c.workspace?.id || ''}` : ''; };
const words = list => { const photos = list.filter(f => /^image\//.test(f?.type || '')).length, files = list.length - photos; return [photos ? `사진 ${photos}장` : '', files ? `파일 ${files}개` : ''].filter(Boolean).join('·'); };
function toast(text) { const t = document.querySelector('#toast'); if (!t) return; t.textContent = text; holdToast(t); }

// 서버가 새 모양(일정마다 files 칸)을 답하는가. 옛 서버면 칸을 두지 않는다(배포 순서: Edge 먼저, 화면 나중).
export const eventFilesReady = (event = null) => event ? Array.isArray(event.files) : (globalThis.window?.__KPTU_GOOGLE_EVENTS__ || []).some(e => Array.isArray(e?.files));
// 서버 답의 첨부 목록(세 칸)만 받는다.
export function cleanFiles(list) {
  return (Array.isArray(list) ? list : []).filter(f => f && FILE_ID.test(String(f.drive_file_id || ''))).map(f => ({drive_file_id: f.drive_file_id, file_name: String(f.file_name || '파일'), mime_type: String(f.mime_type || '')}));
}

// ---- 작은 그림·크게 보기(메모리만, 로그인한 사람이 바뀌면 비움) ----
const photoFlights = new Map(), photoReady = new Map();
let photoScope = '';
export function clearEventPhotoCache() {
  for (const flight of photoFlights.values()) flight.then(url => URL.revokeObjectURL(url), () => {});
  photoFlights.clear(); photoReady.clear();
}
export function eventPhotoUrl(calendarId, eventId, fileId, size = 'small', {rt = window.KPTURuntime, fetcher = globalThis.fetch} = {}) {
  if (!FILE_ID.test(String(fileId || '')) || !eventId || !['small', 'large'].includes(size)) return Promise.reject(new Error('photo_request'));
  const scope = scopeOf(rt);
  if (scope && scope !== photoScope) { if (photoScope) clearEventPhotoCache(); photoScope = scope; }
  const key = `${calendarId}:${eventId}:${fileId}:${size}`;
  if (photoFlights.has(key)) return photoFlights.get(key);
  const flight = (async () => {
    if (!(await rt.session.ensure())) throw new Error('session');
    const token = rt.session.read()?.access_token;
    if (!token) throw new Error('session');
    const q = new URLSearchParams({action: 'file-photo', calendarId: calendarId || 'primary', eventId, fileId, size});
    const r = await fetcher(`${rt.config.url}/functions/v1/google-calendar?${q}`, {headers: {apikey: rt.config.key, Authorization: 'Bearer ' + token}});
    if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) throw new Error('photo');
    const url = URL.createObjectURL(await r.blob());
    photoReady.set(key, url);
    return url;
  })();
  photoFlights.set(key, flight);
  flight.catch(() => { if (photoFlights.get(key) === flight) photoFlights.delete(key); });
  return flight;
}

// ---- 서버 부르기 ----
const call = (rt, body) => rt.api('/functions/v1/google-calendar', {method: 'POST', body, refreshSession: false, singleFlight: false});
export async function detachEventFile(event, fileId, {rt = window.KPTURuntime} = {}) {
  const d = await call(rt, {action: 'detach-file', calendar_id: event.calendarId || 'primary', event_id: event.id, drive_file_id: fileId});
  if (d?.ok !== true) throw new Error('뺐는지 확인하지 못했어요.');
  return cleanFiles(d.files);
}
// 파일 하나 올리기(올리는 중 표시 job은 부른 쪽이 만든다).
export async function attachEventFile(calendarId, eventId, file, {rt = window.KPTURuntime, job}) {
  const fd = new FormData();
  try {
    const copy = await rt.copyUploadFile(file);
    fd.append('calendar_id', calendarId || 'primary');
    fd.append('event_id', eventId);
    fd.append('file', copy);
    const data = await sendUploadApi(rt, '/functions/v1/google-calendar?action=attach-file', {body: fd, size: file?.size || 0, job, timeoutMs: uploadTimeoutMs(file?.size)});
    if (data?.ok !== true) throw new Error('붙였는지 확인하지 못했어요.');
    job.done();
    return cleanFiles(data.files);
  } finally { fd.delete('file'); }
}

// ---- 뒤에서 올리기(일정마다 줄 하나) ----
export const eventFileLine = createAttachQueue();
const lineNotes = new Map();
const unknownResult = e => e?.code === 'http_503' && /확인하지 못했/.test(String(e?.message || ''));
/**
 * 일정은 이미 저장됐다. 고른 파일을 그 일정 줄에 세워 뒤에서 하나씩 올린다(창은 부른 곳이 닫는다). 화면을 옮겨도 멈추지 않고,
 * 계정·작업공간이 바뀌면 멈춘다(알리지 않음). 끝나면 하단바 위 한 줄: '일정에 사진 2장 올렸어요' / 못 올렸으면 '… 못 올렸어요' + [다시 올리기](못 올린 것만).
 * 결과를 알 수 없는 실패(이미 붙었을 수 있음)는 저절로 다시 보내지 않는다.
 */
export function sendEventFilesBehind({calendarId, eventId, files, rt = window.KPTURuntime}) {
  const list = [...(files || [])].filter(Boolean);
  if (!eventId || !list.length) return Promise.resolve();
  const key = lineKey(calendarId, eventId), owner = scopeOf(rt), here = () => !!owner && scopeOf(rt) === owner;
  const batch = {entries: list.map(file => ({file, kind: 'waiting'}))};
  lineNotes.get(key)?.close?.(); lineNotes.delete(key);
  const group = {sent: 0}, jobs = new Map(list.map(file => { const job = trackUpload({file, waiting: true, group}); job.scope = key; return [file, job]; }));
  return eventFileLine.add(key, batch, async () => {
    if (!here()) { for (const job of jobs.values()) job.cancel(); return; }
    const sent = [], left = [], unknown = [];
    let reason = '', latest = null;
    for (const entry of batch.entries) {
      const job = jobs.get(entry.file);
      if (!here()) { job.cancel(); continue; }
      if (job.cancelled()) { entry.kind = 'success'; continue; } // ✕로 뺀 파일: 다시 보내지 않는다
      job.start();
      try {
        latest = await attachEventFile(calendarId, eventId, entry.file, {rt, job});
        entry.kind = 'success'; sent.push(entry.file);
      } catch (e) {
        if (e?.code === 'upload_cancelled') { entry.kind = 'success'; continue; }
        reason = String(e?.message || '');
        job.fail(reason);
        if (unknownResult(e)) { entry.kind = 'success'; unknown.push(entry.file); } else left.push(entry.file);
      }
    }
    if (!here()) return;
    globalThis.window?.dispatchEvent?.(new CustomEvent('kptu:event-files-changed', {detail: {calendarId: calendarId || 'primary', eventId, files: latest}}));
    try { await globalThis.window?.__KPTU_RELOAD_GOOGLE_EVENTS__?.(); } catch { /* 목록 다시 읽기 실패는 알림을 막지 않는다 */ }
    const again = () => sendEventFilesBehind({calendarId, eventId, files: left, rt});
    if (left.length) for (const file of left) setUploadRetry(file, again);
    const okText = sent.length ? `${words(sent)} 올렸어요` : '';
    // UX-알림하나로(S59-21): 끝·실패는 이 한 줄 하나 — 일정 창의 올리는 줄은 이 파일들의 '실패'·'✓ 완료'를 따로 그리지 않는다(files).
    let note;
    if (left.length || unknown.length) {
      note = announceDock({text: `일정에 ${words([...left, ...unknown])} 못 올렸어요`, note: [okText, reason].filter(Boolean).join(' · '), error: true, ms: 0, files: list,
        actions: left.length ? [{label: '다시 올리기', aria: '못 올린 파일 다시 올리기', run: again}] : []});
    } else if (sent.length) note = announceDock({text: `일정에 ${okText}`, files: list});
    if (note) lineNotes.set(key, note);
  });
}
// 줄은 메모리뿐이라 새로 고치면 남은 파일이 사라진다: 올리는 동안 [최신화]·당겨서 새로고침은 먼저 묻는다(노트·업데이트 줄과 같음).
globalThis.window?.addEventListener?.('kptu:before-reload', event => { if (event?.detail && eventFileLine.any()) event.detail.otherDraft = true; });

// ---- 일정 창의 칸 ----
// host 안에 '사진·파일' 칸을 그린다. 그리기 주인은 이 칸 하나(목록은 setFiles·show로만 바뀐다).
// 반환: {show(event), hide(), chosen(), clear(), files()}. onChange(files): 빼기·삭제·이름 수정으로 목록이 바뀐 뒤(창 주인이 일정 값에 반영).
export function mountEventFiles(host, {isBusy = () => false, onError = () => {}, onChange = () => {}, rt = () => window.KPTURuntime} = {}) {
  host.classList.add('ci-files');
  host.hidden = true;
  host.innerHTML = '<span class="ci-files-label">사진·파일</span><div class="ci-files-photos" data-ci-photos></div><div class="ci-files-up" data-ci-files-up></div><div class="ci-files-rows" data-ci-file-rows></div><div class="ci-files-pick" data-ci-files-pick></div>';
  const photos = host.querySelector('[data-ci-photos]'), rows = host.querySelector('[data-ci-file-rows]');
  const pick = mountNewTaskFilePick(host.querySelector('[data-ci-files-pick]'), {isBusy, onError, label: '붙이기', hint: '사진 선택 · 찍기 · 파일'});
  let event = null, files = [];
  mountUploadRows(host.querySelector('[data-ci-files-up]'), {has: job => !!event && job.scope === lineKey(event.calendarId, event.id), compact: true});
  const spec = f => ({target: 'event', id: eventSpecId(event.calendarId || 'primary', event.id), driveId: f.drive_file_id, name: f.file_name});
  const set = next => { files = cleanFiles(next); paint(); onChange(files.map(f => ({...f}))); };
  const view = (f, trigger) => {
    if (!isEventPhoto(f)) { openInDrive({driveId: f.drive_file_id}, {onError: toast}); return; }
    const ev = event, list = files.filter(isEventPhoto), at = Math.max(0, list.indexOf(f));
    const itemOf = i => ({file: {name: list[i].file_name, mime: list[i].mime_type, driveId: list[i].drive_file_id}, driveHref: driveFileUrl(list[i].drive_file_id),
      getUrl: () => eventPhotoUrl(ev.calendarId || 'primary', ev.id, list[i].drive_file_id, 'large'),
      preview: async () => photoReady.get(`${ev.calendarId || 'primary'}:${ev.id}:${list[i].drive_file_id}:small`) || ''});
    void import('./photo-view.js').then(({openDocumentPhotoView}) => {
      const first = itemOf(at);
      const shown = openDocumentPhotoView({...first, trigger, nav: list.length > 1 ? {count: list.length, index: at, item: itemOf} : null,
        actions: item => [{label: 'Drive에서 열기', href: item.driveHref}, {label: '내려받기', run: async () => { await downloadFile(item.file, {onError: toast}); return false; }}]});
      if (!shown) openInDrive({driveId: f.drive_file_id}, {onError: toast});
    }).catch(() => openInDrive({driveId: f.drive_file_id}, {onError: toast}));
  };
  const menu = (f, label) => rowMore(document, {label, items: [
    {text: isEventPhoto(f) ? '크게 보기' : '열기', onClick: e => view(f, e.currentTarget)},
    {text: '내려받기', onClick: () => void downloadFile({name: f.file_name, driveId: f.drive_file_id}, {onError: toast})},
    {text: '이름 수정', data: {frMenuEdit: '', frTarget: 'event', frId: spec(f).id, frDrive: f.drive_file_id, frName: f.file_name}},
    {text: '빼기', onClick: () => void detach(f)},
    {text: '삭제', danger: true, onClick: e => void remove(f, e.currentTarget)},
  ]});
  async function detach(f) {
    const ev = event;
    try { const next = await detachEventFile(ev, f.drive_file_id, {rt: rt()}); if (event === ev) set(next); toast('일정에서 뺐어요. Drive에는 남아 있어요.'); }
    catch (e) { onError(Number(e?.status) === 404 ? '' : (e?.message || '빼지 못했어요. 다시 시도해 주세요.')); if (Number(e?.status) === 404 && event === ev) set(files.filter(x => x.drive_file_id !== f.drive_file_id)); }
    void globalThis.window?.__KPTU_RELOAD_GOOGLE_EVENTS__?.()?.catch?.(() => {});
  }
  async function remove(f, anchor) {
    const ev = event;
    const r = await deleteAttachment(spec(f), {rt: rt(), anchor, toast, onChanged: changed => { if (event === ev && Array.isArray(changed?.event)) set(changed.event); }});
    if (r.status === 'failed') onError(r.message);
    void globalThis.window?.__KPTU_RELOAD_GOOGLE_EVENTS__?.()?.catch?.(() => {});
  }
  function paintThumb(tile, f) {
    const ev = event, box = tile.querySelector('.ci-photo-img'), key = `${ev.calendarId || 'primary'}:${ev.id}:${f.drive_file_id}:small`;
    slotBox(box);
    const again = () => { box.replaceChildren(); paintThumb(tile, f); };
    const show = url => {
      if (!box.isConnected || event !== ev) return;
      const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.draggable = false;
      box.replaceChildren(); box.dataset.state = 'shown';
      slotImg(box, img, url, {retry: again, onFailed: () => { box.dataset.state = 'failed'; }});
    };
    const cached = photoReady.get(key);
    if (cached) { show(cached); return; }
    box.dataset.state = 'loading';
    eventPhotoUrl(ev.calendarId || 'primary', ev.id, f.drive_file_id, 'small', {rt: rt()}).then(show, () => { if (!box.isConnected) return; box.dataset.state = 'failed'; slotFailed(box, again, 'photo'); });
  }
  function paint() {
    photos.replaceChildren(); rows.replaceChildren();
    if (!event) return;
    for (const f of files) {
      const label = `${f.file_name} 관리`;
      if (isEventPhoto(f)) {
        const tile = document.createElement('div'); tile.className = 'ci-photo'; tile.dataset.frRow = ''; tile.dataset.ciFile = f.drive_file_id;
        tile.innerHTML = `<button type="button" class="icon-btn ci-photo-open" aria-label="사진 크게 보기: ${esc(f.file_name)}" title="${esc(f.file_name)}"><span class="ci-photo-img"></span></button><span class="ci-photo-name"${renameHostAttrs(spec(f))}>${esc(f.file_name)}</span>`;
        tile.querySelector('.ci-photo-open').onclick = e => view(f, e.currentTarget);
        tile.append(menu(f, label));
        photos.append(tile);
        paintThumb(tile, f);
      } else {
        const row = document.createElement('div'); row.className = 'ci-file-row'; row.dataset.frRow = ''; row.dataset.ciFile = f.drive_file_id;
        // 이름 칸은 고치는 칸이 들어설 자리라 단추 안에 두지 않는다(누르기·Enter = 열기, 두 번 누르기·꾹 누르기 = 이름 고치기는 공용 file-rename.js).
        row.innerHTML = `${FILE_ICON}<span class="ci-file-name" role="button" tabindex="0" title="${esc(f.file_name)}" aria-label="열기: ${esc(f.file_name)}"${renameHostAttrs(spec(f))}>${esc(f.file_name)}</span>`;
        const name = row.querySelector('.ci-file-name');
        name.onclick = e => { if (!e.target.closest('.fr-box')) view(f, name); };
        name.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === name) { e.preventDefault(); view(f, name); } };
        row.append(menu(f, label));
        rows.append(row);
      }
    }
    photos.hidden = !photos.childElementCount; rows.hidden = !rows.childElementCount;
  }
  // 이름 수정이 끝나면(공용 알림) 이 칸의 목록도 새 이름으로.
  window.addEventListener('kptu:file-renamed', e => { if (event && applyRenamed(files, e.detail)) { paint(); onChange(files.map(f => ({...f}))); } });
  // 뒤에서 올리기가 끝나면 열린 그 일정의 목록을 서버 답으로.
  window.addEventListener('kptu:event-files-changed', e => { const d = e.detail || {}; if (event && d.eventId === event.id && (d.calendarId || 'primary') === (event.calendarId || 'primary') && Array.isArray(d.files)) set(d.files); });
  return {
    show(next) {
      if (!next?.id || !eventFilesReady(next)) { this.hide(); return; }
      const same = event && event.id === next.id && (event.calendarId || 'primary') === (next.calendarId || 'primary');
      event = next; files = cleanFiles(next.files); if (!same) pick.clear();
      host.hidden = false; pick.show(true); paint();
    },
    hide() { event = null; files = []; host.hidden = true; pick.clear(); paint(); },
    chosen: () => pick.files(),
    clear: () => pick.clear(),
    files: () => files.map(f => ({...f})),
    render: () => pick.render(),
  };
}
