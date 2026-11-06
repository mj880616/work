// S51-26 FAMILY-노트로(요청함 11/06 08:08, 명진 결정 08:26 '2'): 홈 '잊지 말기' [노트로]의 규칙. 화면·서버 호출 없이 node --test로 확인한다.
// - 노트는 기존 노트 저장(app_notes kind=note, 소유자 RLS) 그대로. 새 표·새 저장소 없음.
// - '잊지 말기' 노트 = metadata.family_list가 true인 노트. 한 폴더에 하나를 쓰고(가장 최근 것), 없으면 그 폴더에 새로 만든다.
// - 폴더 기억: 마지막으로 줄을 더한 '잊지 말기' 노트가 든 폴더가 다음 기본 폴더다(서버 노트 metadata — 기기 저장 없음, 새 화면 설정 칸 없음).
//   그런 노트가 없으면 맨 위 '가족' 폴더(없으면 보낼 때 만든다).
import {cleanDoc, DEFAULT_BODY} from './ed-schema.mjs';

export const FAMILY_FOLDER = '가족';
export const LIST_TITLE = '잊지 말기';
export const LIST_KEY = 'family_list';
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const metaOf = row => (plain(row?.metadata) ? row.metadata : {});
export const isListNote = row => metaOf(row)[LIST_KEY] === true;
// 노트가 든 폴더 id(폴더 밖이면 null). 이름만 적힌 옛 노트는 폴더 표에서 같은 이름의 맨 위 폴더로 본다.
export function folderIdOf(row, folders = []) {
  const meta = metaOf(row);
  if (typeof meta.folder_id === 'string' && folders.some(f => f.id === meta.folder_id)) return meta.folder_id;
  if (typeof meta.folder === 'string' && meta.folder) return (folders.find(f => !f.parent_id && f.name === meta.folder) || folders.find(f => f.name === meta.folder))?.id || null;
  return null;
}
// lists: '잊지 말기' 노트들(고친 때 최근 순). 고른 폴더(null = 폴더 밖)에 든 가장 최근 것, 없으면 null.
export function listNoteIn(lists, folderId, folders = []) {
  return (Array.isArray(lists) ? lists : []).filter(isListNote).find(r => folderIdOf(r, folders) === (folderId || null)) || null;
}
// 처음 고른 폴더: {folder: 폴더 표의 폴더 | null, create: '가족'을 새로 만들어야 하면 true}.
// ready=false(폴더 표를 못 읽음)면 폴더 밖(null).
export function defaultFolder(lists, folders, ready = true) {
  if (!ready) return {folder: null, create: false};
  const last = (Array.isArray(lists) ? lists : []).find(isListNote);
  if (last) {
    const id = folderIdOf(last, folders);
    return {folder: folders.find(f => f.id === id) || null, create: false};
  }
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
