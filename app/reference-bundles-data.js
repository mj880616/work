// REF-참고묶음 (docs/design/ref-bundle.md 2·6절): the reference bundles' list (app_reference_bundles: name and order) and the
// owner-RLS REST writes the 참고 묶음 screen uses. No RPC: the table's own policy (reference_bundles_owner_all,
// private.app_is_workspace_owner) and its checks (name 1~30 characters after trimming, one name per workspace) decide.
// Links to a bundle stay in app_record_links (bundle_id), read by basket-link-records.js readLinkRecords({kind:'bundle'}).
import {readRecordPages} from './basket-link-records.js';

export const BUNDLE_NAME_MAX = 30;
const contextFor = rt => rt?.context?.read?.() || {};
const workspaceOf = rt => { const id = contextFor(rt)?.workspace?.id; if (!id) throw Error('업무 공간을 확인할 수 없어요.'); return id; };
const encode = encodeURIComponent;
const FIELDS = 'id,workspace_id,name,sort_order,created_at,updated_at';

// The database check is char_length(btrim(name)) between 1 and 30: the saved name is the trimmed one.
export function validateBundleName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw Error('묶음 이름을 입력해 주세요.');
  if (name.includes('\0') || name.isWellFormed?.() === false) throw Error('묶음 이름의 글자를 확인해 주세요.');
  if ([...name].length > BUNDLE_NAME_MAX) throw Error(`묶음 이름은 ${BUNDLE_NAME_MAX}자까지 쓸 수 있어요.`);
  return name;
}
// Lower sort_order first; the same number keeps the order they were made in.
export const sortBundles = rows => [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));

export async function readReferenceBundles(rt = window.KPTURuntime) {
  const workspaceId = workspaceOf(rt);
  const rows = await readRecordPages(`/rest/v1/app_reference_bundles?workspace_id=eq.${encode(workspaceId)}&select=${FIELDS}&order=sort_order.asc,created_at.asc,id.asc`, rt);
  return sortBundles(rows.filter(row => row?.id && row.workspace_id === workspaceId));
}

const one = rows => Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
// [묶음 더하기]: last in the order (10 after the largest number).
export async function createReferenceBundle(name, bundles = [], rt = window.KPTURuntime) {
  const workspace_id = workspaceOf(rt), clean = validateBundleName(name);
  const sort_order = Math.max(0, ...bundles.map(b => Number(b.sort_order) || 0)) + 10;
  const saved = one(await rt.api('/rest/v1/app_reference_bundles', {method:'POST', prefer:'return=representation', body:{workspace_id, name:clean, sort_order}}));
  if (!saved) throw Error('묶음을 더했는지 확인하지 못했어요. 목록을 다시 불러와 확인해 주세요.');
  return saved;
}
// [이름 바꾸기]: only when the row is still the version shown (updated_at). Links point at the id, so they stay as they are.
// Returns the saved row, or null when the row changed or is gone meanwhile.
export async function renameReferenceBundle(bundle, name, rt = window.KPTURuntime) {
  const workspaceId = workspaceOf(rt), clean = validateBundleName(name);
  const rows = await rt.api(`/rest/v1/app_reference_bundles?id=eq.${encode(bundle.id)}&workspace_id=eq.${encode(workspaceId)}&updated_at=eq.${encode(bundle.updated_at)}&select=${FIELDS}`,
    {method:'PATCH', prefer:'return=representation', body:{name:clean, updated_at:new Date().toISOString()}});
  return one(rows);
}
// [묶음 지우기] is offered for an empty bundle only; the link's foreign key (on delete restrict) refuses a bundle that still holds one.
export async function deleteReferenceBundle(id, rt = window.KPTURuntime) {
  const workspaceId = workspaceOf(rt);
  const rows = await rt.api(`/rest/v1/app_reference_bundles?id=eq.${encode(id)}&workspace_id=eq.${encode(workspaceId)}&select=id`, {method:'DELETE', prefer:'return=representation'});
  return Array.isArray(rows) && rows.some(row => row.id === id);
}
// [순서 바꾸기]: the shown order becomes 10, 20, 30…; only rows whose number changes are written.
export const orderPatches = ordered => ordered.map((b, i) => ({id:b.id, sort_order:(i + 1) * 10})).filter((p, i) => Number(ordered[i].sort_order) !== p.sort_order);
export async function saveBundleOrder(ordered, rt = window.KPTURuntime) {
  const workspaceId = workspaceOf(rt), patches = orderPatches(ordered);
  for (const p of patches) {
    const saved = one(await rt.api(`/rest/v1/app_reference_bundles?id=eq.${encode(p.id)}&workspace_id=eq.${encode(workspaceId)}&select=${FIELDS}`, {method:'PATCH', prefer:'return=representation', body:{sort_order:p.sort_order}}));
    if (!saved) throw Error('순서를 저장하지 못했어요. 목록을 다시 불러와 확인해 주세요.');
  }
  return patches.length;
}
// Per bundle: how many updates/notes are linked and the latest one's date (from readLinkRecords rows).
export function bundleStats(links) {
  const out = new Map();
  for (const link of links || []) {
    if (!link?.bundle_id) continue;
    const s = out.get(link.bundle_id) || {count:0, last:''};
    s.count++; if (String(link.occurred_at || '') > s.last) s.last = String(link.occurred_at || '');
    out.set(link.bundle_id, s);
  }
  return out;
}
// The database's refusals in plain words (409 = the same name already exists, or the bundle still holds links).
export function bundleErrorText(error, action = 'save') {
  if (error?.status === 409) return action === 'delete' ? '이 묶음에 붙은 소식이 있어 지울 수 없어요. 연결을 먼저 풀어 주세요.' : '같은 이름의 묶음이 이미 있어요. 다른 이름을 써 주세요.';
  if (error?.status === 400 || error?.status === 422) return '묶음 이름을 확인해 주세요(1~30자).';
  if (error?.status === 401 || error?.status === 403) return '이 묶음을 바꿀 권한이 없어요.';
  return error?.message && !error?.status ? error.message : '저장하지 못했어요. 다시 시도해 주세요.';
}
