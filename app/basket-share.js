// APP-폰앱새로 ② 공유로 받기(설계 docs/design/phone-app-v2.md 4절, PR 1327 댓글 D5·D6).
// SHARE-바로넣기(2026-10-30 사용자 결정): 확인 줄·메모 칸·[넣기]·[취소] 없이 공유가 들어오면 바로 넣는다.
// SHARE-노트로(2026-11-28 사용자 결정 "노트로 보내는 걸로 바꿔서 쓰자, 잊지 말기와는 별개로"): 기본 공유(앱 공유 창 'WORK ON+ 노트로 보내기')는
// 잊지 말기가 아니라 노트 새 노트 하나로 넣는다. 공유한 글 = 본문(주소는 링크), 사진·파일 = 그 노트 첨부(노트 첨부 서버 길 basket-files 그대로).
// 폴더는 '공유한 글'(19:01 사용자 결정, share-folder.js — 처음 공유 때 한 번 만들고 그 id를 사람별 서버 화면 기억에 둔다. 못 정하면 폴더 밖). 결과는 위쪽 공용 작은 알림(small-notice.js) 한 줄 '노트에 넣었어요 [열기]', 실패면 '넣지 못했어요 [다시]'.
// 잊지 말기(자동 추천)는 이 길과 따로 그대로다.
// 폰 앱(KPTUAndroid)에서만 동작한다. 앱은 다른 앱의 [공유]로 받은 항목을 메모리에만 들고 있고,
// 이 화면은 PR 1414의 바 색 다리(KPTUAppShell, 허용 Origin의 최상위 화면에만 보임)로 목록(이름·종류·크기·글)만 묻는다.
// 파일 내용은 ./__share/<일회용 번호>/<순번>을 fetch하면 앱이 WebView 안에서 가로채 흘려준다(서버로 나가지 않음).
// 저장은 노트 화면과 같은 길만 쓴다: 노트 = basket-data.js createNoteDoc(app_notes kind=note, 소유자 RLS), 첨부 = basket-upload.js sendNoteBehind(= basket-files).
// 토큰은 웹 세션 그대로이고 앱은 보지 않는다. 폰에 보관하지 않는다: 실패하면 이 화면 메모리의 파일로 [다시]만 하고, 못 하면 다시 공유하도록 안내한다.
// 받은 것은 내 노트에만 들어간다. 밖으로 보내거나 공유하는 흐름은 없다.
// APP-공유노트할일(요청함 11/02 00:22): 공유 창 '웹2 노트'·'웹2 할 일'로 온 공유(목록의 target)는 같은 받기 길로 받고,
// 바로 넣지 않고 작은 창(share-target.js: 제목·폴더/기한·한 줄 더하기 → [저장])으로 노트·할 일에 넣는다.
// S62-22 APP-공유로뉴스보관: 공유 창 'WORK ON+ 저장'(target news, S68-35 옛 'News 보관')은 창 없이 글에서 기사 주소 하나를 골라 서버(news-feed ?action=save_url)에 보낸다.
// 서버가 로그인·작업공간을 정하고 원문을 읽어(공개 본문만) 내 News에 넣고 바로 보관한다. 알림 한 줄 '저장한 글에 넣었어요 [열기]'.
// 주소가 없는 글·사진이면 '기사 주소가 없어요 [노트로 넣기]'(누를 때만 새 노트 길로, SHARE-노트로). 발송·공유·삭제로 이어지는 흐름은 없다.
import {isShareId, shareArticleUrl, shareArticleTitle, parseShareList, pickShareItems, shareSummary, skippedText, SHARE_MAX_BYTES} from './share-intake-model.mjs';
import {noteDraft, linkedNoteDoc} from './share-target-model.mjs';
import {notify} from './small-notice.js';
import {NEWS_NOTE} from './share-news-words.mjs';

const BRIDGE = 'KPTUAppShell';
export const SAVED_MS = 6000, FAILED_MS = 20000, WORKING_MS = 600000;
export const SHARE_NOTE_TEXT = Object.freeze({busy:'노트에 넣는 중…', done:'노트에 넣었어요', open:'열기'});
const REFRESH = 'kptu:basket-note-created';


