// S69-94 NOTE-메모통일: 이 작업공간 메모 목록의 유일한 주인(화면 메모리만, 기기 저장 없음). 노트·읽을 거리·저장한 글 화면과 메모 칸(memo-thread.js)이
// 모두 이 목록 하나를 읽고, 남기기·고치기·지우기도 여기를 거쳐 서버(memo-data.js)에 쓴 뒤 듣는 곳(onMemos)에 한 번 알린다.
// 로그인한 사람·작업공간이 바뀌면 목록을 버리고 새로 읽는다. 원문이 아직 있는지(노트 밖 종류)는 처음 한 번 id만 읽어 둔다(memoExists).
import {readMemos, addMemo, updateMemo, deleteMemo, existingTargets} from './memo-data.js';
import {memoKey, MEMO_OPEN, titleCopy} from './memo-model.mjs';

const rt = () => window.KPTURuntime;
const scopeNow = () => { const c = rt()?.context?.read?.(); return c?.workspace?.id ? `${c.user?.id || ''}:${c.workspace.id}` : ''; };
const fresh = scope => ({scope, ready: false, legacy: false, missing: false, loaded: false, memos: [], loading: null, exists: new Map(), checking: false});
let s = fresh('');
const subs = new Set();
const own = () => { const now = scopeNow(); if (now !== s.scope) s = fresh(now); return s; };
function emit() {
  for (const fn of [...subs]) { try { fn(); } catch { /* 듣는 화면 하나가 다른 화면을 막지 않는다 */ } }
}
export function onMemos(fn) { subs.add(fn); return () => subs.delete(fn); }
export const memosNow = () => own().memos;
export const memoState = () => { const x = own(); return {ready: x.ready, legacy: x.legacy, missing: x.missing, loaded: x.loaded}; };

export function loadMemos({force = false} = {}) {
  const x = own();
  if (x.loading) return x.loading;
  if (x.loaded && !force) return Promise.resolve(x);
  x.loading = readMemos(rt()).then(r => {
    if (s !== x) return x;
    x.ready = r.ready; x.legacy = !!r.legacy; x.missing = !!r.missing; x.loaded = true;
    if (r.ready) x.memos = r.memos;
    emit();
    void checkTargets();
    return x;
  }).catch(() => { if (s === x) { x.loaded = true; x.ready = false; emit(); } return x; }).finally(() => { if (s === x) x.loading = null; });
  return x.loading;
}

// 원문이 있나: true·false·undefined(모름). 노트는 화면이 노트 목록으로 따로 안다(MEMO_OPEN check null).
export const memoExists = memo => own().exists.get(memoKey(memo?.target_type, memo?.target_id));
async function checkTargets() {
  const x = own();
  if (x.checking || !x.ready || x.legacy) return;
  x.checking = true;
  try {
    for (const type of Object.keys(MEMO_OPEN)) {
      if (!MEMO_OPEN[type]?.check) continue;
      const ids = [...new Set(x.memos.filter(m => m.target_type === type).map(m => m.target_id))].filter(id => !x.exists.has(memoKey(type, id)));
      if (!ids.length) continue;
      const got = await existingTargets(type, ids, rt());
      if (s !== x) return;
      if (got) for (const id of ids) x.exists.set(memoKey(type, id), got.has(id));
    }
  } finally { x.checking = false; }
  if (s === x) emit();
}
// 원문 화면이 열어 보고 알게 된 것(있음·없어짐)을 적는다.
export function noteExists(type, id, there) {
  const x = own(), k = memoKey(type, id);
  if (x.exists.get(k) === there) return;
  x.exists.set(k, there); emit();
}

// 남기기: target = {type, id, title}. 원문 제목은 사본으로 함께 남긴다(원문이 없어져도 무엇에 단 메모인지 보이게).
export async function leaveMemo(target, body, {quote = null, kind = null} = {}) {
  const x = own();
  const saved = await addMemo({target_type: target.type, target_id: target.id, target_title: titleCopy(target.title), body, quote, kind}, {legacy: x.legacy}, rt());
  if (s !== x) return saved;
  x.memos = [saved, ...x.memos];
  x.exists.set(memoKey(target.type, target.id), true);
  emit();
  return saved;
}
export async function editMemo(id, body) {
  const x = own();
  const saved = await updateMemo(id, body, rt());
  if (s !== x) return saved;
  x.memos = x.memos.map(m => (m.id === id ? {...m, ...saved} : m));
  emit();
  return saved;
}
// 지우기: 지운 메모를 돌려준다(되돌리기는 같은 글로 다시 남김).
export async function removeMemo(id) {
  const x = own(), was = x.memos.find(m => m.id === id);
  if (!was) return null;
  await deleteMemo(id, {legacy: x.legacy}, rt());
  if (s !== x) return was;
  x.memos = x.memos.filter(m => m.id !== id);
  emit();
  return was;
}
export async function restoreMemo(was) {
  return leaveMemo({type: was.target_type, id: was.target_id, title: was.target_title}, was.body, {quote: was.quote || null, kind: was.kind || null});
}
export function resetMemos() { s = fresh(scopeNow()); emit(); }
