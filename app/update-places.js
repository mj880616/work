// BASKET-업데이트통합: where an "업데이트" goes, in one place for the home input and the shared write window (write-window.js).
// No place → a basket note (미분류); an organization → that organization's record; a project → that project's progress record.
// Every save is an existing owner-RLS path (createNote, saveOrganizationUpdate, saveProjectProgress); nothing new is written here.
// UPD-여러곳고르기: several places can be chosen at once (an array; empty is the basket). Two or more → one basket update linked
// to every chosen place through the basket's own [연결하기] path (app_basket_confirm_links: owner RLS, INVOKER, 1~20 places, all
// or none), so the update is one original shown in each place's records, as a linked basket update already is.
import { createNote, readBasketNote, attachNoteDoc } from './basket-data.js';
import { uploadBatch } from './basket-upload.js';
import { putFilesIntoTargets } from './basket-file-docs.js';
import { saveOrganizationUpdate, saveProjectProgress } from './quick-save.js';
import { projectRows, projectRow, orgGroupRows, orgRow } from './choice-sheet.js';
import { confirmLinks } from './basket-classification.js';
import { readReferenceBundles } from './reference-bundles-data.js';

// place: null (basket) | {kind:'organization'|'project'|'reference', id}
// REF-참고묶음: 'reference' is a reference bundle (app_reference_bundles). It has no record table of its own, so an update for it is
// always a basket update linked to the bundle (saveUpdate below), never a report record.
export const BASKET = null;
export const placeValue = place => !place ? 'basket' : place.kind === 'project' ? 'project:' + place.id : place.kind === 'reference' ? 'reference:' + place.id : place.id;
export function placeFromValue(value) {
  if (!value || value === 'basket') return BASKET;
  if (value.startsWith('project:')) return {kind:'project', id:value.slice(8)};
  if (value.startsWith('reference:')) return {kind:'reference', id:value.slice(10)};
  return {kind:'organization', id:value};
}
export const samePlace = (a, b) => placeValue(a) === placeValue(b);
export const PLACE_LIMIT = 20; // app_basket_confirm_links takes 1~20 places
// A list of chosen places (no basket value, no repeats) from any mix of values, places and null.
export function placeList(chosen) {
  const out = [];
  for (const item of Array.isArray(chosen) ? chosen : chosen ? [chosen] : []) {
    const place = typeof item === 'string' ? placeFromValue(item) : item;
    if (place && !out.some(p => samePlace(p, place))) out.push({kind:place.kind, id:place.id});
  }
  return out;
}
export const samePlaces = (a, b) => { const x = placeList(a), y = placeList(b); return x.length === y.length && x.every((p, i) => samePlace(p, y[i])); };
// Pending choice of the 기록할 곳 sheet: [바구니(미분류)] and the other places never go together; a press toggles.
// Returns the next list, or null when it would pass the limit.
export function togglePlace(chosen, value) {
  const list = placeList(chosen);
  if (!value || value === 'basket') return [];
  const place = placeFromValue(value), at = list.findIndex(p => samePlace(p, place));
  if (at >= 0) return list.filter((_, i) => i !== at);
  return list.length >= PLACE_LIMIT ? null : [...list, place];
}
export const choiceCountText = chosen => { const n = placeList(chosen).length; return n ? `${n}곳 선택됨` : '정리함(미분류) 선택됨'; };

