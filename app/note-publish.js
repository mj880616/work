// NOTE-게시 ②(docs/design/note-publish.md 2·3절): 노트 하나를 기존 공유 링크 길로 게시·링크 복사·게시 멈춤.
// 새 서버 길 없음: 모두 owner RLS REST(app_share_pages · app_note_share_pages · app_share_page_links)로, 서버가 내 작업공간의 내 노트만 받는다
// (짝 표 정책: 같은 작업공간의 kind 'note' 노트와 같은 작업공간의 페이지만). 로그인 없는 읽기는 share-page-read가 노트의 지금 제목·글을 보여 준다.
// 링크 값(token)은 [링크 복사]를 누를 때만 읽어 바로 클립보드로 보낸다 — 화면 상태·기기 저장·로그에 남기지 않는다.
// NOTE-게시 ③ 사진: 게시할 때·게시 중 노트를 저장할 때 이 화면(주인 로그인)이 노트 사진을 내 Drive에서 받아(basket-files, 주인만) 줄이고 다시 그려
// (위치 정보 없음, share-photos.js) 짝 공유 페이지 사진으로 올린다. 짝 페이지 블록에는 '지문 → 사진 id'만 적고, 쓰지 않게 된 사진은 share-page-media
// 정리(prune: 저장된 블록 기준)로 지운다. 게시 멈춤은 블록을 비우고 정리해 사진 파일까지 지운다(받아 둔 사진 주소도 열리지 않음).
import {pubStates, pageTitleFor, liveLink, photoKey, mirrorBlocks, readMirror, notePhotoSrcs, PUB_ON, PUB_OFF, PUB_NONE} from './note-publish-model.mjs';
import {shareUrl} from './share-pages-model.mjs';
import {copyText} from './copy-text.js';
import {createSharePhotos, shareIdOf} from './share-photos.js';
import {diaryPhotoUrl} from './diary-data.js';

const q = encodeURIComponent;

