// PC공유메뉴(요청함 10/30 10:27, 명진 결정 '위 추천안대로'): 넓은 화면(761px~: PC·펼친 폴드)의 [공유]는 윈도우 공유 창 대신
// 누른 자리에 Web2 작은 메뉴(공용 anchored-menu)를 연다: [사진 복사] [정리함에 넣기] [다운로드] [다른 앱으로 공유…](= 지금의 기기 공유 창).
// - [사진 복사]: navigator.clipboard.write(image/png) → 텔레그램·카톡·Claude 입력칸에 Ctrl+V. PNG가 아닌 그림은 이 화면 메모리에서 PNG로 바꾼다.
//   ClipboardItem에는 바이트를 기다리는 약속(Promise)을 넘겨, 받는 동안에도 누른 효력(사용자 동작)이 이어지게 한다.
// - [정리함에 넣기]: 정리함 업데이트의 기존 저장 길(basket-upload.js uploadBatch = basket-files)만 쓴다. 새 저장 경로 없음.
// - [다운로드]: 이 화면 메모리의 바이트를 파일로(photo-share.js saveBlobFile). 동영상은 원본 받기(부르는 쪽이 준 download)로 안내한다.
// - 동영상은 [사진 복사]·[정리함에 넣기] 줄이 없다(이 화면에 동영상 바이트가 없음).
// 좁은 화면(≤760px: 폰·접은 폴드)은 지금처럼 바로 기기(안드로이드) 공유 창이다(native()).
// 바이트는 메모리에만 두고 브라우저 저장소에 두지 않는다. 원드라이브 임시 주소를 글자로 넘기지 않는다.
import {createAnchoredMenu} from './anchored-menu.js';
import {notify} from './small-notice.js';
import {saveBlobFile} from './photo-share.js';

export const WIDE_SHARE_QUERY = '(min-width:761px)';
export const wideShare = (mm = globalThis.matchMedia) => !!(typeof mm === 'function' && mm(WIDE_SHARE_QUERY)?.matches);
export const SHARE_ROW_TEXT = Object.freeze({copy: '사진 복사', basket: '정리함에 넣기', download: '다운로드', native: '다른 앱으로 공유…'});
export const SHARE_NOTE = Object.freeze({
  copied: '복사했어요',
  copyFail: '복사하지 못했어요. [다운로드]로 받아 주세요.',
  copyUnsupported: '이 브라우저는 사진 복사를 못 해요. [다운로드]로 받아 주세요.',
  none: '사진이 아직 뜨지 않았어요. 사진이 뜬 뒤 다시 눌러 주세요.',
  basketBusy: '정리함에 넣는 중…',
  basketDone: '정리함에 넣었어요',
  videoDownload: '동영상은 [ⓘ 정보]의 [⤓ 원본 받기]로 받아 주세요.',
});

// 메뉴 줄: 동영상은 복사·정리함 없음, 여러 장이면 복사 없음(클립보드는 그림 한 장), 기기 공유 창이 없으면 그 줄 없음.
export function shareRows({video = false, count = 1, native = false} = {}) {
  const rows = [];
  if (!video && count === 1) rows.push('copy');
  if (!video) rows.push('basket');
  rows.push('download');
  if (native) rows.push('native');
  return rows;
}

// 그림 바이트 → PNG(클립보드는 image/png만 받는다). 이미 PNG면 그대로.
export async function pngBlob(blob, {createBitmap = globalThis.createImageBitmap, doc = globalThis.document} = {}) {
  if (!blob) return null;
  if (blob.type === 'image/png') return blob;
  if (typeof createBitmap !== 'function' || !doc) return null;
  const bitmap = await createBitmap(blob);
  const canvas = doc.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return await new Promise(ok => canvas.toBlob(b => ok(b && b.size ? b : null), 'image/png'));
}