// sources: {projects(), orgs(), assignments(), bundles()?} — the home passes its shared reads; the write window reads them itself.
// Returns {projects:[tree rows of active projects], orgs:{recent, groups}, bundles:[reference bundles]} with the three most recent
// organizations first. REF-참고묶음: the bundles are read here when the sources have none (owner RLS); a failed read only means
// the 참고 block is not offered, so the organizations and projects can still be chosen.
export async function readPlaces(sources, {rt = window.KPTURuntime, isCurrent = () => true} = {}) {
  const bundleRead = (sources.bundles ? sources.bundles() : readReferenceBundles(rt)).catch(() => []);
  const [ps, os, as, bs] = await Promise.all([sources.projects(), sources.orgs(), sources.assignments(), bundleRead]);
  if (!isCurrent()) return null;
  const ctx = rt.context.read(), order = window.KPTUOrganizationOrder;
  const eligible = order.forPicker(os.filter(o => as.some(a => a.organization_id === o.id)));
  const recent = [], recentIds = new Set(), eligibleIds = new Set(eligible.map(o => o.id));
  // Page older records until three distinct organizations are found; one busy organization must not hide the others.
  for (let offset = 0; eligible.length && recentIds.size < Math.min(3, eligible.length); offset += 100) {
    const rows = await rt.api(`/rest/v1/app_suborganization_updates?created_by=eq.${encodeURIComponent(ctx.user.id)}&organization_id=in.(${eligible.map(o => encodeURIComponent(o.id)).join(',')})&select=organization_id,occurred_at&order=occurred_at.desc,id.desc&limit=100&offset=${offset}`);
    if (!isCurrent()) return null;
    recent.push(...rows); rows.forEach(r => { if (eligibleIds.has(r.organization_id)) recentIds.add(r.organization_id); });
    if (rows.length < 100) break;
  }
  if (!isCurrent()) return null;
  // PRJ-3단: each row also carries its parents' names ("1단 › 2단"), shown on third-level rows while searching (choice-sheet.js).
  const trail = [], projects = window.KPTUProjectCatalog.tree(ps).map(x => { trail.length = x.depth; const path = trail.join(' › '); trail.push(x.project.name || '이름 없는 프로젝트'); return {...x, path}; });
  return {projects: projects.filter(x => x.project.status === 'active'), orgs: order.withRecent(eligible, recent.map(r => r.organization_id), 3), bundles: Array.isArray(bs) ? bs : []};
}
// A place that is no longer offered (organization unassigned, project archived) falls back to the basket.
export function keepPlace(places, place) {
  if (!place || !places) return place;
  if (place.kind === 'project') return places.projects.some(x => x.project.id === place.id) ? place : BASKET;
  if (place.kind === 'reference') return (places.bundles || []).some(b => b.id === place.id) ? place : BASKET;
  return places.orgs.groups.flat().some(o => o.id === place.id) ? place : BASKET;
}
export const keepPlaces = (places, chosen) => placeList(chosen).filter(place => keepPlace(places, place));
export function placeName(places, place) {
  if (!place) return '';
  if (place.kind === 'project') return places?.projects.find(x => x.project.id === place.id)?.project.name || '';
  if (place.kind === 'reference') return (places?.bundles || []).find(b => b.id === place.id)?.name || '';
  return places?.orgs.groups.flat().find(o => o.id === place.id)?.name || '';
}
// UPD-여러곳고르기 ⑥: what the input's button says — one place by its name, more as "첫 곳 이름 외 N" (in the order picked).
export function placesLabel(places, chosen, fallback = () => '') {
  const list = placeList(chosen); if (!list.length) return '';
  const first = placeName(places, list[0]) || fallback(list[0]) || '고른 곳';
  return list.length > 1 ? `${first} 외 ${list.length - 1}` : first;
}
// UI-기록할곳되돌리기: after an update is added to an organization or a project, the input goes back to the basket; the place
// just used stays on the 최근 line (first, after [바구니(미분류)]) until the page reloads or the signed-in user changes. Memory only.
// UPD-여러곳고르기: every place of a save stays there, in the order picked.
let lastUsed = null;
const viewer = () => window.KPTURuntime?.context?.read?.()?.user?.id || '';
export function rememberPlace(chosen) { const list = placeList(chosen); if (list.length) lastUsed = {owner:viewer(), places:list}; }
function usedPlaces(places) {
  if (!lastUsed || lastUsed.owner !== viewer() || !places) return [];
  return keepPlaces(places, lastUsed.places);
}
// The 기록할 곳 sheet: [바구니(미분류)] then the recent places on one line, all organizations by group, then projects.
// UI-고르기창개선: the projects are one per line with a small check box; the search box above filters both (the recent line steps
// aside while searching, its chips are also below). UPD-여러곳고르기 ①: the organizations look the same: each group's name is a small
// heading and its organizations follow one per line with a check box. Many may be chosen; the sheet marks them (choice-sheet.js multi).
// UI-기록할곳창PC: the organizations and the projects are each one column block (data-sheet-col); on a wide PC (1024px~) the sheet
// sets them side by side under the 최근 line (choice-sheet.js wide, choice-sheet.css). Phones and middle widths keep them stacked.
// REF-참고묶음 (docs/design/ref-bundle.md 6절): the reference bundles are one more block at the very bottom (references:false leaves it
// out, as the 사업 보고 [연결할 곳] does). On a wide PC it sits under the projects in the projects column.
export function placeSheetHtml(places, chosen, esc, {basket: withBasket = true, references = true} = {}) {
  const list = placeList(chosen), picked = value => value === 'basket' ? !list.length : list.some(p => placeValue(p) === value);
  const chip = (value, name) => `<button type="button" class="home-choice-chip" data-sheet-value="${esc(value)}" aria-pressed="${picked(value)}">${esc(name)}</button>`;
  const row = x => projectRow(x, picked('project:' + x.project.id) ? 'project:' + x.project.id : null, esc, {value:'project:' + x.project.id});
  const basket = `<span data-sheet-basket class="home-choice-inline">${chip('basket', '정리함(미분류)')}</span>`;
  const orgs = places?.orgs || {recent:[], groups:[]}, projects = places?.projects || [];
  const used = usedPlaces(places), usedIds = new Set(used.filter(p => p.kind === 'organization').map(p => p.id));
  const all = orgs.groups.flat();
  const recent = [...used.filter(p => references || p.kind !== 'reference').map(p => p.kind !== 'organization' ? chip(placeValue(p), placeName(places, p)) : chip(p.id, all.find(o => o.id === p.id)?.name || '')),
    ...orgs.recent.filter(o => !usedIds.has(o.id)).slice(0, Math.max(0, Math.max(3, orgs.recent.length) - usedIds.size)).map(o => chip(o.id, o.name))];
  // MTG-사업보고 6단계: 사업 보고의 [연결할 곳]은 바구니(미분류)가 없는 같은 창이다({basket:false}). 최근 줄은 고를 곳이 있을 때만.
  const recentBlock = withBasket || recent.length ? `<div data-sheet-recent-block data-sheet-hide-on-search><p class="home-choice-label">최근</p><div class="home-choice-group home-choice-group-plain">${withBasket ? basket : ''}<span data-sheet-recent class="home-choice-inline">${recent.join('')}</span></div></div>` : '';
  const bundles = references ? places?.bundles || [] : [];
  const refs = bundles.length ? `<p class="home-choice-label" data-sheet-label-of="refs">참고</p><div data-sheet-refs data-sheet-part="refs">${bundles.map(b => referenceRow(b, picked('reference:' + b.id), esc)).join('')}</div>` : '';
  const projectCol = projects.length ? `<div class="home-choice-col" data-sheet-col="projects"><p class="home-choice-label" data-sheet-label-of="projects">프로젝트</p><div data-sheet-projects data-sheet-part="projects">${projects.map(row).join('')}</div>${refs}</div>` : refs ? `<div class="home-choice-col" data-sheet-col="refs">${refs}</div>` : '';
  return `${recentBlock}<div class="home-choice-col" data-sheet-col="orgs"><p class="home-choice-label" data-sheet-label-of="all">담당조직</p><div data-sheet-all data-sheet-part="all">${orgGroupRows(orgs.groups, o => orgRow(o, picked(o.id), esc))}</div></div>${projectCol}`;
}
// One reference bundle: the same row as an organization (check box, one per line), valued 'reference:<id>'.
export function referenceRow(b, pressed, esc) {
  const name = b.name || '이름 없는 묶음';
  return `<button type="button" class="home-choice-row home-choice-pick" style="--home-choice-depth:0" data-depth="0" data-sheet-value="${esc('reference:' + b.id)}" aria-pressed="${!!pressed}" title="${esc(name)}"><span class="home-choice-check" aria-hidden="true"></span><span class="home-choice-name">${esc(name)}</span></button>`;
}
export { projectRows };
// Text-only save of one update. owner is the signed-in user (the record's created_by/author_id, checked again by RLS).
// chosen: one place, null, or a list. None → a basket note; one → that place's own record (unchanged); two or more → one basket
// note linked to every place at once (app_basket_confirm_links, the basket [연결하기] path; the database refuses all or none).
// When the links are refused the note stays in the basket (nothing is lost or doubled): {note, linkError} says so to the caller.
// ED③ 업데이트: doc (optional) is the new editor's saved form. It goes only onto the basket note (no place, or two or more places);
// one organization's or project's record keeps letters only until those records have their own new window (설계 11.4 순서 5).
export async function saveUpdate({place, places, text, owner, doc = null}, rt = window.KPTURuntime) {
  const list = placeList(places ?? place);
  if (!list.length) return createNote({raw_text:text, ...(doc ? {doc} : {})}, rt);
  // REF-참고묶음: a reference bundle has no record table, so one bundle alone also goes the basket-update-and-link way below.
  if (list.length === 1 && list[0].kind !== 'reference') {
    const [one] = list;
    if (one.kind === 'project') return saveProjectProgress({project_id:one.id, raw_text:text.trim(), created_by:owner}, rt);
    return saveOrganizationUpdate({organization_id:one.id, raw_text:text.trim(), created_by:owner}, rt);
  }
  if (list.length > PLACE_LIMIT) throw new Error(`한 번에 ${PLACE_LIMIT}곳까지 고를 수 있어요.`);
  const note = await createNote({raw_text:text, ...(doc ? {doc} : {})}, rt);
  let linkError = '';
  try {
    const result = await confirmLinks(note.id, note.updated_at, list.map(p => ({kind:p.kind, target_id:p.id, reason:MULTI_REASON})), rt);
    if (result?.ok !== true) linkError = result?.error || 'UNKNOWN';
  } catch (error) { linkError = error?.message || 'UNKNOWN'; }
  window.dispatchEvent(new CustomEvent('kptu:basket-note-created'));
  if (!linkError) window.dispatchEvent(new CustomEvent('kptu:basket-links-changed'));
  return {note, linkError};
}
export const MULTI_REASON = '직접 연결'; // the same reason as the basket [연결하기] (basket-manual-link.js)
export const linkFailText = '업데이트는 정리함에 저장했지만 고른 곳에 연결하지 못했어요. 정리함에서 [연결하기]로 다시 연결해 주세요.';
// ED③ 업데이트: whether the new editor's saved form can be kept for these places: yes for the basket, two or more places (one basket update
// linked to each), a reference bundle, or any save with files (also a basket update linked); no for one organization's or project's own record.
export const keepsFormat = (places, fileCount = 0) => {
  const list = placeList(places);
  return !list.length || list.length > 1 || list[0].kind === 'reference' || fileCount > 0;
};
export const docFailText = '글자는 저장했지만 서식은 저장하지 못했어요. 정리함에서 그 업데이트를 열어 다시 고쳐 저장해 주세요.';
export const fileFailText = '파일은 정리함에 저장했지만 고른 곳 자료로 넣지 못했어요. 정리함에서 [연결하기]로 다시 넣어 주세요.';
// BUG-업데이트첨부연결: an update with files and one or more chosen places gives the same result as saving it in the basket and
// then using the basket's [연결하기] / [자료로 넣기] on it — through those same paths, nothing new on the server:
// ① the text and files go up as one basket update (uploadBatch → basket-files, photo text reading included); a failed file
//    throws and leaves the batch tied to that update, so [추가] again sends only what is left (the basket's own rule);
// ② with text, the update is linked to every chosen place (app_basket_confirm_links: owner RLS, all or none), so it is one
//    original shown in each place's records with its files; files only (no text) make no record, as [자료로 넣기];
// ③ the files become the first chosen project's and the first chosen organization's documents (putFilesIntoTargets:
//    document-actions register-basket-attachment + the owner-RLS app_documents update). A document belongs to one project and
//    one organization, so further places of the same kind show the files through the linked update only.
// A refused link or filing leaves the update (and files) saved in the basket; {linkError, filed} says which, never a retry.
export async function saveUpdateWithFiles({places, text, batch, doc = null, isCurrent = () => true, sameOwner = () => true, ocr, onChange, onOcrChange}, rt = window.KPTURuntime) {
  const list = placeList(places);
  if (!list.length) throw new Error('기록할 곳을 골라 주세요.');
  if (list.length > PLACE_LIMIT) throw new Error(`한 번에 ${PLACE_LIMIT}곳까지 고를 수 있어요.`);
  await uploadBatch(batch, {raw_text:text, rt, isCurrent, ...(ocr ? {ocr} : {}), ...(onChange ? {onChange} : {}), ...(onOcrChange ? {onOcrChange} : {})});
  const noteId = batch.note_id;
  window.dispatchEvent(new CustomEvent('kptu:basket-note-created'));
  // ED③ 업데이트: the letters are saved by now; the saved form is put on after (a refusal leaves the letters, and says so: docError).
  let docError = false;
  if (doc && String(text || '').trim()) { try { await attachNoteDoc(noteId, doc, rt); } catch { docError = true; } }
  let note = null, linkError = '', filed = null;
  try { note = await readBasketNote(noteId, rt); } catch { note = null; }
  if (!sameOwner()) return {note:{id:noteId}, linkError:'STALE', filed:null, stale:true};
  // Files only (no text) make no organization or project record, as [자료로 넣기]; a reference bundle is linked either way (REF-참고묶음).
  const linkTo = String(text || '').trim() ? list : list.filter(p => p.kind === 'reference');
  if (linkTo.length) {
    if (!note) linkError = 'NOTE_MISSING';
    else {
      try {
        const result = await confirmLinks(noteId, note.updated_at, linkTo.map(p => ({kind:p.kind, target_id:p.id, reason:MULTI_REASON})), rt);
        if (result?.ok !== true) linkError = result?.error || 'UNKNOWN';
      } catch (error) { linkError = error?.message || 'UNKNOWN'; }
      if (!linkError) window.dispatchEvent(new CustomEvent('kptu:basket-links-changed'));
    }
  }
  const project = list.find(p => p.kind === 'project') || null, organization = list.find(p => p.kind === 'organization') || null;
  const files = note?.attachments || batch.attachments || [];
  // A reference bundle takes no documents: files go into a project's or an organization's documents only.
  if (sameOwner() && files.length && (project || organization)) {
    try { filed = await putFilesIntoTargets({noteId, files, projectId:project?.id || null, organizationId:organization?.id || null, rt, expectedSessionEpoch:rt.session.epoch(), isCurrent:sameOwner}); }
    catch { filed = {ok:false, kind:'unknown', message:''}; }
  }
  return {note:note || {id:noteId}, linkError, filed, docError};
}
// Reads for a screen without the home's shared flights (the write window).
export function placeSources(rt = window.KPTURuntime) {
  const ctx = () => rt.context.read();
  const pages = path => import('./basket-link-records.js').then(m => m.readRecordPages(path, rt));
  return {
    projects: async () => { const c = ctx(); return (await window.KPTUProjectCatalog.load({workspaceId:c.workspace.id, userId:c.user.id})).projects; },
    orgs: () => pages(`/rest/v1/app_suborganizations?workspace_id=eq.${encodeURIComponent(ctx().workspace.id)}&active=eq.true&select=id,name,active&order=id.asc`),
    assignments: () => pages(`/rest/v1/app_suborganization_assignees?user_id=eq.${encodeURIComponent(ctx().user.id)}&select=organization_id&order=organization_id.asc`),
  };
}
