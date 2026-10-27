// SHARE-페이지삭제: the request shapes for keeping (보관) and deleting (삭제) a share page (share-pages.js draws and sends them).
// 보관 keeps the record: status goes to 'archived' (DB check app_share_pages_status_check, migration 20261023160000). The list and
// the weekly journal leave archived pages out, and share-page-read shows only 'published', so a kept page's link stops by itself.
// Links, photo records and photo files are not touched. The 보관함 (bottom of the list) shows the kept pages again.
// 되살리기 from the 보관함 always comes back as a draft (no new column remembers the old status): a page that was published opens its
// links again only when the owner presses 게시 again. The 5-second undo right after 보관 still puts back the exact status it had.
// TRASH-다른삭제: 삭제 goes to the 휴지통 (DB deleted_at, trash-actions.js deleteToTrash); 보관함 and 휴지통 are separate. Only the 휴지통's
// [영구 삭제] is for good: the Edge function share-page-media (action purge_page) checks the owner with the login and that the page is in the
// trash, removes the photo files first, then the page row (links and photo records go with it by the DB's cascade). Partly done = 503, pressing again finishes it.
// The writes are conditional on the row as the screen saw it, so a page edited somewhere else is never kept or brought back by mistake.
export const ARCHIVED = 'archived';
export const archiveFilter = `status=neq.${ARCHIVED}`;
export const boxFilter = `status=eq.${ARCHIVED}`;
const q = encodeURIComponent;
export const shortTitle = title => { const chars = [...String(title == null ? '' : title).trim()]; return chars.length ? (chars.length > 24 ? chars.slice(0, 24).join('') + '…' : chars.join('')) : '제목 없음'; };
// One question. A published page adds the line that its link stops (a draft has no link anyone can open).
export function archiveConfirmText(page) {
  const name = shortTitle(page && page.title);
  return page && page.status === 'published'
    ? `「${name}」 페이지를 보관할까요?\n게시가 멈춰 링크로 보던 사람도 더 이상 볼 수 없어요.`
    : `「${name}」 초안을 보관할까요?`;
}
export const purgeConfirmText = page => `「${shortTitle(page && page.title)}」 페이지를 영구 삭제할까요?\n페이지·링크·사진이 모두 지워지고 되살릴 수 없어요.`;
export const archivePatch = {
  where: (id, workspaceId, updatedAt) => `id=eq.${q(id)}&workspace_id=eq.${q(workspaceId)}&${archiveFilter}${updatedAt ? `&updated_at=eq.${q(updatedAt)}` : ''}`,
  body: now => ({status:ARCHIVED, updated_at:now}),
};
// Undo (5 seconds after 보관) puts back the status and the time the page had, only while the row is still the one this archive wrote.
export const undoPatch = {
  where: (id, workspaceId, archivedAt) => `id=eq.${q(id)}&workspace_id=eq.${q(workspaceId)}&${boxFilter}${archivedAt ? `&updated_at=eq.${q(archivedAt)}` : ''}`,
  body: (status, updatedAt) => ({status:status === 'published' ? 'published' : 'draft', ...(updatedAt ? {updated_at:updatedAt} : {})}),
};
// 되살리기 from the 보관함: always a draft, moved to the top of the list.
export const restorePatch = {
  where: (id, workspaceId, archivedAt) => undoPatch.where(id, workspaceId, archivedAt),
  body: now => ({status:'draft', updated_at:now}),
};

const PURGE_ERRORS = {
  401: '로그인이 끝났어요. 다시 로그인해 주세요.',
  404: '이미 휴지통에 없거나 찾을 수 없는 페이지예요. 목록을 다시 불러왔어요.',
  503: '일부를 지우지 못했어요. 페이지는 휴지통에 남아 있어요. 다시 [영구 삭제]를 누르면 남은 것부터 지워요.',
};
// One call to share-page-media (휴지통의 [영구 삭제]). Returns {ok:true} or {ok:false, status, message}; never throws.
export async function purgePage(pageId, {rt = globalThis.window?.KPTURuntime, fetcher = globalThis.fetch?.bind(globalThis)} = {}) {
  const fail = status => ({ok:false, status, message:PURGE_ERRORS[status] || '삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.'});
  try {
    if (!(await rt.session.ensure())) return fail(401);
    const token = rt.session.read()?.access_token;
    if (!token) return fail(401);
    const response = await fetcher(`${rt.config.url}/functions/v1/share-page-media`, {method:'POST',
      headers:{apikey:rt.config.key, Authorization:'Bearer ' + token, 'Content-Type':'application/json'},
      body:JSON.stringify({action:'purge_page', page_id:String(pageId)})});
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    return response.ok && data && data.ok ? {ok:true} : fail(response.status);
  } catch { return fail(0); }
}
