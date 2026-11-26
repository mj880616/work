// S69-97 NOTE-에버노트 ① 노트 안 할 일 → 구글 할 일 연결(설계 docs/design/note-evernote.md 2절).
// 편집기 부품: 할 일 체크 목록(marker 'check')의 항목 하나 = list_item. 항목의 gtask 칸에 연결한 구글 할 일 id를 둔다(노트 글에 함께 저장).
//   - 원본은 구글 할 일이다. 상태(끝냄)는 구글이 기준: 노트를 열 때·다른 화면에서 할 일이 바뀔 때·창으로 돌아올 때 구글에서 읽어 체크를 맞춘다.
//   - 기본은 끔: 체크칸마다 [문단 ▾] → [구글 할 일로]를 눌러야 연결된다(원치 않는 할 일이 구글로 쏟아지지 않게). 다시 누르면 연결만 푼다(구글 할 일은 그대로).
//   - 연결한 체크를 노트에서 누르면 바로 구글에 끝냄·되살림을 보낸다. 실패하면 체크를 되돌리고 한 줄로 알린다(구글 쪽 우선).
//   - 구글에서 지운 할 일은 연결을 풀고 한 줄로 알린다. 남의 연결로는 읽지 않는다: provider는 내 로그인으로 google-tasks 함수만 부른다.
// 저장은 하지 않는다: 바뀐 체크·연결은 노트의 [저장]으로 함께 저장된다(구글 쪽은 이미 바뀌어 있으므로 저장하지 않고 닫아도 다음에 열 때 맞춰진다).
// provider: {create(title) → Promise<{id}>, toggle(id, done) → Promise, pick(ids) → Promise<{tasks:[{id,status}], gone:[id]}>}.
import {CHECK_MARKER, GTASK_ID} from './ed-schema.mjs';

export const GTASK_LINK_MAX = 20; // 한 번에 연결하는 체크칸 수
const WAIT = 'wait:';
const SYNC = 'edGtaskSync';

// doc 안 연결된 항목: [{id, checked, pos}] (차례대로).
export function linkedItems(doc, N) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type === N.list_item && typeof node.attrs.gtask === 'string' && GTASK_ID.test(node.attrs.gtask)) out.push({id: node.attrs.gtask, checked: !!node.attrs.checked, pos});
    return true;
  });
  return out;
}
const inCheckList = ($pos, depth) => depth > 1 && $pos.node(depth - 1).attrs.marker === CHECK_MARKER;
// 고른 곳(커서 줄 또는 고른 범위)의 체크칸 항목들(가장 안쪽 항목만).
export function itemsInSelection(state, N) {
  const {from, to} = state.selection, out = [];
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type === N.list_item && parent?.attrs?.marker === CHECK_MARKER) out.push({node, pos});
    return true;
  });
  if (!out.length) {
    const $p = state.selection.$from;
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type === N.list_item && inCheckList($p, d)) { out.push({node: $p.node(d), pos: $p.before(d)}); break; }
  }
  // 바깥 항목 안에 안쪽 항목이 있으면 둘 다 할 일이다(각자 체크칸이 있다).
  return out;
}