export function createNotePublish({rt = window.KPTURuntime} = {}) {
  let states = new Map(); // note_id → {pageId, state}
  let ready = false;
  const ws = () => { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('작업공간을 확인하지 못했어요.'); return id; };
  const api = (path, options = {}) => rt.api(path, {singleFlight:false, ...options});

  async function load() {
    const w = q(ws());
    const pairs = await api(`/rest/v1/app_note_share_pages?workspace_id=eq.${w}&select=page_id,note_id`);
    const ids = (Array.isArray(pairs) ? pairs : []).map(p => p?.page_id).filter(id => typeof id === 'string');
    // 휴지통에 든 페이지는 RLS가 숨긴다 → 보이지 않는 짝은 '없음'(다시 게시하면 새로 만든다).
    const pages = ids.length ? await api(`/rest/v1/app_share_pages?workspace_id=eq.${w}&id=in.(${ids.map(q).join(',')})&select=id,status`) : [];
    states = pubStates(pairs, pages); ready = true;
    return states;
  }
  const stateOf = noteId => states.get(noteId)?.state || PUB_NONE;
  const isOn = noteId => stateOf(noteId) === PUB_ON;
  const onCount = () => [...states.values()].filter(s => s.state === PUB_ON).length;

  async function setStatus(pageId, status, title, extra = null) {
    const body = {status, updated_at:new Date().toISOString(), ...(extra || {})};
    if (title) body.title = title;
    const rows = await api(`/rest/v1/app_share_pages?id=eq.${q(pageId)}&workspace_id=eq.${q(ws())}&select=id,status`, {method:'PATCH', prefer:'return=representation', body});
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].status !== status) throw new Error('게시 상태를 바꾸지 못했어요.');
  }
  // 열린 링크가 없으면 하나 만든다(이름표 없음·기한 없음). 링크 값은 돌려주기만 하고 들고 있지 않는다.
  async function linkToken(pageId) {
    // 목록은 링크 값 없이 읽고, 고른 링크 하나의 값만 따로 읽는다(공유 페이지 화면 [복사]와 같은 길).
    const rows = await api(`/rest/v1/app_share_page_links?page_id=eq.${q(pageId)}&workspace_id=eq.${q(ws())}&select=id,expires_at,disabled_at,created_at&order=created_at.asc`);
    const live = liveLink(rows);
    if (live) {
      const one = await api(`/rest/v1/app_share_page_links?id=eq.${q(live.id)}&page_id=eq.${q(pageId)}&workspace_id=eq.${q(ws())}&select=token`);
      if (!Array.isArray(one) || one.length !== 1) throw new Error('링크를 찾지 못했어요.');
      return one[0].token;
    }
    const made = await api('/rest/v1/app_share_page_links?select=token', {method:'POST', prefer:'return=representation', body:{workspace_id:ws(), page_id:pageId, label:'', expires_at:null}});
    if (!Array.isArray(made) || made.length !== 1) throw new Error('링크를 만들지 못했어요.');
    return made[0].token;
  }

  // [공유 링크 만들기]: 짝이 있으면 그 페이지를 다시 게시(같은 링크가 살아남), 없으면 페이지 → 짝 → 링크 순서로 만든다.
  async function publish(note) {
    const w = ws(), title = pageTitleFor(note), cur = states.get(note.id);
    if (cur && cur.state !== PUB_NONE) {
      await setStatus(cur.pageId, 'published', title);
      states.set(note.id, {pageId:cur.pageId, state:PUB_ON});
      await linkToken(cur.pageId);
      return;
    }
    // 페이지가 휴지통에 있는 옛 짝은 걷어 낸다(노트 하나에 짝 하나).
    if (cur) await api(`/rest/v1/app_note_share_pages?note_id=eq.${q(note.id)}&workspace_id=eq.${q(w)}`, {method:'DELETE', prefer:'return=minimal'});
    const pages = await api('/rest/v1/app_share_pages?select=id,status', {method:'POST', prefer:'return=representation', body:{workspace_id:w, title, blocks:[], status:'published'}});
    if (!Array.isArray(pages) || pages.length !== 1 || !pages[0].id) throw new Error('게시하지 못했어요.');
    const pageId = pages[0].id;
    try {
      await api('/rest/v1/app_note_share_pages', {method:'POST', prefer:'return=minimal', body:{workspace_id:w, page_id:pageId, note_id:note.id}});
    } catch (e) {
      // 짝을 못 넣었으면 방금 만든 빈 페이지를 거둔다(휴지통으로, 공개 읽기는 저절로 닫힘).
      await api(`/rest/v1/app_share_pages?id=eq.${q(pageId)}&workspace_id=eq.${q(w)}`, {method:'DELETE', prefer:'return=minimal'}).catch(() => {});
      throw e;
    }
    states.set(note.id, {pageId, state:PUB_ON});
    await linkToken(pageId);
  }
  // 사진 맞추기: 노트 글의 사진(이 노트 첨부만) ↔ 짝 페이지 사진. 이미 올린 사진은 다시 올리지 않는다(같은 지문). 노트마다 한 줄로 차례대로.
  // 한 장을 못 올려도 나머지는 계속하고 {failed}로 알려 준다(그 사진은 받는 화면에서 자리만). 게시 중이 아니면 아무것도 안 한다.
  const lines = new Map();
  function syncPhotos(note) {
    const prev = lines.get(note?.id) || Promise.resolve();
    const job = prev.catch(() => {}).then(() => runSync(note));
    lines.set(note?.id, job);
    job.finally(() => { if (lines.get(note?.id) === job) lines.delete(note?.id); }).catch(() => {});
    return job;
  }
  async function mirrorOf(pageId) {
    const rows = await api(`/rest/v1/app_share_pages?id=eq.${q(pageId)}&workspace_id=eq.${q(ws())}&select=blocks`);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('게시한 페이지를 찾지 못했어요.');
    return readMirror(rows[0].blocks);
  }
  async function runSync(note) {
    const cur = note && states.get(note.id);
    if (!cur || cur.state !== PUB_ON) return {failed:0, sent:0};
    const pageId = cur.pageId, have = await mirrorOf(pageId), photos = createSharePhotos({rt, getPageId:() => pageId});
    const entries = [];
    let failed = 0, sent = 0;
    for (const src of notePhotoSrcs(note)) {
      const key = await photoKey(pageId, src);
      let id = have.get(key) || null;
      if (!id) {
        try {
          const blob = await (await fetch(await diaryPhotoUrl(note.id, src.slice(6), 'large', {rt}))).blob();
          id = shareIdOf((await photos.add(new File([blob], 'photo', {type:blob.type || 'image/jpeg'}))).src);
          if (id) sent++;
        } catch { id = null; }
      }
      if (id) entries.push({key, id}); else failed++;
    }
    const blocks = mirrorBlocks(entries);
    const now = readMirror(blocks);
    // 바뀐 것이 없으면(같은 사진·같은 차례) 블록을 다시 쓰지 않는다. 정리는 늘 한 번(남은 옛 사진 지우기).
    if (states.get(note.id)?.state !== PUB_ON) return {failed, sent}; // 그사이 게시를 멈췄으면 쓰지 않는다(멈춤이 비우고 정리한다)
    if (sent || now.size !== have.size || [...now].some(([k, v]) => have.get(k) !== v)) {
      const rows = await api(`/rest/v1/app_share_pages?id=eq.${q(pageId)}&workspace_id=eq.${q(ws())}&select=id`, {method:'PATCH', prefer:'return=representation', body:{blocks}});
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('게시한 사진을 저장하지 못했어요.');
    }
    await photos.prune(() => []);
    return {failed, sent};
  }
  async function copy(note) {
    const cur = states.get(note.id);
    if (!cur || cur.state !== PUB_ON) throw new Error('게시 중인 노트가 아니에요.');
    return copyText(shareUrl(await linkToken(cur.pageId)));
  }
  // S71-69 SHARE-글공유 ②: 노트 [공유] › [링크]가 기기 공유 창에 넘길 게시 주소. 게시 중인 노트만(값은 돌려주기만 하고 들고 있지 않는다).
  async function link(note) {
    const cur = states.get(note.id);
    if (!cur || cur.state !== PUB_ON) throw new Error('게시 중인 노트가 아니에요.');
    return shareUrl(await linkToken(cur.pageId));
  }
  async function stop(note) {
    const cur = states.get(note.id);
    if (!cur || cur.state !== PUB_ON) return;
    states.set(note.id, {pageId:cur.pageId, state:PUB_OFF});
    // 게시 멈춤과 사진 거울 비우기를 한 번에(받는 화면은 바로 닫힘), 그다음 정리로 사진 파일·기록을 지운다.
    try { await setStatus(cur.pageId, 'draft', null, {blocks:[]}); }
    catch (e) { states.set(note.id, cur); throw e; }
    // 그사이 돌던 사진 맞추기가 끝난 뒤 한 번 더 비운다(늦게 쓴 거울이 남지 않게).
    const running = lines.get(note.id);
    if (running) { await running.catch(() => {}); await api(`/rest/v1/app_share_pages?id=eq.${q(cur.pageId)}&workspace_id=eq.${q(ws())}`, {method:'PATCH', prefer:'return=minimal', body:{blocks:[]}}); }
    await createSharePhotos({rt, getPageId:() => cur.pageId}).prune(() => []);
  }
  return {load, isReady:() => ready, stateOf, isOn, onCount, publish, copy, link, stop, syncPhotos};
}
