import {waitInlineHtml} from './wait-state.js';
import {appShare, phoneIdOf, inPhoneApp} from './app-share.js';
// OD-공유고침(2026-10-28): 사진 크게 보기의 [공유]·[내려받기] 공용 부품. 일기 크게 보기(diary.js)와 사진 크게 보기(photo-view.js) 둘이 쓴다.
// - [공유]는 화면에 이미 뜬 그림 바이트를 바로 넘긴다(누를 때 원드라이브·서버에서 다시 받지 않는다). 꾹 누르기 브라우저 메뉴와 같은 그림이다.
// - 그림 바이트는 칸(요소)마다 이 화면 메모리(WeakMap)에만 둔다. 칸이 사라지면 함께 사라진다. 브라우저 저장소에 두지 않는다.
// - 원드라이브 그림 주소(로그인 없이 열리는 임시 주소)를 링크·글자로 넘기지 않는다. 언제나 그림 파일로만 넘긴다.
const held = new WeakMap(); // 칸 요소 → {blob, flight, make}

// 칸이 그림을 바이트로 이미 가졌을 때(보관본·서버가 넘긴 바이트).
export function holdPhotoBlob(el, blob) {
  if (!el || !isImage(blob)) return;
  held.set(el, {blob, flight: Promise.resolve(blob), make: null});
}
// 칸이 주소로 그림을 띄웠을 때: 바이트가 필요해지면(공유를 준비할 때) make()로 받는다. 한 번만 받고 그 뒤로는 그 바이트를 쓴다.
export function holdPhotoMaker(el, make) {
  if (!el || typeof make !== 'function') return;
  const cur = held.get(el);
  if (cur?.blob) return;
  held.set(el, {blob: null, flight: null, make});
}
export function forgetPhotoBlob(el) { if (el) held.delete(el); }
// 지금 바로 넘길 수 있는 바이트(없으면 null). 기다리지 않는다.
export const readyPhotoBlob = el => held.get(el)?.blob || null;
// 바이트를 준비한다(받는 중이면 그 요청을 같이 기다린다). 못 받으면 null. 실패하면 다음에 다시 받을 수 있게 비운다.
export function preparePhotoBlob(el) {
  const cur = el ? held.get(el) : null;
  if (!cur) return Promise.resolve(null);
  if (cur.blob) return Promise.resolve(cur.blob);
  if (cur.flight) return cur.flight;
  cur.flight = Promise.resolve().then(cur.make).then(blob => (isImage(blob) ? blob : null), () => null).then(blob => {
    if (held.get(el) !== cur) return blob;
    if (blob) cur.blob = blob; else cur.flight = null;
    return blob;
  });
  return cur.flight;
}
// [공유]를 눌렀는데 그림이 아직 안 떴을 때: 뜰 때까지(최대 ms) 기다렸다 바이트를 준다. alive()가 false면(창을 닫음·다른 장으로 넘김) 그만둔다.
// 칸이 그림 대신 링크·'사진' 표시로 쉬면(data-state=link|gone) 기다리지 않는다.
// PHOTO-폰앱공유: 기다림(글자 없는 회색 칸)이 끝없이 남지 않게 15초에서 끊고 실패 글로 바꾼다.
export const SHARE_WAIT_MS = 15000;
export async function waitPhotoBlob(el, {alive = () => true, ms = SHARE_WAIT_MS, step = 200, sleep = t => new Promise(r => setTimeout(r, t))} = {}) {
  for (let waited = 0; waited <= ms; waited += step) {
    if (!el || !alive() || el.isConnected === false) return null;
    const blob = await preparePhotoBlob(el);
    if (blob) return blob;
    if (held.has(el)) return null; // 그림은 떴는데 바이트를 못 받음: 더 기다려도 같다
    if (el.dataset?.state === 'link' || el.dataset?.state === 'gone') return null;
    await sleep(step);
  }
  return null;
}
// [공유] 한 번의 전체 흐름: 바로 넘길 바이트가 있으면 넘기고, 없으면 note(받는 중)를 띄우고 기다렸다 넘긴다. note(text, ms)로 결과를 알린다.
// PHOTO-폰앱공유: 폰 앱(0.4.7+) 안이면 기기 공유 창 대신 앱 다리(app-share.js)로 안드로이드 공유 창을 띄운다.
// 폰 사진은 번호만 넘기고(앱이 그 파일 그대로), 원드라이브·드라이브는 받은 바이트를 넘긴다.
export async function sharePhotoElement(el, nameOf, {alive = () => true, note = () => {}, nav, doc, app = appShare()} = {}) {
  if (!el) return 'none';
  if (await app.ready()) return shareInApp(el, nameOf, {alive, note, app});
  let blob = readyPhotoBlob(el);
  if (!blob) {
    note(SHARE_TEXT.waiting, 0);
    blob = await waitPhotoBlob(el, {alive});
    if (!alive()) return 'gone';
  }
  // 그림은 떴는데 바이트를 못 받음(다른 사이트 주소로 뜬 그림·서버 실패) → unreadable, 아직 안 뜸 → none
  const result = blob ? await shareBlob(blob, nameOf(blob), {nav, doc}) : held.has(el) ? 'unreadable' : 'none';
  if (!alive()) return result;
  if (SHARE_TEXT[result]) note(SHARE_TEXT[result], 4000); else note('', 0);
  return result;
}
async function shareInApp(el, nameOf, {alive, note, app}) {
  const phoneId = phoneIdOf(el);
  let entry = phoneId ? {phoneId} : null;
  note(SHARE_TEXT.waiting, 0);
  if (!entry) {
    const blob = readyPhotoBlob(el) || await waitPhotoBlob(el, {alive});
    if (!alive()) return 'gone';
    const file = blob && photoFile(blob, nameOf(blob));
    if (!file) { const r = held.has(el) ? 'unreadable' : 'none'; note(SHARE_TEXT[r], 4000); return r; }
    entry = {file};
  }
  const r = await app.share([entry], {alive});
  const result = r === 'shared' ? 'shared' : r === 'none' ? (phoneId ? 'phoneGone' : 'none') : r === 'busy' ? 'busy' : 'failed';
  if (!alive()) return result;
  if (SHARE_TEXT[result]) note(SHARE_TEXT[result], 4000); else note('', 0);
  return result;
}
// PC공유메뉴: 넓은 화면 메뉴([사진 복사]·[정리함에 넣기]·[다운로드])가 쓸 그림 파일 하나. 바로 넘길 바이트가 없으면 note(받는 중)를 띄우고 기다린다.
// 못 받으면 [] (알림은 메뉴가 띄운다). 바이트는 이 화면 메모리에만.
export async function photoFilesFor(el, nameOf, {alive = () => true, note = () => {}} = {}) {
  if (!el) return [];
  let blob = readyPhotoBlob(el);
  if (!blob) { note(SHARE_TEXT.waiting, 0); blob = await waitPhotoBlob(el, {alive}); note('', 0); }
  const file = blob && alive() ? photoFile(blob, nameOf(blob)) : null;
  return file ? [file] : [];
}
const isImage = blob => !!blob && typeof blob.size === 'number' && blob.size > 0 && /^image\//.test(blob.type || '');

