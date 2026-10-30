// PHOTO-사진메뉴 ②: 앨범(#태그) 서버 읽기·쓰기(DB 20261029150000_photo_tags, owner RLS 표 두 개에 화면이 직접 쓴다 — 별표 app_diary_stars와 같은 길).
// 태그는 Web2 서버에만 있고 원드라이브 파일은 건드리지 않는다. 앨범 지우기 = 태그 행과 그 연결 행(cascade)만. 기기 저장 없음.
const encode = encodeURIComponent;
function workspace(rt) {
  const id = rt?.context?.read?.()?.workspace?.id;
  if (!id) throw new Error('작업공간을 확인하지 못했어요.');
  return id;
}
const list = keys => `(${keys.map(k => `"${String(k).replace(/["\\]/g, '')}"`).join(',')})`;

export async function readPhotoTags(rt = window.KPTURuntime) {
  const ws = encode(workspace(rt));
  const [tags, links] = await Promise.all([
    rt.api(`/rest/v1/app_photo_tags?workspace_id=eq.${ws}&select=id,name,cover_key&order=name.asc&limit=1000`),
    rt.api(`/rest/v1/app_photo_tag_items?workspace_id=eq.${ws}&source=in.(onedrive,phone)&select=tag_id,source,item_key,taken_day&limit=20000`),
  ]);
  if (!Array.isArray(tags) || !Array.isArray(links)) throw new Error('tags');
  return {tags, links};
}
export async function createPhotoTag(name, rt = window.KPTURuntime) {
  const rows = await rt.api('/rest/v1/app_photo_tags', {method: 'POST', prefer: 'return=representation', body: {workspace_id: workspace(rt), name}});
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (typeof row?.id !== 'string') throw new Error('tags');
  return {id: row.id, name: row.name, cover_key: row.cover_key ?? null};
}
export const renamePhotoTag = (id, name, rt = window.KPTURuntime) =>
  rt.api(`/rest/v1/app_photo_tags?workspace_id=eq.${encode(workspace(rt))}&id=eq.${encode(id)}`, {method: 'PATCH', prefer: 'return=minimal', body: {name, updated_at: new Date().toISOString()}});
export const setPhotoTagCover = (id, key, rt = window.KPTURuntime) =>
  rt.api(`/rest/v1/app_photo_tags?workspace_id=eq.${encode(workspace(rt))}&id=eq.${encode(id)}`, {method: 'PATCH', prefer: 'return=minimal', body: {cover_key: key, updated_at: new Date().toISOString()}});
export const deletePhotoTag = (id, rt = window.KPTURuntime) =>
  rt.api(`/rest/v1/app_photo_tags?workspace_id=eq.${encode(workspace(rt))}&id=eq.${encode(id)}`, {method: 'DELETE', prefer: 'return=minimal'});
// 여러 장 넣기(한 번에 200장까지, 이미 든 사진은 그대로 = 겹치면 건너뜀).
export async function addPhotoTagItems(tagId, items, rt = window.KPTURuntime) {
  const ws = workspace(rt);
  // PHOTO-출처 ①: 폰 사진은 source 'phone'(열쇠 'ms:<번호>', DB 20261030230000 뒤 받음).
  const rows = items.slice(0, 200).map(it => ({tag_id: tagId, workspace_id: ws, source: it.source === 'phone' ? 'phone' : 'onedrive', item_key: it.key, taken_day: it.day || null}));
  if (!rows.length) return;
  await rt.api('/rest/v1/app_photo_tag_items?on_conflict=tag_id,source,item_key', {method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: rows});
}
export async function removePhotoTagItems(tagId, keys, rt = window.KPTURuntime, source = 'onedrive') {
  if (!keys.length) return;
  const src = source === 'phone' ? 'phone' : 'onedrive';
  await rt.api(`/rest/v1/app_photo_tag_items?workspace_id=eq.${encode(workspace(rt))}&tag_id=eq.${encode(tagId)}&source=eq.${src}&item_key=in.${encode(list(keys.slice(0, 200)))}`, {method: 'DELETE', prefer: 'return=minimal'});
}
