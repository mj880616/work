// APP-폰앱새로 ② 공유로 바구니 넣기(설계 docs/design/phone-app-v2.md 4절, PR 1327 댓글 D5·D6).
// SHARE-바로넣기(2026-10-30 명진 결정): 확인 줄·메모 칸·[넣기]·[취소] 없이 공유가 들어오면 바로 정리함에 넣는다(D4 바뀜).
// 결과는 위쪽 공용 작은 알림(small-notice.js) 한 줄: "업데이트로 보냈어요 [메모 달기] [되돌리기]", 실패면 "넣지 못했어요 [다시]".
// S49-9 UI-업데이트로보내기(요청함 11/03 17:04): 이름·알림은 사진 메뉴와 같은 공용 목록(photo-menu-items.mjs)에서 읽는다.
// 폰 앱(KPTUAndroid)에서만 동작한다. 앱은 다른 앱의 [공유]로 받은 항목을 메모리에만 들고 있고,
// 이 화면은 PR 1414의 바 색 다리(KPTUAppShell, 허용 Origin의 최상위 화면에만 보임)로 목록(이름·종류·크기·글)만 묻는다.
// 파일 내용은 ./__share/<일회용 번호>/<순번>을 fetch하면 앱이 WebView 안에서 가로채 흘려준다(서버로 나가지 않음).
// 저장은 바구니 기존 길만 쓴다: 파일은 basket-upload.js uploadBatch(= basket-files, 사진 글자 읽기 포함), 글만은 createNote(= app_notes).
// [메모 달기]는 방금 넣은 업데이트의 글 맨 앞에 한 줄을 붙이고(updateNote), [되돌리기]는 정리함 [지우기]와 같은 길(휴지통)로 뺀다.
// 토큰은 웹 세션 그대로이고 앱은 보지 않는다. 폰에 보관하지 않는다: 실패하면 이 화면 메모리의 파일로 [다시]만 하고, 못 하면 다시 공유하도록 안내한다.
// 받은 것은 내 정리함에만 들어간다. 밖으로 보내거나 공유하는 흐름은 없다.
// APP-공유노트할일(요청함 11/02 00:22): 공유 창 '웹2 노트'·'웹2 할 일'로 온 공유(목록의 target)는 같은 받기 길로 받고,
// 바로 넣지 않고 작은 창(share-target.js: 제목·폴더/기한·한 줄 더하기 → [저장])으로 노트·할 일에 넣는다.
import {isShareId, parseShareList, pickShareItems, shareSummary, skippedText, shareRawText, withMemo, SHARE_MAX_BYTES, SHARE_MEMO_MAX} from './share-intake-model.mjs';
import {notify} from './small-notice.js';
import {PHOTO_ACT_TEXT, SEND_NOTE} from './photo-menu-items.mjs';

const BRIDGE = 'KPTUAppShell';
export const SAVED_MS = 6000, FAILED_MS = 20000, WORKING_MS = 600000;
const LABEL = PHOTO_ACT_TEXT.basket;
const REFRESH = 'kptu:basket-note-created';