export function mountGtasks({view, N, provider, say, makeCheckList}) {
  let gone = false, syncing = null;
  const setAttr = (tr, pos, patch) => { const node = tr.doc.nodeAt(pos); if (node) tr.setNodeMarkup(pos, null, {...node.attrs, ...patch}); return tr; };
  const findWait = key => { let at = -1; view.state.doc.descendants((node, pos) => { if (at < 0 && node.type === N.list_item && node.attrs.gtask === key) at = pos; return at < 0; }); return at; };
  const quiet = tr => tr.setMeta(SYNC, true).setMeta('addToHistory', false);

  // [구글 할 일로] 단추 상태: 커서 줄의 체크칸이 모두 연결돼 있으면 '연결 풀기'.
  function state(st = view.state) {
    const items = itemsInSelection(st, N);
    const linked = items.filter(i => typeof i.node.attrs.gtask === 'string' && i.node.attrs.gtask);
    return {items: items.length, unlink: !!items.length && linked.length === items.length};
  }

  async function press() {
    if (gone) return;
    let items = itemsInSelection(view.state, N);
    if (!items.length) { makeCheckList(); items = itemsInSelection(view.state, N); }
    if (!items.length) { say('할 일 체크 줄에서 눌러 주세요.'); return; }
    if (state().unlink) {
      const tr = view.state.tr;
      for (const i of items) setAttr(tr, i.pos, {gtask: null});
      view.dispatch(tr);
      say('구글 할 일 연결을 풀었어요. 구글 할 일은 그대로 있어요.');
      return;
    }
    const todo = items.filter(i => !i.node.attrs.gtask && i.node.textContent.trim()).slice(0, GTASK_LINK_MAX);
    if (!todo.length) { say(items.some(i => !i.node.attrs.gtask) ? '할 일 글을 먼저 써 주세요.' : '이미 구글 할 일과 연결돼 있어요.'); return; }
    const keys = todo.map(() => WAIT + Math.random().toString(36).slice(2, 10));
    const tr = view.state.tr;
    todo.forEach((i, n) => setAttr(tr, i.pos, {gtask: keys[n]}));
    view.dispatch(quiet(tr));
    let made = 0, failed = 0;
    for (let n = 0; n < todo.length; n++) {
      let id = null;
      try { id = (await provider.create(todo[n].node.textContent.trim().slice(0, 1024), !!todo[n].node.attrs.checked))?.id || null; } catch { id = null; }
      if (gone) return;
      const at = findWait(keys[n]);
      if (at < 0) continue; // 그사이 그 줄을 지웠다(만든 할 일은 구글에 남는다)
      if (id && GTASK_ID.test(id)) { view.dispatch(quiet(setAttr(view.state.tr, at, {gtask: id}))); made++; }
      else { view.dispatch(quiet(setAttr(view.state.tr, at, {gtask: null}))); failed++; }
    }
    say(failed ? `구글 할 일 ${failed}개를 만들지 못했어요. 구글 할 일 연결을 확인해 주세요.` : `구글 할 일 ${made}개를 만들었어요. 한쪽에서 끝내면 다른 쪽도 끝나요.`);
  }

  // 사람이 연결한 체크를 바꾸면(누르기·되돌리기) 구글에 보낸다. 실패하면 체크를 구글 쪽 값으로 되돌린다.
  function changed(before, tr, after) {
    if (gone || !tr.docChanged || tr.getMeta(SYNC)) return;
    const old = new Map(linkedItems(before, N).map(i => [i.id, i.checked]));
    for (const i of linkedItems(after, N)) {
      if (!old.has(i.id) || old.get(i.id) === i.checked) continue;
      const id = i.id, want = i.checked;
      provider.toggle(id, want).catch(() => {
        if (gone) return;
        const now = linkedItems(view.state.doc, N).find(x => x.id === id);
        if (now && now.checked === want) view.dispatch(quiet(setAttr(view.state.tr, now.pos, {checked: !want})));
        say('구글 할 일에 반영하지 못해 체크를 되돌렸어요. 연결을 확인해 주세요.');
      });
    }
  }

  // 구글에서 읽어 맞추기. 다르면 구글 쪽으로(되돌리기 기록 없이).
  function sync() {
    if (gone) return Promise.resolve();
    const ids = [...new Set(linkedItems(view.state.doc, N).map(i => i.id))].slice(0, 50);
    if (!ids.length) return Promise.resolve();
    if (syncing) return syncing;
    syncing = provider.pick(ids).then(r => {
      if (gone) return;
      const status = new Map((r?.tasks || []).map(t => [t.id, t.status === 'completed']));
      const lost = new Set(r?.gone || []);
      const tr = view.state.tr;
      let moved = 0, dropped = 0;
      for (const i of linkedItems(view.state.doc, N)) {
        if (lost.has(i.id)) { setAttr(tr, i.pos, {gtask: null}); dropped++; continue; }
        if (status.has(i.id) && status.get(i.id) !== i.checked) { setAttr(tr, i.pos, {checked: status.get(i.id)}); moved++; }
      }
      if (moved || dropped) view.dispatch(quiet(tr));
      if (dropped) say(`구글에서 삭제한 할 일 ${dropped}개는 연결을 풀었어요.`);
      else if (moved) say('구글 할 일에서 바뀐 체크를 맞췄어요.');
    }).catch(() => { if (!gone) say('구글 할 일 상태를 읽지 못했어요. 노트의 체크는 마지막 저장 그대로예요.'); })
      .finally(() => { syncing = null; });
    return syncing;
  }
  const onTasks = () => { void sync(); };
  const onShow = () => { if (document.visibilityState === 'visible') void sync(); };
  window.addEventListener('kptu:google-tasks-changed', onTasks);
  document.addEventListener('visibilitychange', onShow);
  return {state, press, changed, sync, destroy() { gone = true; window.removeEventListener('kptu:google-tasks-changed', onTasks); document.removeEventListener('visibilitychange', onShow); }};
}

// 같은 할 일 id가 둘이면(줄 나누기·복제가 칸을 베낌) 뒤의 것은 연결을 뺀다. 체크칸 목록 밖으로 나간 항목도 연결을 뺀다.
export function gtaskDedupe(pm, N) {
  return new pm.Plugin({
    appendTransaction(trs, _old, st) {
      if (!trs.some(t => t.docChanged)) return null;
      const seen = new Set(); let tr = null;
      st.doc.descendants((node, pos, parent) => {
        if (node.type !== N.list_item || !node.attrs.gtask) return true;
        const out = parent?.attrs?.marker !== CHECK_MARKER;
        if (seen.has(node.attrs.gtask) || out) { tr ||= st.tr; tr.setNodeMarkup(pos, null, {...node.attrs, gtask: null}); }
        else seen.add(node.attrs.gtask);
        return true;
      });
      return tr ? tr.setMeta(SYNC, true).setMeta('addToHistory', false) : null;
    },
  });
}
