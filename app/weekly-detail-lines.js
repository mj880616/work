// WEEKLY-사업영역세부줄 → RECORD-한줄 B-5(docs/design/record-one.md 3-1 '도입 전 주 보고 줄 보존'): 전환 주(RECORD_ONE_FROM) 앞 옛 주의
// [주간 정리] '2. 기본·영역·의제 사업 › 2) 세부 내용 — 회의·활동 결과' 목록을 **읽기 전용**으로 보인다.
// - 전환 주부터 2. 2)는 주요 사업 창(biz-detail-window.js)이 그린다. 이 모듈은 옛 주만 부른다(journal.js).
// - 그 주에 저장해 둔 draft.hand 의 details(손으로 더한 줄)·details_edits(고친 글·뺀 줄)는 그때 보고한 그대로 반영해 보인다(weekly-hand.mjs, journal-weekly.js 가 줄을 만든다).
//   고치기·빼기·[+ 추가]·[되돌리기] 쓰기 길은 지웠다(옛 자료는 지우지 않음). 줄 끝 ⋯ 에는 [이 종류 늘 빼기](서버 '빼는 회의 종류' 목록, journal.js toggleKind)만 남는다.
// 자리 하나의 그리기 주인은 이 모듈 하나(journal.js 는 자리만 찾아 부른다). 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.
import {HAND_TAG} from './weekly-hand.mjs';
import {validKindKey} from './journal-meeting-kinds.js';
import {shortDay} from './task-due.mjs';
import {rowMore} from './row-more.js';
import {emptyEl} from './wait-state.js';

const keyOf = item => (item.hand ? `hand:${item.hand}` : item.ref ?? '');

// slot: 자리, model: weeklySummary 결과(meetings).
export function paintDetailLines(slot, {model}) {
  if (!slot) return;
  const doc = slot.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const mt = model?.meetings;
  if (!mt || mt.loading) return;
  const ul = el('ul', 'journal-weekly-list'); ul.dataset.journalDetailList = '';
  for (const item of mt.items ?? []) {
    const key = keyOf(item), li = el('li'); li.dataset.journalDetailItem = key;
    if (item.kind) li.dataset.journalKindLine = item.kind;
    if (item.day) li.append(el('span', 'journal-weekly-day', shortDay(item.day)));
    li.append(el('span', 'weekly-flow-text', item.text));
    if (item.hand) { const tag = el('span', 'journal-exec-carried', HAND_TAG); tag.title = '손으로 더한 줄'; tag.dataset.journalDetailHand = ''; li.append(' ', tag); }
    if (item.edited) li.dataset.journalDetailEdited = '';
    // 그 회의 종류를 앞으로 늘 빼기(서버 '빼는 회의 종류' 목록, journal.js toggleKind) — 목록을 읽었을 때만. 옛 주 줄 자체는 바꾸지 않는다.
    if (mt.editable && validKindKey(item.kind)) li.append(rowMore(doc, {label:`줄 메뉴: ${item.text}`, data:{journalDetailMore:item.kind},
      items:[{text:'이 종류 늘 빼기', data:{journalKindToggle:item.kind, journalKindHide:'1', journalKindName:item.kindName}, aria:`${item.kindName} 종류를 주간보고에서 늘 빼기`}]}));
    ul.append(li);
  }
  slot.replaceChildren(ul.children.length ? ul : emptyEl('없음', {attrs:'data-journal-weekly-empty'}));
}