// 이 화면이 만든 그림 주소(blob:)의 바이트. 다른 사이트 주소는 읽지 않는다(null).
export async function localImageBlob(url, fetcher = globalThis.fetch) {
  if (typeof url !== 'string' || !url.startsWith('blob:') || typeof fetcher !== 'function') return null;
  try { const blob = await (await fetcher(url)).blob(); return isImage(blob) ? blob : null; } catch { return null; }
}
// <img>가 이미 그린 그림의 바이트(이 화면이 만든 blob: 주소일 때만).
export const imageElementBlob = (img, fetcher) => localImageBlob(img?.currentSrc || img?.src || '', fetcher);

export function photoFile(blob, name) {
  if (!isImage(blob) || typeof File !== 'function') return null;
  return new File([blob], name || 'photo.jpg', {type: blob.type || 'image/jpeg'});
}
// 그림 파일로 내려받기(이 화면 메모리의 바이트를 파일로 저장).
export function saveBlobFile(blob, name, doc = globalThis.document) {
  if (!isImage(blob) || !doc || typeof URL?.createObjectURL !== 'function') return false;
  const a = doc.createElement('a'), local = URL.createObjectURL(blob);
  a.href = local; a.download = name || 'photo.jpg'; a.hidden = true; doc.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(local), 10000);
  return true;
}
// 공유 창에 그림 파일 하나를 넘긴다. 돌려주는 값:
// 'shared' 넘김 · 'cancel' 사용자가 닫음 · 'again' 누른 뒤 시간이 지나 브라우저가 막음(한 번 더 누르면 됨) · 'saved' 공유 창이 없어 파일로 저장 · 'none' 바이트 없음
export async function shareBlob(blob, name, {nav = globalThis.navigator, doc = globalThis.document} = {}) {
  const file = photoFile(blob, name);
  if (!file) return 'none';
  if (typeof nav?.share === 'function' && nav.canShare?.({files: [file]})) {
    try { await nav.share({files: [file]}); return 'shared'; }
    catch (error) {
      if (error?.name === 'AbortError') return 'cancel';
      if (error?.name === 'NotAllowedError') return 'again';
    }
  }
  // 폰 앱 화면(옛 앱, 공유 창 길 없음)은 파일 저장도 되지 않는다(WebView는 blob 내려받기를 받지 않음). 틀린 '저장했어요' 대신 업데이트 안내.
  if (inPhoneApp()) return 'oldApp';
  return saveBlobFile(blob, file.name, doc) ? 'saved' : 'none';
}
// UI-기다림표시통일 2차: 사진·동영상을 받는 동안 알림 줄은 글자 없는 회색 칸. note(PHOTO_WAIT)를 받으면 paintPhotoNote가 그린다.
export const PHOTO_WAIT = '\u0000wait';
export function paintPhotoNote(el, text) {
  if (!el) return;
  if (text === PHOTO_WAIT) el.innerHTML = waitInlineHtml(); else el.textContent = text || '';
}
export const SHARE_TEXT = Object.freeze({
  waiting: PHOTO_WAIT,
  again: '사진을 다 받았어요. [공유]를 한 번 더 눌러 주세요.',
  saved: '이 기기는 공유 창이 없어 사진 파일로 저장했어요.',
  none: '사진이 아직 뜨지 않았어요. 사진이 뜬 뒤 다시 눌러 주세요.',
  unreadable: '이 사진은 지금 공유할 수 없어요. 잠시 뒤 다시 해 주세요.',
  failed: '공유하지 못했어요. 잠시 뒤 다시 해 주세요.',
  busy: '앞 공유가 아직 끝나지 않았어요. 잠시 뒤 다시 눌러 주세요.',
  phoneGone: '이 사진을 폰에서 찾지 못했어요.',
  oldApp: '이 앱 판은 공유 창을 못 열어요. 앱을 새 판으로 업데이트해 주세요.',
});
// PHOTO-폰앱공유: 알림 줄(회색 기다림 칸·안내 글)을 눌러도 아무 일이 없게 한다. 줄이 스스로 누름을 받으므로
// 손가락이 아래 버튼줄([🗑 지우기] 등)에 걸쳐도 폰 브라우저가 가까운 버튼으로 옮겨 누르지 않는다(누르는 곳 보정). keep = 그대로 둘 단추.
export function quietNote(el, keep = '') {
  if (!el || 'quietNote' in el.dataset) return;
  el.dataset.quietNote = '';
  el.addEventListener('click', event => {
    if (keep && event.target?.closest?.(keep)) return;
    event.preventDefault(); event.stopPropagation();
  });
}
