// SHARE-페이지삭제: the request shapes for deleting a share page by archiving it (share-pages.js draws and sends them).
// Delete keeps the record: status goes to 'archived' (DB check app_share_pages_status_check, migration 20261023160000). The list and
// the weekly journal leave archived pages out, and share-page-read shows only 'published', so a deleted page's link stops by itself.
// Links, photo records and photo files are not touched (a photo clean-up belongs only to a real delete; this is a hold).
// Both writes are conditional on the row as the screen saw it, so a page edited somewhere else is never archived or restored by mistake;
// archiving also moves updated_at forward, so an editor still open elsewhere cannot save over the archived page.
export const ARCHIVED = 'archived';
export const archiveFilter = `status=neq.${ARCHIVED}`;
const q = encodeURIComponent;
export const shortTitle = title => { const chars = [...String(title == null ? '' : title).trim()]; return chars.length ? (chars.length > 24 ? chars.slice(0, 24).join('') + '…' : chars.join('')) : '제목 없음'; };
// One question. A published page adds the line that the link stops (a draft has no link anyone can open).
export function archiveConfirmText(page) {
  const name = shortTitle(page && page.title);
  return page && page.status === 'published'
    ? `「${name}」 페이지를 삭제할까요?\n링크로 보던 사람도 더 이상 볼 수 없어요.`
    : `「${name}」 초안을 삭제할까요?`;
}
export const archivePatch = {
  where: (id, workspaceId, updatedAt) => `id=eq.${q(id)}&workspace_id=eq.${q(workspaceId)}&${archiveFilter}${updatedAt ? `&updated_at=eq.${q(updatedAt)}` : ''}`,
  body: now => ({status:ARCHIVED, updated_at:now}),
};
// Undo puts back the status and the time the page had, only while the row is still the one this archive wrote.
export const undoPatch = {
  where: (id, workspaceId, archivedAt) => `id=eq.${q(id)}&workspace_id=eq.${q(workspaceId)}&status=eq.${ARCHIVED}${archivedAt ? `&updated_at=eq.${q(archivedAt)}` : ''}`,
  body: (status, updatedAt) => ({status:status === 'published' ? 'published' : 'draft', ...(updatedAt ? {updated_at:updatedAt} : {})}),
};
