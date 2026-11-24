// NOTE-게시 ②(docs/design/note-publish.md 2·3절): 노트 하나를 기존 공유 링크 길로 게시·링크 복사·게시 멈춤.
// 새 서버 길 없음: 모두 owner RLS REST(app_share_pages · app_note_share_pages · app_share_page_links)로, 서버가 내 작업공간의 내 노트만 받는다
// (짝 표 정책: 같은 작업공간의 kind 'note' 노트와 같은 작업공간의 페이지만). 로그인 없는 읽기는 share-page-read가 노트의 지금 제목·글을 보여 준다.
// 링크 값(token)은 [링크 복사]를 누를 때만 읽어 바로 클립보드로 보낸다 — 화면 상태·기기 저장·로그에 남기지 않는다.
import {pubStates, pageTitleFor, liveLink, PUB_ON, PUB_OFF, PUB_NONE} from './note-publish-model.mjs';
import {shareUrl} from './share-pages-model.mjs';
import {copyText} from './copy-text.js';

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

  async function setStatus(pageId, status, title) {
    const body = {status, updated_at:new Date().toISOString()};
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
  async function copy(note) {
    const cur = states.get(note.id);
    if (!cur || cur.state !== PUB_ON) throw new Error('게시 중인 노트가 아니에요.');
    return copyText(shareUrl(await linkToken(cur.pageId)));
  }
  async function stop(note) {
    const cur = states.get(note.id);
    if (!cur || cur.state !== PUB_ON) return;
    await setStatus(cur.pageId, 'draft');
    states.set(note.id, {pageId:cur.pageId, state:PUB_OFF});
  }
  return {load, isReady:() => ready, stateOf, isOn, onCount, publish, copy, stop};
}