function start() {
  if (window.__KPTU_SHARE_INTAKE__) return;
  window.__KPTU_SHARE_INTAKE__ = true;
  if (!/KPTUAndroid/i.test(navigator.userAgent || '')) return;
  const bridge = window[BRIDGE];
  if (!bridge || typeof bridge.postMessage !== 'function' || typeof bridge.addEventListener !== 'function') return;

  // 한 번에 하나의 공유만 다룬다. share: 앱 목록 + 고른 항목, files: 받은 File(메모리), batch: 업로드 묶음(성공한 파일은 다시 보내지 않음).
  // 다 넣은 공유는 share.done으로 남겨 같은 번호가 다시 와도 두 번 넣지 않는다.
  let share = null, files = null, batch = null, busy = false, owner = '';
  const scope = () => { const c = window.KPTURuntime?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  const send = message => { try { bridge.postMessage(message); } catch { /* 다리가 사라진 화면: 아무것도 하지 않는다. */ } };
  const ask = id => send('share:get:' + (isShareId(id) ? id : ''));
  const release = () => { if (share) send('share:done:' + share.id); };
  const refresh = () => window.dispatchEvent(new CustomEvent(REFRESH));

  bridge.addEventListener('message', event => {
    const data = typeof event?.data === 'string' ? event.data : '';
    if (!data.startsWith('share:list:')) return;
    const list = parseShareList(data.slice('share:list:'.length));
    if (!list || busy || share?.id === list.id) return;
    void open(list);
  });

  function stripAddress() {
    // 다시 불러와도 앱이 아직 들고 있으면 빈 번호로 다시 묻는다(아래 ask('')). 주소에는 번호를 남기지 않는다.
    try { const u = new URL(location.href); if (!u.searchParams.has('share')) return; u.searchParams.delete('share'); history.replaceState(history.state, '', u); } catch { /* 주소를 못 고쳐도 동작은 같다. */ }
  }

  async function open(list) {
    const picked = pickShareItems(list.items);
    if (list.target === 'note' || list.target === 'task') { await openTarget(list, picked); return; }
    share = {...list, keep:picked.keep, skipped:picked.skipped};
    files = null; batch = null; owner = scope();
    stripAddress();
    try {
      if (window.KPTURouter?.current !== 'basket') window.KPTURouter?.go?.('basket', {allowUnloaded:true});
      await window.KPTUViewLoader?.load?.('basket');
    } catch { /* 정리함 화면을 못 열어도 저장은 같은 길로 한다. */ }
    await put();
  }

  // 노트·할 일: 같은 공유를 두 번 열지 않게 done으로 남기고 작은 창을 연다. 창이 [저장] 때 receive로 파일을 받고, 닫히면 앱에 끝났다고 알린다.
  async function openTarget(list, picked) {
    const one = {...list, keep:picked.keep, skipped:picked.skipped, done:true};
    share = one; files = null; batch = null; owner = scope();
    stripAddress();
    const who = owner, done = () => send('share:done:' + one.id);
    try {
      const {openShareTarget} = await import('./share-target.js');
      openShareTarget({target:list.target, subject:list.subject, text:list.text, items:one.keep, skipped:one.skipped,
        receive:() => receive(one), release:done, isCurrent:() => scope() === who});
    } catch {
      done();
      notify('넣지 못했어요', {error:true, ms:FAILED_MS, note:'창을 열지 못했어요. 그 앱에서 다시 공유해 주세요.'});
    }
  }

  // 앱이 흘려주는 파일을 한 번씩 받는다. 받은 파일은 이 화면 메모리에만 있다. 다 받으면 앱에 끝났다고 알린다(앱이 번호·권한을 버림).
  async function receive(from = share) {
    const out = [];
    let failed = 0, large = 0, empty = 0;
    for (const item of from.keep) {
      try {
        const response = await fetch(new URL(`__share/${from.id}/${item.index}`, document.baseURI), {cache:'no-store', credentials:'omit'});
        if (!response.ok) throw new Error('share_read_failed');
        const blob = await response.blob();
        if (!blob.size) { empty++; continue; }
        if (blob.size > SHARE_MAX_BYTES) { large++; continue; }
        out.push(new File([blob], item.name, {type:item.type || blob.type || 'application/octet-stream'}));
      } catch { failed++; }
    }
    send('share:done:' + from.id);
    return {out, failed, large, empty};
  }

  async function put() {
    if (busy || !share || share.done) return;
    if (scope() !== owner) { failed('로그인 계정이 바뀌어 넣지 않았어요. 다시 공유해 주세요.', false); return; }
    const raw = shareRawText({subject:share.subject, text:share.text});
    busy = true;
    notify(`${SEND_NOTE.basketBusy} · ${shareSummary({items:share.keep, text:share.text, subject:share.subject})}`, {ms:WORKING_MS});
    let status = skippedText(share.skipped), noteId = '', error = null;
    try {
      const [{createUploadBatch, uploadBatch}, {createNote, validateNoteText}] = await Promise.all([import('./basket-upload.js'), import('./basket-data.js')]);
      if (!files) {
        const got = share.keep.length ? await receive() : {out:[], failed:0, large:0, empty:0};
        files = got.out;
        // 앱은 받은 뒤 번호를 버리므로 못 읽은 파일은 다시 받을 수 없다: [다시] 없이 다시 공유하도록 안내한다.
        if (share.keep.length && !files.length) { share.lost = true; throw new Error('공유한 파일을 읽지 못했어요. 그 앱에서 다시 공유해 주세요.'); }
        const s = share.skipped || {};
        status = skippedText({...s, failed:got.failed, large:(s.large || 0) + got.large, empty:(s.empty || 0) + got.empty});
        if (files.length) { batch = createUploadBatch(); batch.entries = files.map(file => ({file, kind:'pending', label:'대기'})); }
      }
      const isCurrent = () => scope() === owner;
      if (batch) {
        let ocrNote = '';
        // 바구니와 같은 길: 첫 파일과 글로 업데이트를 만들고 나머지 파일을 붙인 뒤, 사진이면 글자 읽기를 한다(D5).
        await uploadBatch(batch, {raw_text:batch.note_id ? '' : raw.text, isCurrent, onOcrChange:value => { if (!value.ok) ocrNote = value.result_unknown ? '글자 읽기 결과는 정리함에서 확인해 주세요.' : '사진 글자는 읽지 못했어요.'; }});
        noteId = batch.note_id || '';
        if (ocrNote) status = [status, ocrNote].filter(Boolean).join(' ');
      } else {
        validateNoteText(raw.text);
        noteId = (await createNote({raw_text:raw.text}))?.id || '';
      }
      if (raw.cut) status = [status, '글이 길어 20,000자까지만 넣었어요.'].filter(Boolean).join(' ');
    } catch (e) {
      error = e;
    } finally {
      busy = false;
    }
    if (error) { failed(error?.message || '', !share.lost && !batch?.blocked); return; }
    share = {...share, done:true, keep:[]};
    files = null; batch = null;
    release();
    refresh();
    saved(noteId, status, owner);
  }

  function failed(message, canRetry) {
    const note = [message, canRetry ? '' : '보내지 못한 것은 폰에 따로 남기지 않아요.'].filter(Boolean).join(' ');
    notify('넣지 못했어요', {error:true, ms:FAILED_MS, note, actions:canRetry ? [{label:'다시', run:({close}) => { close(); void put(); }}] : []});
  }

  function saved(noteId, status, who) {
    const actions = noteId ? [{label:'메모 달기', run:({box, close}) => memoForm(box, close, noteId, who)}] : [];
    notify(SEND_NOTE.basketDone, {ms:SAVED_MS, note:status, label:LABEL, actions, undo:noteId ? () => takeOut(noteId, who) : null});
  }

  // [되돌리기]: 정리함 [지우기]와 같은 길(휴지통). 이미 한 번 눌렀으므로 다시 묻지 않는다. 휴지통 알림(되살리기)은 그 길이 띄운다.
  async function takeOut(noteId, who) {
    if (scope() !== who) return {status:'stale'};
    const {deleteNoteOriginal} = await import('./basket-record-delete.js');
    let result;
    try { result = await deleteNoteOriginal(noteId, {trash:true, confirmed:true, isCurrent:() => scope() === who}); }
    catch { result = {status:'unknown'}; }
    if (result?.status === 'deleted' || result?.status === 'missing') { refresh(); return result.status === 'deleted' ? {silent:true} : {status:'ok'}; }
    if (result?.status === 'stale') return {status:'stale'};
    return {status:'failed', message:result?.message || '정리함에서 빼지 못했어요. 정리함에서 지워 주세요.'};
  }

  // [메모 달기]: 알림 자리를 한 줄 입력칸으로 바꾼다. 초점이 안에 있는 동안 알림은 사라지지 않는다(small-notice holdTimer).
  function memoForm(box, close, noteId, who) {
    const doc = box.ownerDocument;
    const input = doc.createElement('input');
    Object.assign(input, {type:'text', className:'kptu-notice-input', maxLength:SHARE_MEMO_MAX, placeholder:'메모 한 줄'});
    input.setAttribute('aria-label', '메모 한 줄');
    input.setAttribute('enterkeyhint', 'done');
    input.dataset.shareMemo = '';
    const ok = doc.createElement('button');
    Object.assign(ok, {type:'button', className:'kptu-notice-undo kptu-notice-action', textContent:'달기'});
    const x = doc.createElement('button');
    Object.assign(x, {type:'button', className:'kptu-notice-close', textContent:'✕'});
    x.setAttribute('aria-label', '알림 닫기');
    x.addEventListener('click', close, {once:true});
    let sending = false;
    const submit = async () => {
      if (sending) return;
      const next = input.value.trim();
      if (!next) { input.focus(); return; }
      sending = true; input.disabled = ok.disabled = true;
      try {
        if (scope() !== who) throw new Error('로그인 계정이 바뀌어 메모를 달지 않았어요.');
        const {readBasketNote, updateNote} = await import('./basket-data.js');
        const note = await readBasketNote(noteId);
        if (!note) throw new Error('업데이트를 찾을 수 없어요. 이미 지워졌을 수 있어요.');
        // 글 모양(doc)이 붙은 업데이트는 글자만 고치면 모양이 지워진다: 덮어쓰지 않고 정리함에서 고치게 한다.
        if (note.doc) throw new Error('그사이 바뀐 업데이트라 메모를 달지 않았어요. 정리함에서 고쳐 주세요.');
        const text = withMemo(next, note.raw_text || '');
        if (!text || text.cut) throw new Error('글이 길어 메모를 달지 못했어요. 정리함에서 고쳐 주세요.');
        if (scope() !== who) throw new Error('로그인 계정이 바뀌어 메모를 달지 않았어요.');
        await updateNote(noteId, {raw_text:text.text});
        refresh();
        notify('메모를 달았어요');
      } catch (e) {
        notify('메모를 달지 못했어요', {error:true, note:e?.message || ''});
      }
    };
    ok.addEventListener('click', () => void submit());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    box.replaceChildren(input, ok, x);
    input.focus({preventScroll:true});
  }

  // 앱이 이미 열린 화면 위로 새 공유를 넘길 때 부른다(MainActivity의 arrive). 다시 불러오지 않고 목록만 묻는다.
  window.KPTUShareIntake = Object.freeze({arrive(id) { if (!isShareId(id) || busy) return false; ask(id); return true; }});
  // 로그인 복귀 등으로 주소에 번호가 없을 때도 앱이 들고 있는 공유가 있으면 이어서 넣는다(설계 4.3).
  ask(new URLSearchParams(location.search).get('share') || '');
}

start();
