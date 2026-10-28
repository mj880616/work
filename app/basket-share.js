// APP-폰앱새로 ② 공유로 바구니 넣기(설계 docs/design/phone-app-v2.md 4절, PR 1327 댓글 D4·D5·D6).
// 폰 앱(KPTUAndroid)에서만 동작한다. 앱은 다른 앱의 [공유]로 받은 항목을 메모리에만 들고 있고,
// 이 화면은 PR 1414의 바 색 다리(KPTUAppShell, 허용 Origin의 최상위 화면에만 보임)로 목록(이름·종류·크기·글)만 묻는다.
// 파일 내용은 ./__share/<일회용 번호>/<순번>을 fetch하면 앱이 WebView 안에서 가로채 흘려준다(서버로 나가지 않음).
// 저장은 바구니 기존 길만 쓴다: 파일은 basket-upload.js uploadBatch(= basket-files, 사진 글자 읽기 포함), 글만은 createNote(= app_notes).
// 토큰은 웹 세션 그대로이고 앱은 보지 않는다. 폰에 보관하지 않는다: 실패하면 메모리의 파일로 [다시 보내기]만 한다.
import {isShareId, parseShareList, pickShareItems, shareSummary, shareRawText, SHARE_MAX_BYTES, SHARE_MEMO_MAX} from './share-intake-model.mjs';

