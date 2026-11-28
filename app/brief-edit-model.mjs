// S70-27 BRIEF-손수정(명진 11/25 11:14 "브리핑 ai가 만든걸 수기 수정가능하게 / 여기 우클릭 안먹네"): 브리핑 손으로 고치기의 순수 계산. DOM·네트워크 없음.
// 저장: 표 app_document_briefs의 brief 칸(AI 원문)은 그대로, 고친 한 장은 edited 칸(서버 함수 app_document_brief_edit, DB 20261125143000).
// 보기는 edited가 있으면 그것, 없으면 brief. [원래 AI 글로 되돌리기] = edited를 비운다.
// 고치는 것: 요지 줄·소제목·소제목 아래 줄. 원문 인용은 '원문 그대로'라 고치지 않는다(고친 한 장에도 AI 인용을 그대로 옮긴다).
// 칸을 비우고 저장하면 그 줄은 빠진다(소제목을 비우면 제목 없는 묶음). 고친 한 장은 늘 새 모양(v3) — 옛 형식 브리핑도 고치면 새 모양으로 저장한다.
import { briefView } from './brief-room-model.mjs';

export const EDIT_LABEL = '수정';
export const REVERT_LABEL = '원래 AI 글로 되돌리기';
export const EDITED_TAG = '손으로 수정함';
export const LINE_MAX = 2000;
export const EDIT_BYTES = 60000; // DB 검사와 같은 크기(바이트)

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
/** 고친 한 장이 있는 행인가. */
export const isEdited = row => isObj(row?.edited);
/** 보일 한 장: 고친 것이 있으면 그것, 없으면 AI 원문. */
export const shownBrief = row => (isEdited(row) ? row.edited : row?.brief ?? null);

const clean = v => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LINE_MAX);

/**
 * 고치는 칸 목록(화면이 이 순서로 칸을 그린다). key: 'g:i' 요지 줄, 't:s' 소제목, 'i:s:j' 소제목 s의 줄 j.
 * @returns {{key:string, kind:'gist'|'title'|'item', text:string, section:number}[]}
 */
export function editFields(brief) {
  const v = briefView(brief), out = [];
  v.gist.forEach((text, i) => out.push({ key: `g:${i}`, kind: 'gist', text, section: -1 }));
  v.sections.forEach((sec, s) => {
    out.push({ key: `t:${s}`, kind: 'title', text: sec.title, section: s });
    sec.items.forEach((it, j) => out.push({ key: `i:${s}:${j}`, kind: 'item', text: it.text, section: s }));
  });
  return out;
}

/**
 * 고친 칸 값(values: Map 또는 {key: text})으로 새 한 장(v3)을 만든다. 바뀐 것이 없으면 null.
 * 쪽·'우리 관련' 표시·원문 인용·'앞부분만 읽음'은 그대로 옮긴다. 요지 첫 줄이 목록 한 줄 요지(lead)가 된다.
 */
export function applyEdits(brief, values) {
  const get = key => (values instanceof Map ? values.get(key) : values?.[key]);
  const v = briefView(brief);
  let changed = false;
  const pick = (key, old) => {
    const raw = get(key);
    if (raw === undefined) return old;
    const now = clean(raw);
    if (now !== old) changed = true;
    return now;
  };
  const gist = v.gist.map((t, i) => pick(`g:${i}`, t)).filter(Boolean);
  const sections = v.sections.map((sec, s) => ({
    title: pick(`t:${s}`, sec.title),
    items: sec.items.map((it, j) => ({ text: pick(`i:${s}:${j}`, it.text), page: it.page, ours: it.ours, ...(it.ref ? { ref: it.ref } : {}) })).filter(it => it.text),
  })).filter(sec => sec.items.length);
  // 옛 형식은 고치는 순간 새 모양으로 바뀌므로, 글이 같아도 저장할 것이 있다(바뀐 칸이 하나라도 있을 때만 저장한다 — 위 changed).
  if (!changed) return null;
  const b = isObj(brief) ? brief : {};
  const lead = gist[0] || (typeof b.lead === 'string' ? b.lead.trim() : '') || sections[0]?.items[0]?.text || '';
  const out = { v: 3, lead, gist, sections: sections.map(sec => ({ title: sec.title, items: sec.items.map(it => ({ text: it.text, page: it.page, ours: it.ours, ...(it.ref ? { ref: it.ref } : {}) })) })), quotes: v.quotes.map(q => ({ ...q })) };
  if (b.partial === 'preview') out.partial = 'preview';
  // BRIEF-품질올리기: '더 깊게' 칸(짜임·쟁점·불일치·배경 지식)은 고치는 칸이 아니라 그대로 옮긴다(손으로 고쳐도 사라지지 않게).
  if (v.plus) out.plus = structuredClone(v.plus);
  return out;
}

/** 서버가 받는 크기 안인가(DB 검사와 같은 바이트 수). */
export const fitsServer = edited => new TextEncoder().encode(JSON.stringify(edited)).length <= EDIT_BYTES;

// 다시 만들기 묻기(손으로 고친 브리핑만). 취소가 기본(덮지 않음) — askConfirm danger면 [취소]에 먼저 손이 간다.
export const REDO_ASK = Object.freeze({
  text: '손으로 수정한 브리핑이에요. 다시 만들까요?',
  note: 'AI가 새로 만든 글이 보이고, 수정한 글은 보이지 않게 돼요.',
  ok: '다시 만들기', danger: true,
});
export const REVERT_ASK = Object.freeze({
  text: '손으로 수정한 글 대신 AI가 만든 글로 되돌릴까요?',
  ok: '되돌리기', danger: true,
});

// 요약 글 위 오른쪽 클릭 메뉴(PC): [고치기] 다음에 고른 글 막대와 같은 항목(text-select-bar selectBarActs — 막대가 가진 목록 그대로).
/** @param {{id:string,label:string}[]} barActs 막대 항목 @param {boolean} canEdit */
export function lineMenuItems(barActs, canEdit) {
  const list = (Array.isArray(barActs) ? barActs : []).filter(a => a && a.id && a.label).map(a => ({ id: a.id, label: a.label }));
  return [...(canEdit ? [{ id: 'edit', label: EDIT_LABEL }] : []), ...list];
}
