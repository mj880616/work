// TRASH-다른삭제 5단계: 휴지통 함수(app_trash_list / app_trash_restore)를 흉내 내는 공용 부품(시험 전용, 서버 키 없음).
// mode 'ready' = DB 적용 뒤, 'missing' = DB 적용 전(옛 함수가 노트 종류를 모름). 삭제 가로채기는 각 시험의 DELETE 응답에서 state.take(노트)로 흉내 낸다.
export async function noteTrash(page, SB, {mode = 'ready'} = {}) {
  const state = {mode, trash: [], rpc: [], restored: [], onRestore: () => {}};
  state.take = (note, linkCount = 0) => { state.trash.push({...note, link_count: linkCount, deleted_at: '2026-10-26T01:00:00Z'}); };
  await page.route(`${SB}/rest/v1/rpc/app_trash_*`, (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    state.rpc.push({fn, kind: body.p_kind, id: body.p_id});
    if (state.mode === 'missing') return route.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify({code: '22023', message: 'TRASH_KIND_UNKNOWN'})});
    if (fn === 'app_trash_list') {
      return route.fulfill({json: body.p_kind === 'note' ? state.trash.map((n) => ({kind: 'note', id: n.id, workspace_id: n.workspace_id || 'w', note_kind: n.kind || 'basket', title: n.title || '', preview: String(n.raw_text || '').slice(0, 80), deleted_at: n.deleted_at, file_count: (n.attachments || []).length, link_count: n.link_count || 0})) : []});
    }
    const found = state.trash.find((n) => n.id === body.p_id);
    if (!found) return route.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify({code: 'P0002', message: 'TRASH_NOT_FOUND'})});
    state.trash = state.trash.filter((n) => n !== found);
    state.restored.push(found.id);
    state.onRestore(found);
    return route.fulfill({json: {ok: true, kind: 'note', id: found.id, restored: 1}});
  });
  return state;
}