const BRIDGE = 'KPTUAppShell';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function start() {
  if (window.__KPTU_SHARE_INTAKE__) return;
  window.__KPTU_SHARE_INTAKE__ = true;
  if (!/KPTUAndroid/i.test(navigator.userAgent || '')) return;
  const bridge = window[BRIDGE];
  if (!bridge || typeof bridge.postMessage !== 'function' || typeof bridge.addEventListener !== 'function') return;

  // 한 번에 하나의 공유만 다룬다. share: 앱 목록 + 고른 항목, files: 받은 File(메모리), batch: 업로드 묶음(성공한 파일은 다시 보내지 않음).
  let share = null, files = null, batch = null, busy = false, done = false, bar = null, owner = '';
  const scope = () => { const c = window.KPTURuntime?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  const send = message => { try { bridge.postMessage(message); } catch { /* 다리가 사라진 화면: 아무것도 하지 않는다. */ } };
  const ask = id => send('share:get:' + (isShareId(id) ? id : ''));
  const release = () => { if (share) send('share:done:' + share.id); };

  bridge.addEventListener('message', event => {
    const data = typeof event?.data === 'string' ? event.data : '';
    if (!data.startsWith('share:list:')) return;
    const list = parseShareList(data.slice('share:list:'.length));
    if (!list || busy || (share && share.id === list.id && !done)) return;
    open(list);
  });

  function stripAddress() {
    // 다시 불러와도 앱이 아직 들고 있으면 빈 번호로 다시 묻는다(아래 ask('')). 주소에는 번호를 남기지 않는다.
    try { const u = new URL(location.href); if (!u.searchParams.has('share')) return; u.searchParams.delete('share'); history.replaceState(history.state, '', u); } catch { /* 주소를 못 고쳐도 동작은 같다. */ }
  }

  async function open(list) {
    const picked = pickShareItems(list.items);
    share = {...list, keep:picked.keep, skipped:picked.skipped};
    files = null; batch = null; done = false; owner = scope();
    if (bar) bar.innerHTML = '';
    stripAddress();
    try {
      if (window.KPTURouter?.current !== 'basket') window.KPTURouter?.go?.('basket', {allowUnloaded:true});
      await window.KPTUViewLoader?.load?.('basket');
    } catch { /* 바구니 화면을 못 열면 아래에서 줄을 붙일 자리가 없다. */ }
    mount();
    paint({status:''});
  }

  function mount() {
    const view = document.querySelector('#basketView');
    if (!view) return;
    if (!bar || !bar.isConnected) {
      bar = document.createElement('div');
      bar.className = 'share-intake';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', '공유로 받은 항목');
      bar.addEventListener('click', onClick);
      bar.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('[data-share-memo]') && !e.isComposing) { e.preventDefault(); void put(); } });
    }
    const head = view.querySelector('.basket-head');
    if (head) head.after(bar); else view.prepend(bar);
  }

  function paint({status = '', state = 'ready'} = {}) {
    if (!bar || !share) return;
    const memo = bar.querySelector('[data-share-memo]')?.value || '';
    const summary = esc(shareSummary({items:share.keep, text:share.text, subject:share.subject}, share.skipped));
    if (state === 'saved') {
      bar.innerHTML = `<p class="share-intake-line"><span class="share-intake-sum">바구니에 넣었어요</span><button type="button" class="share-intake-btn" data-share-back>돌아가기</button><button type="button" class="share-intake-btn share-intake-quiet" data-share-close>닫기</button></p>`;
      return;
    }
    const locked = !!batch?.blocked;
    const label = state === 'retry' ? '다시 보내기' : '넣기';
    bar.innerHTML = `<p class="share-intake-sum">${summary}</p><div class="share-intake-line"><input type="text" class="share-intake-memo" data-share-memo aria-label="메모 한 줄" placeholder="메모 한 줄(선택)" maxlength="${SHARE_MEMO_MAX}" enterkeyhint="send"><button type="button" class="share-intake-btn" data-share-put${busy || locked ? ' disabled' : ''}>${busy ? '넣는 중' : label}</button><button type="button" class="share-intake-btn share-intake-quiet" data-share-cancel${busy ? ' disabled' : ''}>${locked ? '닫기' : '취소'}</button></div><p class="share-intake-status" data-share-status role="status">${esc(status)}</p>`;
    const input = bar.querySelector('[data-share-memo]');
    input.value = memo;
    // 첫 파일과 함께 글이 이미 저장됐으면 메모는 바꿀 수 없다(남은 파일만 다시 보낸다).
    input.disabled = !!(busy || locked || batch?.note_id);
  }

  function close() {
    if (busy) return;
    release();
    share = null; files = null; batch = null; done = false;
    bar?.remove();
  }

  function onClick(e) {
    const b = e.target.closest?.('button');
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-share-put')) void put();
    else if (b.hasAttribute('data-share-cancel') || b.hasAttribute('data-share-close')) close();
    else if (b.hasAttribute('data-share-back')) { close(); send('share:back'); }
  }

  // 앱이 흘려주는 파일을 한 번씩 받는다. 받은 파일은 이 화면 메모리에만 있다. 다 받으면 앱에 끝났다고 알린다(앱이 번호·권한을 버림).
  async function receive() {
    const out = [];
    let failed = 0, large = 0, empty = 0;
    for (const item of share.keep) {
      try {
        const response = await fetch(new URL(`__share/${share.id}/${item.index}`, document.baseURI), {cache:'no-store', credentials:'omit'});
        if (!response.ok) throw new Error('share_read_failed');
        const blob = await response.blob();
        if (!blob.size) { empty++; continue; }
        if (blob.size > SHARE_MAX_BYTES) { large++; continue; }
        out.push(new File([blob], item.name, {type:item.type || blob.type || 'application/octet-stream'}));
      } catch { failed++; }
    }
    release();
    return {out, failed, large, empty};
  }

  async function put() {
    if (busy || !share || batch?.blocked) return;
    if (scope() !== owner) { paint({status:'로그인 계정이 바뀌어 넣지 않았어요. 다시 공유해 주세요.'}); return; }
    const memo = bar?.querySelector('[data-share-memo]')?.value || '';
    const raw = shareRawText({memo, subject:share.subject, text:share.text});
    busy = true; paint({status:''});
    let status = '', state = 'retry';
    try {
      const [{createUploadBatch, uploadBatch}, {createNote, validateNoteText}] = await Promise.all([import('./basket-upload.js'), import('./basket-data.js')]);
      if (!files) {
        const got = share.keep.length ? await receive() : {out:[], failed:0, large:0, empty:0};
        files = got.out;
        if (share.keep.length && !files.length) throw new Error('공유한 파일을 읽지 못했어요. 그 앱에서 다시 공유해 주세요.');
        const notes = [];
        if (got.failed) notes.push(`읽지 못한 파일 ${got.failed}개`);
        if (got.large) notes.push(`100MB 넘는 파일 ${got.large}개`);
        if (got.empty) notes.push(`빈 파일 ${got.empty}개`);
        if (notes.length) status = `뺌: ${notes.join(', ')}. `;
        if (files.length) { batch = createUploadBatch(); batch.entries = files.map(file => ({file, kind:'pending', label:'대기'})); }
      }
      const isCurrent = () => scope() === owner;
      if (batch) {
        let ocrNote = '';
        // 바구니와 같은 길: 첫 파일과 글로 메모를 만들고 나머지 파일을 붙인 뒤, 사진이면 글자 읽기를 한다(D5).
        await uploadBatch(batch, {raw_text:batch.note_id ? '' : raw.text, isCurrent, onOcrChange:value => { if (!value.ok) ocrNote = value.result_unknown ? '글자 읽기 결과는 정리함에서 확인해 주세요.' : '사진 글자는 읽지 못했어요.'; }});
        status += ocrNote;
      } else {
        validateNoteText(raw.text);
        await createNote({raw_text:raw.text});
      }
      if (raw.cut) status += ' 글이 길어 20,000자까지만 넣었어요.';
      done = true; state = 'saved';
      release();
      window.dispatchEvent(new CustomEvent('kptu:basket-note-created'));
    } catch (error) {
      status += error?.message || '넣지 못했어요.';
    } finally {
      busy = false;
    }
    if (state === 'saved') {
      paint({state:'saved'});
      if (status.trim()) { const p = document.createElement('p'); p.className = 'share-intake-status'; p.setAttribute('role', 'status'); p.textContent = status.trim(); bar?.append(p); }
      share = {...share, keep:[]};
      files = null; batch = null;
    } else paint({status:status.trim(), state});
  }

  // 앱이 이미 열린 화면 위로 새 공유를 넘길 때 부른다(MainActivity의 arrive). 다시 불러오지 않고 목록만 묻는다.
  window.KPTUShareIntake = Object.freeze({arrive(id) { if (!isShareId(id) || busy) return false; ask(id); return true; }});
  // 로그인 복귀 등으로 주소에 번호가 없을 때도 앱이 들고 있는 공유가 있으면 이어서 보여 준다(설계 4.3).
  ask(new URLSearchParams(location.search).get('share') || '');
}

start();
