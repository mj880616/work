// OD-설정창 공용 부품(PHOTO-사진메뉴 2차, 명진 결정 4 · 2026-10-28 22:43): 원드라이브 설정 창 하나를 일기(diary.js)와 사진 메뉴(photos.js)가 함께 쓴다.
// 일기 안에 있던 창(위 폴더 고르기·하위 폴더 켜고 끄기·연결 끊기·폰 보관 그림 비우기·연결 뒤 마무리)을 그대로 옮겨 왔다(모양·data-od-* 속성 같음).
// 상태(창 열림·폴더 탐색·트리 초안·바쁨)는 이 부품이 갖고, 그리기는 부르는 화면이 html()을 제 자리에 넣어 한다(paint 콜백).
// 연결 상태(od)·안내 문구·다시 읽기는 부르는 화면 것이다: od(), refresh(force), message(text), fault(), reload(), reset({disconnected}).
// 저장은 모두 서버(Edge onedrive-photos). 기기에 남기는 것은 기존 od-thumb-cache.js 썸네일 사본뿐이고, 비우기 버튼도 그것만 비운다.
import {odAuthStart, odAuthFinish, odAuthUrlBack, odFolders, odFolderSet, odDisconnect, odFolderTree, odFolderToggle, odTreeRows, odTreeChanges,
  clearOdPhotoCache, odKeepCount, odKeepClear, odErrorText} from './diary-onedrive.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[ch]);
const folderCount = n => `${n}장`;

