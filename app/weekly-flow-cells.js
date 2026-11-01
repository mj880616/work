// WEEKLY-한흐름확정 ② 화면(docs/design/weekly-one-flow.md 4.1절, 시안 안 B): [주간 정리] 2. 1) 요약 · 3. 2) 투쟁 사업장 현황 · 4. 산하 조직 현황의
// '보고서 칸'을 그 주 임시저장(draft) 한 벌에서 그린다. 보이는 줄 = 한글 파일에 들어갈 줄(weekly-draft-store.js weekCells: 바탕 proposed 위에 고친 rows).
// - 줄 끝 작은 ⋯ → [고치기]·[빼기], 칸 이름 줄 오른쪽 작은 [+ 추가], 칸 아래 흐린 '제안'(이번 주 기록·자료·조직 AI 요약·캘린더 추천) → [수용]·⋯([고쳐서 수용]·[빼기]).
// - 누름 한 번 = 서버 쓰기 한 번(changeWeekCell: rows + picks 를 한 PATCH). 실패하면 그 칸에 "저장 못 함 [다시]", 화면 값은 그대로.
// - 투쟁 사업장 칸 구성(이번 주 보고에서 빼기·다시 넣기)은 draft.site_layout(없으면 지난주 구성을 이어 씀)에 쓴다.
// - 제안 거르기·학습 열쇠는 한글 파일 상자와 같다(weekly-picks.mjs sortPicks, 칸 이름 'section:key#n', 캘린더 추천 'orgref:조직 id').
// - 칸 하나의 그리기 주인은 이 모듈 하나(journal.js는 자리만 주고 다시 그릴 때 부른다). AI 를 부르지 않는다. 브라우저 저장소에 아무것도 두지 않는다.
import {weekCells, parseCellId, changeWeekCell, changeWeekDocs, withSiteLayout, draftSiteLayout, readCarriedLayout, lineDone, lineKey, CELL_LINE_MAX} from './weekly-draft-store.js';
import {sortPicks, droppedOf, keptOf, pickKey} from './weekly-picks.mjs';
import {learnFor} from './weekly-picks.js';
import {arrangeSites, siteHidden, siteShown, siteKey} from './weekly-schedule-rows.mjs';
import {readProposed} from './weekly-feedback.mjs';
import {matchOrg} from './org-name-match.mjs';
import {reportLine as orgRefLine, alreadyIn as orgRefIn} from './calendar-ref-model.mjs';
import {rowMore} from './row-more.js';
import {shortDay} from './journal-data.js';
import {emptyEl} from './wait-state.js';

export const FLOW_SECTIONS = Object.freeze(['summary', 'sites', 'orgs']);
const TAG = Object.freeze({record:'기록', doc:'자료', ai:'AI 요약', calendar:'캘린더'});
const UNDO_MS = 5000;
// 화면 상태(기기 메모리만): 고치는 줄·더하는 칸·고쳐서 수용하는 제안·쓰는 중·실패·되돌리기.
const uiOf = new WeakMap();
const freshUi = start => ({start, editing:null, adding:null, taking:null, busy:'', failed:null, undo:null, carried:{start:'', status:'', layout:null}, mat:null, matFlight:null});

const lineOf = s => String(s ?? '').replace(/^\s*-\s*/, '').trim();
const strip = s => lineOf(s).replace(/\s+/g, '').toLowerCase();
const cellName = (section, key, n) => `${section}:${key}${n ? `#${n}` : ''}`;
const labelOf = (section, key, n) => `${section === 'summary' ? key.split('›').map(x => x || '—').join(' › ') : key}${n ? ` (${n + 1}번째)` : ''}`;

