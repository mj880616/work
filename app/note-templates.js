// S69-97 노트 서식(NOTE-에버노트 ③): 서식 읽기·저장·지우기와 고르기창.
// 내 서식은 서버 표 app_note_templates(주인만 읽고 쓰는 RLS, migration 20261125131000) — 기기 저장 없음. 기본 서식 셋은 코드(note-templates-model.mjs).
//   - 새 노트 창 제목 줄 [서식 ▾](note-window.js)·노트 목록 ⋯ [서식으로 새 노트]에서 골라 쓴다.
//   - 노트 ⋯ [서식으로 저장]: 그 노트 글을 이름을 붙여 저장한다(같은 이름이 있으면 바꿀지 묻는다).
//   - 표가 아직 없으면(DB 적용 전) 기본 서식만 보이고, 저장은 '아직 저장할 수 없어요'로 알린다.
import {askChoice, askConfirm, askText} from './small-notice.js';
import {cleanDoc} from './ed-schema.mjs';
import {BUILTIN_TEMPLATES, TEMPLATE_MAX, TEMPLATE_NAME_MAX, checkTemplateName, templateBody} from './note-templates-model.mjs';

const TABLE = '/rest/v1/app_note_templates';
function ws(rt) { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('업무 공간을 확인할 수 없어요.'); return id; }

export async function listTemplates({rt = window.KPTURuntime} = {}) {
  try {
    const rows = await rt.api(`${TABLE}?workspace_id=eq.${encodeURIComponent(ws(rt))}&select=id,name,doc,updated_at&order=name.asc&limit=${TEMPLATE_MAX}`);
    return {ok: true, rows: Array.isArray(rows) ? rows.filter(r => r?.id && typeof r.name === 'string' && cleanDoc(r.doc)) : []};
  } catch { return {ok: false, rows: []}; }
}

const conflict = e => e?.status === 409 || /23505|duplicate|중복/.test(String(e?.code || e?.message || ''));
// 반환: {ok:true, name} 또는 {ok:false, message} · 사람이 그만두면 null.
export async function saveAsTemplate(anchor, {name: first = '', doc, rt = window.KPTURuntime} = {}) {
  const body = templateBody({doc: cleanDoc(doc)});
  if (!(body.doc.content || []).length) return {ok: false, message: '빈 노트는 서식으로 저장할 수 없어요.'};
  const typed = await askText(anchor, {text: '서식 이름', value: String(first || '').trim().slice(0, TEMPLATE_NAME_MAX), ok: '저장', max: TEMPLATE_NAME_MAX, placeholder: '예: 회의록'});
  if (typed == null) return null;
  const name = String(typed).trim(), bad = checkTemplateName(name);
  if (bad) return {ok: false, message: bad};
  const have = await listTemplates({rt});
  if (!have.ok) return {ok: false, message: '서식을 아직 저장할 수 없어요. 잠시 뒤 다시 해 주세요.'};
  const same = have.rows.find(r => r.name === name);
  try {
    if (same) {
      if (!(await askConfirm(anchor, {text: `'${name}' 서식이 이미 있어요. 이 노트 글로 바꿀까요?`, ok: '바꾸기'}))) return null;
      await rt.api(`${TABLE}?id=eq.${encodeURIComponent(same.id)}&workspace_id=eq.${encodeURIComponent(ws(rt))}`, {method: 'PATCH', prefer: 'return=minimal', body: {doc: body, updated_at: new Date().toISOString()}});
    } else {
      if (have.rows.length >= TEMPLATE_MAX) return {ok: false, message: `서식은 ${TEMPLATE_MAX}개까지 저장할 수 있어요. 쓰지 않는 서식을 삭제해 주세요.`};
      await rt.api(TABLE, {method: 'POST', prefer: 'return=minimal', body: {workspace_id: ws(rt), name, doc: body}});
    }
    return {ok: true, name};
  } catch (e) {
    return {ok: false, message: conflict(e) ? `'${name}' 서식이 이미 있어요. 다른 이름으로 저장해 주세요.` : '서식을 저장하지 못했어요. 다시 해 주세요.'};
  }
}

// 고르기창: 기본 서식 + 내 서식(+ 내 서식이 있으면 맨 아래 [내 서식 삭제…]). 반환: {name, doc} 또는 null.
export async function pickTemplate(anchor, {rt = window.KPTURuntime} = {}) {
  const mine = await listTemplates({rt});
  for (;;) {
    const choices = [
      ...BUILTIN_TEMPLATES.map(t => ({value: 'b:' + t.key, label: t.name, note: '기본 서식'})),
      ...mine.rows.map(r => ({value: 'm:' + r.id, label: r.name, note: '내 서식'})),
      ...(mine.rows.length ? [{value: 'drop', label: '내 서식 삭제…', note: `${mine.rows.length}개`}] : []),
    ];
    const v = await askChoice(anchor, {text: '서식 선택', choices, foot: mine.ok ? '노트 ⋯ [서식으로 저장]으로 내 서식을 더할 수 있어요.' : '내 서식을 읽지 못해 기본 서식만 보여요.'});
    if (!v) return null;
    if (v.startsWith('b:')) { const t = BUILTIN_TEMPLATES.find(x => 'b:' + x.key === v); return t ? {name: t.name, doc: templateBody(t)} : null; }
    if (v.startsWith('m:')) { const r = mine.rows.find(x => 'm:' + x.id === v); return r ? {name: r.name, doc: templateBody(r)} : null; }
    const gone = await askChoice(anchor, {text: '삭제할 서식', choices: mine.rows.map(r => ({value: r.id, label: r.name, danger: true}))});
    if (!gone) continue;
    const row = mine.rows.find(r => r.id === gone);
    if (!row || !(await askConfirm(anchor, {text: `'${row.name}' 서식을 삭제할까요? 이 서식으로 만든 노트는 그대로예요.`, ok: '삭제', danger: true}))) continue;
    try { await rt.api(`${TABLE}?id=eq.${encodeURIComponent(row.id)}&workspace_id=eq.${encodeURIComponent(ws(rt))}`, {method: 'DELETE', prefer: 'return=minimal'}); mine.rows = mine.rows.filter(r => r.id !== row.id); }
    catch { mine.ok = false; }
  }
}