// opts: rt, layerName(라우터 겹 이름), back(연결 뒤 돌아올 화면: 'photos'면 사진 메뉴, 없으면 일기),
//   od() → 지금 연결 상태, refresh(force) → Promise(상태 다시 읽기), paint() → 화면 다시 그리기,
//   message(text) → 안내 한 줄(빈 글 = 지움), fault() → 오류 표시, reload() → 바뀐 뒤 사진 다시 읽기, reset({disconnected}) → 폴더·연결이 바뀜(받기 멈춤 등)
export function createOdSettings({rt, layerName, back = '', hint = '켠 폴더의 사진만 보여요. 하위 폴더도 함께 읽어요.', od, refresh, paint, message, fault = () => {}, reload = () => {}, reset = () => {}}) {
  let open = false, layer = null, browse = null, tree = null, busy = false, keep = null;
  const self = {
    get open() { return open; },
    get busy() { return busy; },
    // 창 HTML(열려 있고 연결돼 있을 때만). 안내 글은 창 안 [data-od-modal-note]에 부르는 화면이 넣는다.
    html() { return open && od().connected ? modalHtml() : ''; },
    run, startBrowse, openTree, connect, disconnect, finishReturn, close, setOpen,
    // 화면을 떠남·로그인한 사람이 바뀜: 창과 겹을 조용히 버린다(라우터가 겹을 이미 잊었음).
    drop() { layer = null; open = false; browse = null; tree = null; },
    click,
  };
  function modalHtml() {
    const o = od();
    let body = '', foot = '<button type="button" class="secondary" data-od-cancel>취소</button>';
    if (browse) {
      const names = browse.stack.map(x => esc(x.name)).join(' › ');
      body = `<div class="diary-od-browse"><p class="diary-muted">${names}</p>${browse.stack.length > 1 ? '<button type="button" class="secondary" data-od-up>위로</button>' : ''}<ul>${(browse.folders || []).map(f => `<li><button type="button" class="diary-od-name" data-od-enter="${esc(f.id)}" data-od-name="${esc(f.name)}">${esc(f.name)}</button><button type="button" class="secondary" data-od-pick="${esc(f.id)}">이 폴더 쓰기</button></li>`).join('')}</ul>${browse.folders && !browse.folders.length ? '<p class="diary-muted">하위 폴더가 없어요.</p>' : ''}${browse.folders ? '' : '<p class="diary-muted">불러오는 중…</p>'}</div>`;
    } else if (o.folder) {
      const t = tree?.data;
      let list = tree?.failed ? '' : '<p class="diary-muted">불러오는 중…</p>';
      if (t) {
        const rows = odTreeRows(t, tree.draft, tree.expanded);
        list = `<ul class="diary-od-tree"><li class="diary-od-toprow"><span class="diary-od-fname">${esc(t.top.name)} (이 폴더 바로 안)</span><span class="diary-od-n">${folderCount(t.top.count)}</span></li>${rows.map(r => `<li class="diary-od-row${r.dim ? ' is-dim' : ''}" data-depth="${Math.min(r.depth, 5)}"><button type="button" role="switch" class="diary-od-switch" data-od-sw="${esc(r.id)}" aria-checked="${r.on}" aria-label="${esc(r.name)} 사진 보기"></button>${r.hasKids ? `<button type="button" class="diary-od-fold" data-od-fold="${esc(r.id)}" aria-expanded="${r.open}" aria-label="${esc(r.name)} 하위 폴더">${r.open ? '▾' : '▸'}</button>` : '<span class="diary-od-fold" aria-hidden="true"></span>'}<span class="diary-od-fname">${esc(r.name)}</span><span class="diary-od-n">${folderCount(r.total)}</span></li>`).join('')}</ul>${rows.length ? '' : '<p class="diary-muted">하위 폴더가 없어요.</p>'}`;
        foot += '<button type="button" class="primary" data-od-save>저장</button>';
      }
      body = `<div class="diary-od-top"><b>원드라이브 · ${esc(o.folder.name)}</b><button type="button" class="secondary" data-od-change>위 폴더 바꾸기</button></div><p class="diary-muted">${esc(hint)}</p>${list}<div class="diary-od-actions"><button type="button" class="secondary diary-danger" data-od-disconnect>연결 끊기</button>${o.canDelete ? '' : '<button type="button" class="secondary" data-od-connect>지우기를 쓰려면 다시 연결</button>'}</div><p class="diary-od-keep" data-od-keep>폰에 보관한 작은 그림 ${keep === null ? '…' : `${keep}장`} · <button type="button" class="diary-od-keep-clear" data-od-keep-clear>비우기</button></p>`;
    } else {
      body = '<p class="diary-muted">불러오는 중…</p>';
    }
    return `<div class="diary-od-modal" data-od-modal><div class="diary-od-sheet" role="dialog" aria-modal="true" aria-label="원드라이브 설정">${body}<p class="diary-od-note" role="status" data-od-modal-note></p><div class="diary-od-foot">${foot}</div></div></div>`;
  }
  function setOpen(next, {fromBack = false} = {}) {
    open = next;
    if (next) { layer ||= window.KPTURouter?.layer?.open(layerName, {close:() => { close({fromBack:true}); return true; }}) || null; return; }
    const opened = layer; layer = null; if (!fromBack) opened?.close();
  }
  function close({fromBack = false} = {}) {
    browse = null; tree = null; message(''); setOpen(false, {fromBack}); paint();
  }
  // 서버 일 하나: 그동안 창의 단추를 막고, 실패하면 안내 한 줄과 오류 표시. reload면 끝난 뒤 사진을 다시 읽는다.
  async function run(task, {reload: again = false} = {}) {
    if (busy) return;
    busy = true; message(''); paint();
    try { await task(); } catch (error) { message(odErrorText(error)); fault(); }
    busy = false; paint();
    if (again) reload();
  }
  async function browseFolders(parentId) {
    browse.folders = null; paint();
    browse.folders = await odFolders(rt, parentId);
  }
  function startBrowse() { setOpen(true); tree = null; browse = {stack:[{id:null, name:'맨 위'}], folders:null}; return browseFolders(null); }
  function refreshKeep() { odKeepCount(rt).then(n => { keep = n; if (open) paint(); }, () => {}); }
  async function openTree() {
    setOpen(true); browse = null; tree = {data:null, draft:new Map(), expanded:new Set(), failed:false};
    const mine = tree;
    keep = null; refreshKeep();
    paint();
    try { mine.data = await odFolderTree(rt); } catch (error) { mine.failed = true; throw error; }
  }
  function connect() { return run(async () => { window.location.assign(odAuthUrlBack(await odAuthStart(rt), back)); }); }
  function disconnect() {
    if (!window.confirm('원드라이브 연결을 끊을까요? 원드라이브 사진은 그대로예요. 별표 기록도 남아요.')) return;
    return run(async () => { await odDisconnect(rt); clearOdPhotoCache(); await odKeepClear(); await refresh(true); browse = null; tree = null; setOpen(false); reset({disconnected:true}); }, {reload:true});
  }
  // 마이크로소프트에서 돌아옴(takeOdReturn 값): 연결을 마치고 바로 폴더 고르기 창.
  async function finishReturn(backValue) {
    setOpen(true);
    if (backValue.error) { message(backValue.error === 'access_denied' ? '원드라이브 연결을 취소했어요.' : '원드라이브 연결을 마치지 못했어요. 다시 눌러 주세요.'); paint(); return; }
    await run(async () => {
      await odAuthFinish(rt, backValue);
      await refresh(true);
      const o = od();
      const text = o.canDelete ? '연결됐어요. 사진을 읽을 폴더를 골라 주세요.' : '연결됐어요. 다만 지우기 권한이 없어요.';
      await startBrowse();
      message(text);
    });
  }
  // 창 안 단추. 처리했으면 true. panel = 창이 그려진 곳(트리 스크롤 자리 지키기).
  function click(button, panel) {
    const keepTreeScroll = (fn, focusSel) => { const at = panel.querySelector('.diary-od-tree')?.scrollTop || 0; fn(); paint(); const ul = panel.querySelector('.diary-od-tree'); if (ul) ul.scrollTop = at; panel.querySelector(focusSel)?.focus(); };
    if (button.matches('[data-od-connect]')) { connect(); return true; }
    if (button.matches('[data-od-change]')) { run(startBrowse); return true; }
    if (button.matches('[data-od-cancel]')) { close(); return true; }
    if (button.matches('[data-od-sw]')) {
      const f = tree?.data?.folders.find(x => x.id === button.dataset.odSw); if (!f) return true;
      keepTreeScroll(() => tree.draft.set(f.id, !(tree.draft.has(f.id) ? tree.draft.get(f.id) : f.enabled)), `[data-od-sw="${CSS.escape(f.id)}"]`);
      return true;
    }
    if (button.matches('[data-od-fold]')) {
      const id = button.dataset.odFold, set = tree?.expanded; if (!set) return true;
      keepTreeScroll(() => { if (set.has(id)) set.delete(id); else set.add(id); }, `[data-od-fold="${CSS.escape(id)}"]`);
      return true;
    }
    if (button.matches('[data-od-save]')) {
      const t = tree?.data; if (!t) return true;
      const changes = odTreeChanges(t, tree.draft);
      if (!changes.length) { close(); return true; }
      run(async () => { for (const c of changes) await odFolderToggle(rt, c.id, c.enabled); close(); }, {reload:true});
      return true;
    }
    if (button.matches('[data-od-up]')) { browse.stack.pop(); const top = browse.stack.at(-1); run(() => browseFolders(top.id)); return true; }
    if (button.matches('[data-od-enter]')) { browse.stack.push({id:button.dataset.odEnter, name:button.dataset.odName}); run(() => browseFolders(button.dataset.odEnter)); return true; }
    if (button.matches('[data-od-pick]')) {
      run(async () => { await odFolderSet(rt, button.dataset.odPick); await refresh(true); browse = null; tree = null; setOpen(false); reset({disconnected:false}); message(''); }, {reload:true});
      return true;
    }
    if (button.matches('[data-od-keep-clear]')) { run(async () => { await odKeepClear(); keep = 0; refreshKeep(); }); return true; }
    if (button.matches('[data-od-disconnect]')) { disconnect(); return true; }
    return false;
  }
  return self;
}
