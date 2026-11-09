// FORGET-노트고르기(요청함 11/09 13:34): 노트 끝에 더하기 한 길. 옛 family-note-send.js appendTo를 옮겨 와 가족 줄([노트]·[이미 함])과
// 업무 줄(잊지 말기 [노트] 창에서 기존 노트를 고름)이 같이 쓴다(note-pick.js ↔ family-note-send.js 순환 참조를 피하려 따로 둠).
// 기존 노트 저장 길(basket-data.js saveNoteDoc, app_notes 소유자 RLS)만 쓰고, 읽은 판(updated_at)이 그대로일 때만 저장한다(한 번 다시 읽어 다시 시도).
import {saveNoteDoc, noteTitleFromText} from './basket-data.js';
import {toPlain} from './ed-text.mjs';
import {cleanDoc} from './ed-schema.mjs';
import {plainToDocKeep} from './ed-markdown.mjs';
import {LIST_TITLE, appendDoc, appendLines} from './family-note-send.mjs';

const enc = encodeURIComponent;
const wsOf = rt => rt.context?.read?.()?.workspace?.id || '';
export const FAMILY_ONLY_TEXT = '가족 줄은 가족 노트(AI가 읽지 않는 노트)에만 넣을 수 있어요.';

// 노트 끝에 더하기(가족 줄·업무 줄 같은 길). lines: 글 줄들(문단 하나씩) 또는 doc: 노트 창에서 고친 글(저장된 모양).
// familyOnly(기본): 가족 노트(ai_export_allowed=false)에만 쓴다 — 읽은 행을 보고, PATCH도 그런 행에만 적용(saveNoteDoc aiExcluded).
// 업무 줄(familyOnly=false)은 노트의 AI 설정을 바꾸지 않고 그대로 더한다(가족 노트에 더하면 그 글도 AI가 읽지 않는다).
export async function appendToNote(rt, id, {lines = [], doc = null, familyOnly = true} = {}) {
  const ws = wsOf(rt);
  for (let tries = 0; tries < 2; tries++) {
    const rows = await rt.api(`/rest/v1/app_notes?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}&kind=eq.note&select=id,title,doc,raw_text,updated_at,ai_export_allowed`, {singleFlight: false});
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row?.updated_at) throw new Error('노트를 찾지 못했어요.');
    if (familyOnly && row.ai_export_allowed !== false) throw Object.assign(new Error(FAMILY_ONLY_TEXT), {code: 'not_family_note'});
    const base = cleanDoc(row.doc) || plainToDocKeep(row.raw_text || '');
    const next = doc ? appendDoc(base, doc) : appendLines(base, lines);
    if (!next) throw new Error('더할 내용을 써 주세요.');
    const raw = toPlain(next);
    try {
      await saveNoteDoc(id, {title: String(row.title || '').trim() || (familyOnly ? LIST_TITLE : noteTitleFromText(raw) || '노트'), raw_text: raw, doc: next, version: row.updated_at, aiExcluded: familyOnly}, rt);
      return;
    } catch (error) {
      if (error?.code !== 'note_changed' || tries) throw error;
    }
  }
}
