// S51-26 FAMILY-노트로(요청함 11/06 08:08, 명진 결정 08:26 '2'): 홈 '잊지 말기' [노트로]의 규칙. 화면·서버 호출 없이 node --test로 확인한다.
// - 노트는 기존 노트 저장(app_notes kind=note, 소유자 RLS) 그대로. 새 표·새 저장소 없음.
// - '잊지 말기' 노트 = metadata.family_list가 true인 노트. 한 폴더에 하나를 쓰고(가장 최근 것), 없으면 그 폴더에 새로 만든다.
// - 폴더 기억: 마지막으로 줄을 더한 '잊지 말기' 노트가 든 폴더가 다음 기본 폴더다(서버 노트 metadata — 기기 저장 없음, 새 화면 설정 칸 없음).
//   그런 노트가 없으면 맨 위 '가족' 폴더(없으면 보낼 때 만든다).
// FORGET-업무노트(2026-11-28 사용자 결정 "가족 노트를 업무용으로 하나 더 만드는 거임"): 같은 '줄 모으는 노트'를 두 갈래로 쓴다(LISTS).
// - family: 위 그대로('잊지 말기' 노트, metadata.family_list, AI 제외, 처음 폴더 '가족'). 가족 줄은 이 노트에만 간다.
// - work: '업무 노트'(metadata.work_list, 일반 노트 — AI 설정을 건드리지 않음). 처음 한 번 사람이 폴더를 고르고(이름으로 정하지 않음),
//   그 뒤로는 그 노트가 든 폴더가 기억이다(서버 노트 metadata — 기기 저장·새 설정 칸·DB 변경 없음). 과거 기록은 metadata.work_past.
import {cleanDoc, DEFAULT_BODY} from './ed-schema.mjs';
import {PAST_KEY, PAST_TITLE} from './family-remind-model.mjs';