// [사진 복사] 한 번. 돌려주는 값: 'copied' · 'unsupported'(클립보드 쓰기 없음) · 'none'(바이트 없음) · 'failed'(브라우저가 거절).
export async function copyImage(getBlob, {nav = globalThis.navigator, Item = globalThis.ClipboardItem, toPng = pngBlob} = {}) {
  if (typeof nav?.clipboard?.write !== 'function' || typeof Item !== 'function') return 'unsupported';
  let empty = false;
  const png = Promise.resolve().then(getBlob).then(blob => { if (!blob) { empty = true; throw new Error('none'); } return toPng(blob); })
    .then(blob => { if (!blob) { empty = true; throw new Error('none'); } return blob; });
  try {
    await nav.clipboard.write([new Item({'image/png': png})]);
    return 'copied';
  } catch {
    await png.catch(() => {});
    return empty ? 'none' : 'failed';
  }
}

// [정리함에 넣기]: 정리함 업데이트 저장 길 그대로(첫 파일로 업데이트를 만들고 나머지를 붙임, 사진 글자 읽기 포함).
export async function putInBasket(files, {load = () => import('./basket-upload.js'), isCurrent = () => true, emit = name => globalThis.dispatchEvent?.(new CustomEvent(name))} = {}) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return {ok:false, code:'none'};
  const {createUploadBatch, uploadBatch} = await load();
  const batch = createUploadBatch();
  batch.entries = list.map(file => ({file, kind:'pending', label:'대기'}));
  await uploadBatch(batch, {raw_text:'', isCurrent});
  emit('kptu:basket-note-created');
  return {ok:true, count:list.length, note_id:batch.note_id};
}

let ctx = null, menu = null;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ensureMenu() {
  menu ||= createAnchoredMenu({id:'shareMenu', className:'od-link-menu share-menu', label:'공유', historyKey:'kptuShareMenu',
    // 크게 보기(dialog) 안에서 연 메뉴는 그 dialog 안에 둔다(가려지지 않게).
    parent:trigger => trigger.closest('[role="dialog"]') || document.body,
    key:() => 'share',
    render:() => (ctx?.rows || []).map(id => `<button type="button" data-share-act="${id}">${esc(SHARE_ROW_TEXT[id])}</button>`).join(''),
    onAction:button => runRow(button.dataset.shareAct)});
  return menu;
}
async function runRow(id) {
  const c = ctx; if (!c) return;
  const say = c.note || ((text, ms) => notify(text, {ms}));
  if (id === 'native') return c.native?.();
  if (id === 'copy') {
    const result = await copyImage(async () => (await c.getFiles())?.[0] || null);
    say(result === 'copied' ? SHARE_NOTE.copied : result === 'none' ? SHARE_NOTE.none : result === 'unsupported' ? SHARE_NOTE.copyUnsupported : SHARE_NOTE.copyFail, 4000);
    return;
  }
  if (id === 'download') {
    if (c.download) return c.download();
    if (c.video) { say(SHARE_NOTE.videoDownload, 5000); return; }
    const files = await c.getFiles();
    if (!files?.length) { say(SHARE_NOTE.none, 4000); return; }
    files.forEach(file => saveBlobFile(file, file.name));
    return;
  }
  if (id === 'basket') {
    const files = await c.getFiles();
    if (!files?.length) { say(SHARE_NOTE.none, 4000); return; }
    say(SHARE_NOTE.basketBusy, 0);
    try { await putInBasket(files); say(SHARE_NOTE.basketDone, 4000); }
    catch (error) { say(error?.message || '정리함에 넣지 못했어요.', 6000); }
  }
}

// [공유]를 눌렀을 때 하나의 입구. 넓은 화면이면 메뉴를 열고 'menu', 좁은 화면이면 native()를 그대로 부르고 'native'.
// opts: {video, count, getFiles: () => Promise<File[]>, native: () => void, download?: () => void, note?: (text, ms) => void}
export function shareFrom(trigger, opts = {}, {wide = wideShare(), nav = globalThis.navigator} = {}) {
  if (!wide || !trigger) { opts.native?.(); return 'native'; }
  const canNative = typeof opts.native === 'function' && typeof nav?.share === 'function';
  ctx = {...opts, rows:shareRows({video:!!opts.video, count:opts.count ?? 1, native:canNative})};
  ensureMenu().open(trigger);
  return 'menu';
}