// 그 주 draft 의 칸 목록(바탕 순서, 고친 칸만 있는 칸은 뒤에). [{id, section, key, n, lines}]
export function flowCells(draft, section) {
  const out = [];
  for (const [id, lines] of weekCells(draft)) { const c = parseCellId(id); if (c.section === section) out.push({id, ...c, lines:lines.filter(l => String(l).trim())}); }
  return out;
}
// 칸 줄 + 이번 주 재료 → 칸마다 제안(draft.mjs weekMaterial 과 같은 이름 맞춤). 이미 칸에 든 글은 빼다.
export function flowMaterial(weekMaterial, model, draft) {
  const summary = flowCells(draft, 'summary'), orgs = flowCells(draft, 'orgs');
  const rows = summary.map((c, index) => { const [area, task = ''] = c.key.split('›'); return {index, area, task}; });
  const orgRows = orgs.map((c, index) => ({index, org:c.key}));
  const m = weekMaterial(model, rows, orgRows, {});
  const out = new Map();
  const put = (cell, list) => { const have = new Set(cell.lines.map(strip)); out.set(cell.id, list.filter(x => !have.has(strip(x.text)))); };
  summary.forEach((c, i) => put(c, m.byRow.get(i) ?? []));
  orgs.forEach((c, i) => put(c, m.byOrg.get(i) ?? []));
  // CAL-조직참고캘린더: 내 프로필에서 고른 조직 칸에만 캘린더 추천(상자 rawMaterial 과 같은 줄·같은 열쇠).
  const refs = model?.orgRefs, section = refs?.org ? (model?.orgs?.sections ?? []).find(s => s.id === refs.org) : null;
  if (section && refs.items?.length) {
    const cell = orgs.find(c => matchOrg(c.key, [{id:section.id, name:section.name, aliases:[]}]));
    if (cell) out.set(cell.id, [...(out.get(cell.id) ?? []), ...refs.items.filter(item => !orgRefIn(cell.lines, item)).map(item => ({day:'', text:orgRefLine(item), orgRef:true, orgId:section.id, src:'calendar'}))]);
  }
  return out;
}
const describe = (c) => x => ({kind:x.orgRef ? 'calendar' : 'material', from:x.src ?? (x.summary ? 'ai' : 'record'), cell:x.orgRef ? `orgref:${x.orgId}` : cellName(c.section, c.key, c.n),
  org:c.section === 'summary' ? '' : x.from ?? '', text:`${x.day ? `${shortDay(x.day)} ` : ''}${lineOf(x.text)}`});