function start() {
  if (window.__KPTU_SHARE_INTAKE__) return;
  window.__KPTU_SHARE_INTAKE__ = true;
  if (!/KPTUAndroid/i.test(navigator.userAgent || '')) return;
  const bridge = window[BRIDGE];
  if (!bridge || typeof bridge.postMessage !== 'function' || typeof bridge.addEventListener !== 'function') return;

  // 한 번에 하나의 공유만 다룬다. share: 앱 목록 + 고른 항목(made: 만든 노트 — [다시]로 두 번 만들지 않음), files: 받은 File(메모리).
  // 다 넣은 공유는 share.done으로 남겨 같은 번호가 다시 와도 두 번 넣지 않는다.
  let share = null, files = null, busy = false, owner = '';
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
    // S68-09 READ-읽을거리함: '읽을 거리'(모든 사람) — 글에서 주소 하나만 골라 읽을 거리에 넣는다(파일은 받지 않음).
    if (list.target === 'reading') { await openReading(list, picked); return; }
    // NEWS-운영자만(S63-03): 'News 보관' 공유는 운영자 기능 키 'outside'가 있는 계정만. 키가 없다는 답이면 새 노트 길(SHARE-노트로)로 받는다
    // (앱의 공유 목록은 앱 판이 정해 웹에서 뺄 수 없다 — 서버도 같은 키로 막는다). 답을 모르면(null) 지금처럼 News로 보낸다.
    if (list.target === 'news') {
      const {myFeaturesOrNull} = await import('./my-features.js');
      const features = await myFeaturesOrNull().catch(() => null);
      if (!Array.isArray(features) || features.includes('outside')) { await openNews(list, picked); return; }
      list = {...list, target:'basket'};
    }
    share = {...list, keep:picked.keep, skipped:picked.skipped};
    files = null; owner = scope();
    stripAddress();
    // SHARE-노트로: 화면은 옮기지 않는다(지금 화면 그대로, 알림 [열기]로 그 노트).
    await put();
  }

  // 노트·할 일: 같은 공유를 두 번 열지 않게 done으로 남기고 작은 창을 연다. 창이 [저장] 때 receive로 파일을 받고, 닫히면 앱에 끝났다고 알린다.
  async function openTarget(list, picked) {
    const one = {...list, keep:picked.keep, skipped:picked.skipped, done:true};
    share = one; files = null; owner = scope();
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

  // News 보관: 주소(+ 공유 창이 넘긴 제목 한 줄, S67-10)만 서버로 보낸다(파일은 받지 않음). 같은 공유를 두 번 넣지 않게 done으로 남기고 앱에 바로 끝났다고 알린다.
  // 주소가 없으면 [노트로 넣기]를 누를 때만 새 노트 길(put)로 — 그때 파일도 받는다(앱이 아직 들고 있을 때까지).
  async function openNews(list, picked) {
    const url = shareArticleUrl({subject:list.subject, text:list.text});
    owner = scope(); files = null;
    stripAddress();
    if (!url) {
      share = {...list, keep:picked.keep, skipped:picked.skipped, target:'basket'};
      const one = share;
      notify(NEWS_NOTE.noUrl, {error:true, ms:FAILED_MS, actions:[{label:NEWS_NOTE.toNote, run:({close}) => { close(); if (share === one) void put(); }}]});
      // 알림이 사라질 때까지 누르지 않으면 앱이 든 공유를 놓아 준다(폰에 따로 남기지 않음).
      setTimeout(() => { if (share === one && !one.done && !busy && !files) { one.done = true; release(); } }, FAILED_MS + 1000);
      return;
    }
    share = {...list, keep:[], skipped:{}, done:true};
    send('share:done:' + list.id);
    const who = owner;
    try { const {saveSharedNews} = await import('./share-news.js'); await saveSharedNews(url, {title:shareArticleTitle({subject:list.subject, text:list.text}), isCurrent:() => scope() === who}); }
    catch { notify(NEWS_NOTE.fail, {error:true, ms:FAILED_MS, note:'그 앱에서 다시 공유해 주세요.'}); }
  }
  // 읽을 거리: 주소(+ 공유 창 제목 한 줄)만 읽을 거리 표에 넣는다(owner RLS). 원문은 기존 note-import로 뒤에서 받는다.
  // 주소가 없으면 안내 한 줄 + [노트로 넣기](누를 때만 새 노트 길 put — News 보관과 같은 규칙).
  async function openReading(list, picked) {
    const {sharedReading} = await import('./reading-model.mjs');
    const {url, title} = sharedReading({subject:list.subject, text:list.text});
    owner = scope(); files = null;
    stripAddress();
    const {SHARE_NOTE, saveSharedReading} = await import('./reading-data.js');
    if (!url) {
      share = {...list, keep:picked.keep, skipped:picked.skipped, target:'basket'};
      const one = share;
      notify(SHARE_NOTE.noUrl, {error:true, ms:FAILED_MS, actions:[{label:SHARE_NOTE.toNote, run:({close}) => { close(); if (share === one) void put(); }}]});
      setTimeout(() => { if (share === one && !one.done && !busy && !files) { one.done = true; release(); } }, FAILED_MS + 1000);
      return;
    }
    share = {...list, keep:[], skipped:{}, done:true};
    send('share:done:' + list.id);
    const who = owner;
    try { await saveSharedReading(url, {title, notify, isCurrent:() => scope() === who}); }
    catch { notify(SHARE_NOTE.fail, {error:true, ms:FAILED_MS, note:'그 앱에서 다시 공유해 주세요.'}); }
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
    busy = true;
    const working = notify(`${SHARE_NOTE_TEXT.busy} · ${shareSummary({items:share.keep, text:share.text, subject:share.subject})}`, {ms:WORKING_MS});
    let status = skippedText(share.skipped), noteId = '', error = null, behind = false;
    try {
      const [{createNoteDoc}, {createUploadBatch, sendNoteBehind}] = await Promise.all([import('./basket-data.js'), import('./basket-upload.js')]);
      if (!files) {
        const got = share.keep.length ? await receive() : {out:[], failed:0, large:0, empty:0};
        files = got.out;
        // 앱은 받은 뒤 번호를 버리므로 못 읽은 파일은 다시 받을 수 없다: [다시] 없이 다시 공유하도록 안내한다.
        if (share.keep.length && !files.length) { share.lost = true; throw new Error('공유한 파일을 읽지 못했어요. 그 앱에서 다시 공유해 주세요.'); }
        const s = share.skipped || {};
        status = skippedText({...s, failed:got.failed, large:(s.large || 0) + got.large, empty:(s.empty || 0) + got.empty});
      }
      if (scope() !== owner) { share.lost = true; throw new Error('로그인 계정이 바뀌어 넣지 않았어요. 다시 공유해 주세요.'); }
      // 새 노트 하나(노트 화면과 같은 저장 길). [다시]로 두 번 만들지 않게 만든 노트를 기억한다.
      if (!share.made) {
        const draft = noteDraft({subject:share.subject, text:share.text, files});
        // '공유한 글' 폴더(없으면 한 번 만듦). 폴더를 못 정해도 공유는 막지 않고 폴더 밖에 넣는다.
        const folder = await import('./share-folder.js').then(m => m.shareFolder()).catch(() => null);
        if (scope() !== owner) { share.lost = true; throw new Error('로그인 계정이 바뀌어 넣지 않았어요. 다시 공유해 주세요.'); }
        share.made = await createNoteDoc({title:draft.title, raw_text:draft.body, doc:linkedNoteDoc(draft.body), ...(folder ? {folder} : {})});
        share.folder = folder?.name || '';
      }
      noteId = share.made?.id || '';
      if (!noteId) throw new Error('저장한 노트를 확인하지 못했어요.');
      // 사진·파일은 그 노트의 뒤 줄(하단바 위 한 줄이 진행·끝·[다시 올리기]를 말한다). 받은 파일은 이 탭 메모리에만 있다.
      if (files.length) {
        const batch = createUploadBatch();
        batch.entries = files.map(file => ({file, kind:'pending', label:'대기'}));
        void sendNoteBehind(noteId, batch);
        behind = true;
      }
    } catch (e) {
      error = e;
    } finally {
      busy = false;
      working.close();
    }
    if (error) { failed(error?.message || '', !share.lost); return; }
    share = {...share, done:true, keep:[]};
    files = null;
    release();
    refresh();
    saved(noteId, status, behind, share.folder);
  }

  function failed(message, canRetry) {
    const note = [message, canRetry ? '' : '보내지 못한 것은 폰에 따로 남기지 않아요.'].filter(Boolean).join(' ');
    notify('넣지 못했어요', {error:true, ms:FAILED_MS, note, actions:canRetry ? [{label:'다시', run:({close}) => { close(); void put(); }}] : []});
  }

  // '노트에 넣었어요 [열기]': 그 노트를 노트 화면에서 연다(노트 목록과 같은 열기 길).
  function saved(noteId, status, behind, folderName = '') {
    const open = {label:SHARE_NOTE_TEXT.open, run:async ({close}) => {
      close();
      try { const {requestNoteDocOpen} = await import('./basket-note-tasks.js'); requestNoteDocOpen(noteId); } catch { /* 노트 목록은 열린다. */ }
      window.KPTURouter?.go?.('basket', {source:'delegated'});
    }};
    notify(SHARE_NOTE_TEXT.done, {ms:SAVED_MS, note:[folderName ? `‘${folderName}’ 폴더` : '', status, behind ? '첨부는 아래 줄에서 올라가요.' : ''].filter(Boolean).join(' · '), actions:[open]});
  }

  // 앱이 이미 열린 화면 위로 새 공유를 넘길 때 부른다(MainActivity의 arrive). 다시 불러오지 않고 목록만 묻는다.
  window.KPTUShareIntake = Object.freeze({arrive(id) { if (!isShareId(id) || busy) return false; ask(id); return true; }});
  // 로그인 복귀 등으로 주소에 번호가 없을 때도 앱이 들고 있는 공유가 있으면 이어서 넣는다(설계 4.3).
  ask(new URLSearchParams(location.search).get('share') || '');
}

start();
