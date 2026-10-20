// BASKET-업데이트통합: where an "업데이트" goes, in one place for the home input and the shared write window (write-window.js).
// No place → a basket note (미분류); an organization → that organization's record; a project → that project's progress record.
// Every save is an existing owner-RLS path (createNote, saveOrganizationUpdate, saveProjectProgress); nothing new is written here.
import { createNote } from './basket-data.js';
import { saveOrganizationUpdate, saveProjectProgress } from './quick-save.js';
import { projectRows, projectRow, orgGroupRows } from './choice-sheet.js';

// place: null (basket) | {kind:'organization'|'project', id}
export const BASKET = null;
export const placeValue = place => !place ? 'basket' : place.kind === 'project' ? 'project:' + place.id : place.id;
export function placeFromValue(value) {
  if (!value || value === 'basket') return BASKET;
  if (value.startsWith('project:')) return {kind:'project', id:value.slice(8)};
  return {kind:'organization', id:value};
}
export const samePlace = (a, b) => placeValue(a) === placeValue(b);

// sources: {projects(), orgs(), assignments()} — the home passes its shared reads; the write window reads them itself.
// Returns {projects:[tree rows of active projects], orgs:{recent, groups}} with the three most recent organizations first.
export async function readPlaces(sources, {rt = window.KPTURuntime, isCurrent = () => true} = {}) {
  const [ps, os, as] = await Promise.all([sources.projects(), sources.orgs(), sources.assignments()]);
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
  return {projects: window.KPTUProjectCatalog.tree(ps).filter(x => x.project.status === 'active'), orgs: order.withRecent(eligible, recent.map(r => r.organization_id), 3)};
}
// A place that is no longer offered (organization unassigned, project archived) falls back to the basket.
export function keepPlace(places, place) {
  if (!place || !places) return place;
  if (place.kind === 'project') return places.projects.some(x => x.project.id === place.id) ? place : BASKET;
  return places.orgs.groups.flat().some(o => o.id === place.id) ? place : BASKET;
}
export function placeName(places, place) {
  if (!place) return '';
  if (place.kind === 'project') return places?.projects.find(x => x.project.id === place.id)?.project.name || '';
  return places?.orgs.groups.flat().find(o => o.id === place.id)?.name || '';
}
// UI-기록할곳되돌리기: after an update is added to an organization or a project, the input goes back to the basket; the place
// just used stays on the 최근 line (first, after [바구니(미분류)]) until the page reloads or the signed-in user changes. Memory only.
let lastUsed = null;
const viewer = () => window.KPTURuntime?.context?.read?.()?.user?.id || '';
export function rememberPlace(place) { if (place) lastUsed = {owner:viewer(), place:{kind:place.kind, id:place.id}}; }
function usedPlace(places) {
  if (!lastUsed || lastUsed.owner !== viewer() || !places) return null;
  return keepPlace(places, lastUsed.place);
}
// The 기록할 곳 sheet: [바구니(미분류)] then the recent places on one line, all organizations by group, then projects.
// UI-고르기창개선: on a PC list the organizations are one line per group (group name, then its chips) and the projects one per line
// with a small check box; the search box above filters both (the recent line steps aside while searching, its chips are also below).
// UI-기록할곳창PC: the organizations and the projects are each one column block (data-sheet-col); on a wide PC (1024px~) the sheet
// sets them side by side under the 최근 line (choice-sheet.js wide, choice-sheet.css). Phones and middle widths keep them stacked.
export function placeSheetHtml(places, place, esc) {
  const chosen = placeValue(place);
  const chip = o => `<button type="button" class="home-choice-chip" data-sheet-value="${esc(o.id)}" aria-pressed="${o.id === chosen}">${esc(o.name)}</button>`;
  const row = x => projectRow(x, chosen, esc, {value:'project:' + x.project.id});
  const basket = `<span data-sheet-basket class="home-choice-inline"><button type="button" class="home-choice-chip" data-sheet-value="basket" aria-pressed="${chosen === 'basket'}">바구니(미분류)</button></span>`;
  const orgs = places?.orgs || {recent:[], groups:[]}, projects = places?.projects || [];
  const used = usedPlace(places);
  let recent = orgs.recent.map(chip);
  if (used?.kind === 'project') {
    const value = placeValue(used);
    recent = [`<button type="button" class="home-choice-chip" data-sheet-value="${esc(value)}" aria-pressed="${value === chosen}">${esc(placeName(places, used))}</button>`, ...recent];
  } else if (used) {
    const org = orgs.groups.flat().find(o => o.id === used.id);
    recent = [org, ...orgs.recent.filter(o => o.id !== used.id)].slice(0, Math.max(3, orgs.recent.length)).map(chip);
  }
  return `<div data-sheet-recent-block data-sheet-hide-on-search><p class="home-choice-label">최근</p><div class="home-choice-group home-choice-group-plain">${basket}<span data-sheet-recent class="home-choice-inline">${recent.join('')}</span></div></div><div class="home-choice-col" data-sheet-col="orgs"><p class="home-choice-label" data-sheet-label-of="all">담당조직</p><div data-sheet-all data-sheet-part="all">${orgGroupRows(orgs.groups, chip)}</div></div>${projects.length ? `<div class="home-choice-col" data-sheet-col="projects"><p class="home-choice-label" data-sheet-label-of="projects">프로젝트</p><div data-sheet-projects data-sheet-part="projects">${projects.map(row).join('')}</div></div>` : ''}`;
}
export { projectRows };
// Text-only save of one update. owner is the signed-in user (the record's created_by/author_id, checked again by RLS).
export function saveUpdate({place, text, owner}, rt = window.KPTURuntime) {
  if (!place) return createNote({raw_text:text}, rt);
  if (place.kind === 'project') return saveProjectProgress({project_id:place.id, raw_text:text.trim(), created_by:owner}, rt);
  return saveOrganizationUpdate({organization_id:place.id, raw_text:text.trim(), created_by:owner}, rt);
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