// slot: 그 칸 묶음 자리. ctx = {section, start, row(그 주 행 {exists, draft, saved_at} | null), status('ok'|'loading'|'missing'|'failed'),
//   model(weeklySummary), rt, onSaved(row), redraw(), prepare(): 바탕을 여는 쪽(상자) 깨우기, preparing: 바탕 여는 중}
export function paintFlowCells(slot, ctx) {
  if (!slot) return;
  const doc = slot.ownerDocument, root = slot.closest('[data-journal-weekly-root]') ?? slot.closest('.journal-weekly-body') ?? slot;
  let ui = uiOf.get(root);
  if (!ui || ui.start !== ctx.start) { ui = freshUi(ctx.start); uiOf.set(root, ui); }
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; Object.assign(b.dataset, data); return b; };
  const {section, row} = ctx, draft = row?.draft ?? null, proposed = readProposed(draft?.proposed);
  slot.dataset.flowSection = section;
  if (ctx.status === 'loading') { slot.replaceChildren(emptyEl('불러오는 중', {attrs:'data-flow-wait'})); return; }
  if (ctx.status === 'missing') { slot.replaceChildren(el('p', 'journal-muted', '임시저장 칸이 아직 준비 전이에요. 칸 줄은 한글 파일을 만들 때 바탕 그대로 들어가요.')); return; }
  if (ctx.status === 'failed') { const p = el('p', 'wait-fail journal-failed', '그 주 임시저장을 불러오지 못했어요. '); p.append(btn('다시', {flowReload:''}, 'wait-retry')); slot.replaceChildren(p); return; }
  let cells = flowCells(draft, section);
  if (!proposed && !cells.length) {
    // 그 주 처음: 바탕(지난주 개인본, 없으면 팀 확정본)을 한 번 열어 칸을 만든다(상자가 연다 — 한 번 열면 그다음은 draft 만 읽음).
    const p = el('p', 'journal-muted', ctx.baseNote || '바탕을 여는 중이에요.'); p.dataset.flowNoBase = '';
    slot.replaceChildren(p); ctx.prepare?.(); return;
  }
  // 투쟁 사업장: 구성(이번 주 것, 없으면 지난주 구성)대로 들어간 사업장만, 뺀 사업장은 접힌 한 줄.
  let hiddenSites = [];
  if (section === 'sites') {
    const own = draftSiteLayout(draft);
    if (!own && ui.carried.start !== ctx.start) {
      ui.carried = {start:ctx.start, status:'loading', layout:null};
      readCarriedLayout(ctx.start, ctx.rt).then(l => { if (ui.carried.start === ctx.start) { ui.carried = {start:ctx.start, status:'ok', layout:l}; ctx.redraw?.(); } });
    }
    const layout = own ?? ui.carried.layout, rows = cells.map((c, index) => ({index, org:c.key}));
    const {shown, hidden} = arrangeSites(rows, layout);
    hiddenSites = hidden.map(r => cells[r.index]);
    cells = shown.map(r => cells[r.index]);
  }
  // 제안 재료(draft.mjs weekMaterial — 무거워서 처음 쓸 때 한 번 가져옴).
  if (section !== 'sites' && !ui.mat && !ui.matFlight) ui.matFlight = import('./weekly-hwpx/draft.mjs').then(m => { ui.mat = m.weekMaterial; ui.matFlight = null; ctx.redraw?.(); }, () => { ui.matFlight = null; });
  const material = section !== 'sites' && ui.mat && ctx.model ? flowMaterial(ui.mat, ctx.model, draft) : new Map();
  const picks = draft?.picks ?? null;
  const opts = {dropped:droppedOf(picks), kept:keptOf(picks), learn:learnFor(ctx.start, picks, {rt:ctx.rt, redraw:ctx.redraw}).learn};
  const parts = [];
  for (const c of cells) parts.push(cellBox(c, material.get(c.id) ?? []));
  if (!cells.length) parts.push(emptyEl(section === 'sites' ? '넣은 사업장이 없어요' : '내 칸이 없어요'));
  if (hiddenSites.length) {
    const fold = el('details', 'journal-org-raw weekly-flow-hidden'); fold.dataset.flowHiddenSites = String(hiddenSites.length);
    fold.append(el('summary', null, `이번 주 보고에서 뺀 사업장 ${hiddenSites.length}`));
    const ul = el('ul', 'weekly-flow-lines');
    for (const c of hiddenSites) { const li = el('li'); li.append(el('span', 'weekly-flow-text', c.key), ' ', btn('다시 넣기', {flowSiteShow:c.key})); ul.append(li); }
    fold.append(ul); parts.push(fold);
  }
  slot.replaceChildren(...parts);
  if (!slot.dataset.flowWired) wire();

  function cellBox(c, list) {
    const box = el('div', 'weekly-flow-cell'); box.dataset.flowCell = c.id;
    const head = el('div', 'weekly-flow-name');
    const name = el('span', 'weekly-flow-label');
    if (section === 'summary') { const [area, task] = c.key.split('›'); name.append(el('b', null, area || '—'), ` › ${task || '—'}${c.n ? ` (${c.n + 1}번째)` : ''}`); }
    else name.append(el('b', null, labelOf(section, c.key, c.n)));
    head.append(name);
    const busy = !!ui.busy;
    const add = btn('+ 추가', {flowAdd:c.id}, 'journal-part-add-button'); add.disabled = busy; add.setAttribute('aria-label', `${labelOf(section, c.key, c.n)} 칸에 줄 추가`);
    head.append(add);
    if (section === 'sites') head.append(rowMore(doc, {label:`${c.key} 사업장 칸 메뉴`, data:{flowSiteMore:c.key}, items:[{text:'이번 주 보고에서 빼기', data:{flowSiteHide:c.key}, disabled:busy}]}));
    box.append(head);
    const ul = el('ul', 'weekly-flow-lines');
    c.lines.forEach((text, i) => {
      const li = el('li'); li.dataset.flowLine = String(i);
      if (ui.editing?.cell === c.id && ui.editing.index === i) { li.append(editForm(c.id, ui.editing.value ?? text, {flowFixSave:c.id}, '줄 고치기')); ul.append(li); return; }
      li.append(el('span', 'weekly-flow-text', text));
      li.append(rowMore(doc, {label:`줄 고치기·빼기: ${text}`, data:{flowLineMore:''}, items:[
        {text:'고치기', data:{flowFix:c.id, flowIndex:String(i)}, disabled:busy},
        {text:'빼기', data:{flowCut:c.id, flowIndex:String(i)}, disabled:busy, danger:true, aria:`이번 주 보고에서 빼기: ${text}`}]}));
      ul.append(li);
    });
    if (!c.lines.length) { const li = el('li', 'weekly-flow-empty', '빈 칸'); li.dataset.flowEmpty = ''; ul.append(li); }
    if (ui.adding === c.id) { const li = el('li'); li.append(editForm(c.id, ui.addValue ?? '', {flowAddSave:c.id}, '줄 추가')); ul.append(li); }
    box.append(ul);
    // 제안: 받은 종류부터, 뺀 것은 접힌 '뺀 제안 n개'에서 다시 넣기.
    const sorted = sortPicks(list, describe(c), opts);
    if (sorted.shown.length) {
      const sg = el('ul', 'weekly-flow-lines weekly-flow-suggest'); sg.dataset.flowSuggest = c.id;
      for (const x of sorted.shown) {
        const item = {kind:x.kind, from:x.from, cell:x.cell, org:x.org, text:x.text, key:x.key}, text = x.raw.text.startsWith('-') ? x.raw.text : `- ${lineOf(x.raw.text)}`;
        const li = el('li'); li.dataset.flowSuggestItem = x.key; li.dataset.flowPick = JSON.stringify(item); li.dataset.flowText = text;
        if (ui.taking?.key === x.key) { li.append(editForm(c.id, ui.taking.value ?? text, {flowEditSave:c.id}, '고쳐서 수용')); sg.append(li); continue; }
        li.append(el('span', 'weekly-flow-tag', TAG[x.raw.orgRef ? 'calendar' : x.from] ?? '기록'), el('span', 'weekly-flow-text', x.text));
        const take = btn('수용', {flowTake:c.id}, 'mini weekly-flow-take'); take.disabled = busy; take.setAttribute('aria-label', `수용: ${x.text}`);
        li.append(take, rowMore(doc, {label:`제안 고쳐서 수용·빼기: ${x.text}`, data:{flowSuggestMore:''}, items:[
          {text:'고쳐서 수용', data:{flowEdit:c.id}, disabled:busy}, {text:'빼기', data:{flowDrop:c.id}, disabled:busy, danger:true, aria:`제안 빼기: ${x.text}`}]}));
        sg.append(li);
      }
      box.append(sg);
    }
    if (sorted.gone.length) {
      const fold = el('details', 'journal-org-raw weekly-flow-gone'); fold.dataset.flowGone = String(sorted.gone.length);
      fold.append(el('summary', null, `뺀 제안 ${sorted.gone.length}`));
      const gl = el('ul', 'weekly-flow-lines');
      for (const g of sorted.gone) { const li = el('li'); li.dataset.flowPick = JSON.stringify({kind:g.kind, from:g.from, cell:g.cell, org:g.org, text:g.text, key:g.key}); li.append(el('span', 'weekly-flow-text', g.text), ' ', btn('다시 넣기', {flowPut:c.id})); gl.append(li); }
      fold.append(gl); box.append(fold);
    }
    if (ui.undo?.cell === c.id) { const p = el('p', 'journal-line-status'); p.dataset.flowUndo = ''; p.setAttribute('role', 'status'); p.append('줄을 뺐어요 ', btn('되돌리기', {flowUndo:c.id})); box.append(p); }
    if (ui.failed?.cell === c.id) { const p = el('p', 'journal-line-status journal-failed', `저장 못 함 — ${ui.failed.text} `); p.dataset.flowFailed = ''; p.setAttribute('role', 'alert'); p.append(btn('다시', {flowRetry:c.id})); box.append(p); }
    return box;
  }
  function editForm(cell, value, data, aria) {
    const f = el('span', 'journal-file-edit weekly-flow-edit');
    const input = el('input'); input.type = 'text'; input.value = value; input.maxLength = CELL_LINE_MAX; input.dataset.flowInput = cell; input.setAttribute('aria-label', aria); input.disabled = !!ui.busy;
    const cancel = btn('취소', {flowCancel:cell}); const save = btn('저장', data, 'mini primary'); cancel.disabled = save.disabled = !!ui.busy;
    f.append(input, ' ', cancel, save); // UI-저장자리: [취소] 왼쪽, [저장] 맨 오른쪽
    return f;
  }
  function wire() {
    slot.dataset.flowWired = '1';
    slot.addEventListener('click', event => {
      const b = event.target.closest('button');
      if (!b || b.disabled || !slot.contains(b)) return;
      const cur = slot.__flow; if (!cur) return;
      cur.click(b);
    });
    slot.addEventListener('keydown', event => {
      const input = event.target.closest?.('input[data-flow-input]');
      if (!input) return;
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); input.parentElement.querySelector('button.primary')?.click(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.parentElement.querySelector('[data-flow-cancel]')?.click(); }
    });
    slot.addEventListener('input', event => {
      const input = event.target.closest?.('input[data-flow-input]'), cur = slot.__flow;
      if (!input || !cur) return;
      const u = cur.ui;
      if (u.editing?.cell === input.dataset.flowInput) u.editing.value = input.value;
      else if (u.adding === input.dataset.flowInput) u.addValue = input.value;
      else if (u.taking) u.taking.value = input.value;
    });
  }
  // 누르기 처리는 이번 그림의 ctx 로(그릴 때마다 바꿔 끼움).
  slot.__flow = {ui, click:b => onClick(b)};
  const focusInput = id => requestAnimationFrame(() => slot.querySelector(`input[data-flow-input="${CSS.escape(id)}"]`)?.focus());
  function cellOf(id) { const c = parseCellId(id); return {section:c.section, key:c.key, n:c.n, lines:flowCells(draft, c.section).find(x => x.id === id)?.lines ?? []}; }
  async function write(id, op, {after} = {}) {
    const c = cellOf(id);
    ui.busy = id; ui.failed = null; ctx.redraw?.();
    try {
      const r = op.site ? await changeWeekDocs({start:ctx.start, known:row, change:op.site}, ctx.rt) : await changeWeekCell({start:ctx.start, known:row, section:c.section, key:c.key, n:c.n, ...op}, ctx.rt);
      ui.busy = '';
      if (r.missing) { ui.failed = {cell:id, text:'임시저장 칸이 아직 준비 전이에요.', op}; ctx.redraw?.(); return; }
      after?.(r.row);
      ctx.onSaved?.(r.row);
    } catch (error) {
      ui.busy = ''; ui.failed = {cell:id, text:/[가-힣]/.test(error?.message ?? '') ? error.message : '잠시 뒤 다시 눌러 주세요.', op};
      ctx.redraw?.();
    }
  }
  function onClick(b) {
    const d = b.dataset, li = b.closest('li'), pick = () => JSON.parse(li?.dataset.flowPick || 'null');
    if (d.flowReload !== undefined) { ctx.reload?.(); return; }
    if (d.flowCancel !== undefined) { ui.editing = null; ui.adding = null; ui.addValue = ''; ui.taking = null; ctx.redraw?.(); return; }
    if (d.flowFix) { ui.editing = {cell:d.flowFix, index:Number(d.flowIndex), value:null}; ui.adding = null; ui.taking = null; ctx.redraw?.(); focusInput(d.flowFix); return; }
    if (d.flowAdd) { ui.adding = d.flowAdd; ui.addValue = ''; ui.editing = null; ui.taking = null; ctx.redraw?.(); focusInput(d.flowAdd); return; }
    if (d.flowEdit) { const it = pick(); ui.taking = {cell:d.flowEdit, key:it.key, value:null}; ui.editing = null; ui.adding = null; ctx.redraw?.(); focusInput(d.flowEdit); return; }
    const value = () => String(b.parentElement.querySelector('input[data-flow-input]')?.value ?? '').trim();
    if (d.flowFixSave) { const v = value(); if (!v) return; const index = ui.editing.index; void write(d.flowFixSave, {act:'fix', index, text:v}, {after:() => { ui.editing = null; }}); return; }
    if (d.flowAddSave) { const v = value(); if (!v) return; void write(d.flowAddSave, {act:'add', text:v.startsWith('-') ? v : `- ${v}`}, {after:() => { ui.adding = null; ui.addValue = ''; }}); return; }
    if (d.flowEditSave) { const v = value(); if (!v) return; const it = pick(); void write(d.flowEditSave, {act:'edit', text:v.startsWith('-') ? v : `- ${v}`, item:it}, {after:() => { ui.taking = null; }}); return; }
    if (d.flowTake) { void write(d.flowTake, {act:'take', text:li.dataset.flowText, item:pick()}); return; }
    if (d.flowDrop) { void write(d.flowDrop, {act:'drop', item:pick()}); return; }
    if (d.flowPut) { void write(d.flowPut, {act:'none', item:pick()}); return; }
    if (d.flowCut) {
      const id = d.flowCut, index = Number(d.flowIndex), before = cellOf(id).lines, text = before[index];
      const c = cellOf(id);
      void write(id, {act:'cut', index}, {after:next => {
        clearTimeout(ui.undo?.timer);
        ui.undo = {cell:id, lines:before, key:lineKey({section:c.section, key:c.key, n:c.n, text}), timer:setTimeout(() => { if (ui.undo?.cell === id) { ui.undo = null; ctx.redraw?.(); } }, UNDO_MS)};
        ui.undo.item = lineDone(next?.draft, ui.undo.key);
      }});
      return;
    }
    if (d.flowUndo) { const u = ui.undo; if (!u) return; clearTimeout(u.timer); ui.undo = null; void write(d.flowUndo, {act:'none', lines:u.lines, item:u.item}); return; }
    if (d.flowRetry) { const f = ui.failed; if (f?.op) void write(f.cell, f.op); return; }
    if (d.flowSiteHide !== undefined || d.flowSiteShow !== undefined) {
      const name = d.flowSiteHide ?? d.flowSiteShow, all = flowCells(draft, 'sites'), rows = all.map((c, index) => ({index, org:c.key}));
      const layout = draftSiteLayout(draft) ?? ui.carried.layout, at = new Date().toISOString();
      const next = d.flowSiteHide !== undefined ? siteHidden(rows, layout, name, at) : siteShown(rows, layout, name, at);
      const id = all.find(c => siteKey(c.key) === siteKey(name))?.id ?? '';
      void write(id, {site:dr => withSiteLayout(dr, next)});
    }
  }
}
export {pickKey};
