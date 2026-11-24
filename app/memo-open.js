// S69-94 NOTE-메모통일 ★원문 연결: 메모 줄을 누르면 그 원문 기록을 열고 그 메모 자리로 내려가 잠깐 칠한다.
// 여는 방법은 memo-model.mjs MEMO_OPEN 표(한 곳)를 따른다. 여기는 그 표의 request 이름마다 그 화면에 "이 기록을 열어 줘"를 남기는 일만 한다.
// 메모 자리 찾기는 그 원문의 메모 칸(memo-thread.js)이 붙을 때 takeMemoReveal로 꺼내 한다(화면 메모리만, 기기 저장 없음).
import {memoLink, memoKey} from './memo-model.mjs';
import {requestNoteDocOpen} from './basket-note-tasks.js';
import {requestNewsOpen} from './news-request.mjs';

let pending = null; // {key: 'type:id', memo: id}
export function requestMemoReveal(type, id, memo) { pending = memo ? {key: memoKey(type, id), memo} : null; }
// 원문 메모 칸이 붙을 때: 그 원문에 남긴 요청이면 메모 id를 꺼낸다(한 번).
export function takeMemoReveal(type, id) {
  if (!pending || pending.key !== memoKey(type, id)) return null;
  const v = pending.memo; pending = null; return v;
}

const go = view => window.KPTURouter?.go?.(view, {source: 'delegated'});
// 열기 일(request 이름 → 그 화면에 요청 남기기). 새 종류는 MEMO_OPEN 한 줄 + 여기 한 줄.
const OPENERS = {
  note: o => { requestNoteDocOpen(o.id); go('basket'); },
  news: o => { if (requestNewsOpen({type: o.type, id: o.id})) go('news'); },
  reading: o => { if (window.KPTUReading?.open) window.KPTUReading.open(o.id); else { window.KPTUReadingOpen = {id: o.id}; go('reading'); } },
};

// 메모 하나의 원문 열기. inPlace(o) = 지금 화면이 스스로 열 수 있으면 true를 돌려준다(노트 화면 안의 노트 메모 등).
// 돌려줌: 열었으면 true, 원문이 없거나 여는 곳이 없으면 false(줄은 '원래 기록이 없어요'로 링크가 꺼져 있다).
export function openMemoSource(memo, {exists = () => undefined, inPlace = null} = {}) {
  const {open} = memoLink(memo, exists);
  if (!open) return false;
  requestMemoReveal(open.type, open.id, open.memo);
  if (inPlace?.(open)) return true;
  const run = OPENERS[open.request];
  if (!run) return false;
  run(open);
  return true;
}