export const FAMILY_FOLDER = '가족';
export const LIST_TITLE = '잊지 말기';
export const LIST_KEY = 'family_list';
export const WORK_TITLE = '업무 노트';
export const LISTS = Object.freeze({
  family: Object.freeze({kind: 'family', listKey: LIST_KEY, pastKey: PAST_KEY, title: LIST_TITLE, pastTitle: PAST_TITLE, head: '가족 · 기억할 것', aiExcluded: true}),
  work: Object.freeze({kind: 'work', listKey: 'work_list', pastKey: 'work_past', title: WORK_TITLE, pastTitle: PAST_TITLE, head: '업무 · 기억할 것', aiExcluded: false}),
});
export const listSpec = kind => LISTS[kind] || LISTS.family;
// 두 노트 상자(family-remind.js)와 노트 화면이 다시 읽게 하는 알림 이름(줄을 더하거나 옮기거나 되돌리면 보낸다).
export const REMIND_CHANGED = 'kptu:family-remind-changed';
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const metaOf = row => (plain(row?.metadata) ? row.metadata : {});
export const isListNote = (row, kind = 'family') => metaOf(row)[listSpec(kind).listKey] === true;
// 노트가 어느 갈래의 줄 모으는 노트인지('family' | 'work' | '').
export const listKindOf = row => (isListNote(row, 'family') ? 'family' : isListNote(row, 'work') ? 'work' : '');
// 노트가 든 폴더 id(폴더 밖이면 null). 이름만 적힌 옛 노트는 폴더 표에서 같은 이름의 맨 위 폴더로 본다.
export function folderIdOf(row, folders = []) {
  const meta = metaOf(row);
  if (typeof meta.folder_id === 'string' && folders.some(f => f.id === meta.folder_id)) return meta.folder_id;
  if (typeof meta.folder === 'string' && meta.folder) return (folders.find(f => !f.parent_id && f.name === meta.folder) || folders.find(f => f.name === meta.folder))?.id || null;
  return null;
}
// lists: '잊지 말기' 노트들(고친 때 최근 순). 고른 폴더(null = 폴더 밖)에 든 가장 최근 것, 없으면 null.
export function listNoteIn(lists, folderId, folders = [], kind = 'family') {
  return (Array.isArray(lists) ? lists : []).filter(r => isListNote(r, kind)).find(r => folderIdOf(r, folders) === (folderId || null)) || null;
}
// 처음 고른 폴더: {folder: 폴더 표의 폴더 | null, create: '가족'을 새로 만들어야 하면 true, pick: 사람이 한 번 골라야 하면 true}.
// ready=false(폴더 표를 못 읽음)면 폴더 밖(null). 업무 노트가 아직 없으면 pick(이름으로 폴더를 정하지 않는다).
export function defaultFolder(lists, folders, ready = true, kind = 'family') {
  const last = (Array.isArray(lists) ? lists : []).find(r => isListNote(r, kind));
  if (last && ready) {
    const id = folderIdOf(last, folders);
    return {folder: folders.find(f => f.id === id) || null, create: false};
  }
  if (kind === 'work') return last ? {folder: null, create: false} : {folder: null, create: false, pick: true};
  if (!ready) return {folder: null, create: false};
  const family = folders.find(f => !f.parent_id && f.name === FAMILY_FOLDER);
  return family ? {folder: family, create: false} : {folder: null, create: true};
}
// 새 맨 위 폴더의 순서 값: 지금 맨 위 폴더들 뒤.
export const nextTopOrder = folders => Math.max(-1, ...folders.filter(f => !f.parent_id).map(f => (Number.isFinite(f.sort_order) ? f.sort_order : 0))) + 1;
const para = text => ({type: 'paragraph', attrs: {style: DEFAULT_BODY}, content: text ? [{type: 'text', text}] : []});
const isBlank = node => node?.type === 'paragraph' && !(node.content || []).length;
// 저장된 모양(ed1) 끝에 줄을 한 문단씩 더한다. 끝의 빈 문단은 걷어 낸다(빈 노트·마지막 빈 줄).
export function appendLines(doc, lines) {
  const base = cleanDoc(doc) || cleanDoc({type: 'doc', content: []});
  const content = [...base.doc.content];
  while (content.length && isBlank(content[content.length - 1])) content.pop();
  for (const line of lines) content.push(para(line));
  return cleanDoc({type: 'doc', content});
}
// FORGET-업무노트: 잊지 말기 줄을 노트 맨 아래 한 줄로 — 가족 줄의 노트 한 줄(noteLine)과 같은 체크 목록 모양 '☐ 내용 (꼬리)'.
// 줄바꿈은 띄어쓰기로(한 줄 = 한 문단, 기억할 것 상자가 줄 하나로 본다), 300자 안쪽.
export function listLine(text, tail = '') {
  const one = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const body = one(text), end = one(tail);
  return body ? [...`☐ ${body}${end ? ` (${end})` : ''}`].slice(0, 300).join('') : '';
}
// [새 노트]의 제목: 그 줄 내용 앞 40자.
export const newNoteTitle = body => [...String(body || '').replace(/\s+/g, ' ').trim()].slice(0, 40).join('') || LIST_TITLE;

// S51-30 [이미 함]: 되돌리기 때 더했던 줄 하나를 뺀다. 끝에서부터 그 글과 똑같은 문단 하나만. 없으면 null(아무것도 안 씀).
const textOf = node => (node?.content || []).map(c => (typeof c?.text === 'string' ? c.text : '')).join('');
export function dropLine(doc, line) {
  const base = cleanDoc(doc);
  if (!base) return null;
  const content = [...base.doc.content];
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i]?.type === 'paragraph' && textOf(content[i]) === line) {
      content.splice(i, 1);
      return cleanDoc({type: 'doc', content});
    }
  }
  return null;
}

// FORGET-노트고르기(요청함 11/09 13:34, 시안 docs/design/mockups/forget-note-pick.html): 노트 창에서 고친 글(저장된 모양 ed1)을 노트 끝에 문단으로 더한다.
// 노트의 다른 내용은 그대로, 노트 끝·더할 글 앞뒤의 빈 문단은 걷어 내고, 더할 글 안의 빈 줄도 빼서 촘촘히 붙인다. 더할 글이 비면 null(아무것도 안 씀).
export function appendDoc(doc, add) {
  const base = cleanDoc(doc) || cleanDoc({type: 'doc', content: []});
  const more = (cleanDoc(add)?.doc?.content || []).filter(node => !isBlank(node));
  if (!more.length) return null;
  const content = [...base.doc.content];
  while (content.length && isBlank(content[content.length - 1])) content.pop();
  return cleanDoc({type: 'doc', content: [...content, ...more]});
}
