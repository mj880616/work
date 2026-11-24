// S69-20 ③④⑤(명진 11/24 08:48 "ㄱ 폴더도"): 자료실 앱 폴더 구조를 구글 드라이브 '자료실' 폴더 아래에 똑같이 맞춘다.
// workspace-drive POST ?action=drive-mirror {mode:'auto'|'align'}가 부른다(새 자료실 폴더 표시 MIRROR_MARK는 library-files도 씀). DOM·네트워크 없음(db·drive는 부르는 쪽이 넣는다, 시험 tests/library-drive-mirror.test.mjs).
//
// 규칙(한 곳):
// - 기준은 앱(DB). 앱 폴더마다 짝 드라이브 폴더(app_library_folders.drive_folder_id). 짝이 없거나 드라이브에서 지워졌으면
//   부모 짝 폴더 안의 같은 이름 폴더(아직 아무 앱 폴더와도 짝이 아닌 것)를 다시 쓰고, 없으면 만든다. 이름·부모가 다르면 드라이브 쪽을 고친다.
// - 자료: 폴더 안 자료는 그 폴더의 짝, '폴더 밖' 자료는 '자료실' 폴더로. 파일 id는 그대로 두고 부모(parents)만 바꾼다(링크가 깨지지 않음).
//   지금 '자료실' 나무(자료실 폴더와 짝 폴더들) 안에 있는 파일만 옮긴다. 회의자료·바구니처럼 다른 곳에 있는 파일은 건드리지 않는다.
// - 휴지통에 간 앱 폴더(화면에서 안 보이는 폴더)와 그 안 자료는 드라이브에서 그대로 둔다(되살리면 다시 맞춘다). 드라이브의 폴더·파일은 절대 지우지 않는다.
// - 'auto'(앞으로 같게)는 드라이브 '자료실' 폴더에 맞춤 표시(appProperties won_mirror=1)가 있을 때만 돈다. 표시는
//   새 사용자의 자료실 폴더를 만들 때(library-files) 또는 명진이 [드라이브 폴더 맞추기]('align')를 끝까지 마쳤을 때 붙는다.
//   그 전에는 서버가 기존 자료를 몰래 옮기지 않는다.
// - 시간 한도(budgetMs) 안에서만 하고, 남으면 more:true(이어서 다시 부르면 이어서 함). 'align'은 드라이브 실패가 나면 거기서 멈춘다.
// - 드라이브 실패는 앱 동작을 막지 않는다: 셀 수 있는 숫자(pending·cant)만 돌려주고 다음 부름에서 다시 한다.
//   cant = 드라이브가 이 앱에 그 파일 권한을 주지 않음(403·404: 앱이 만들지 않은 파일 등) — 다시 해도 안 되므로 대기로 세지 않는다.
// - 다루는 값은 폴더 이름·파일 id·폴더 id뿐(파일 내용은 열지 않음). 로그에도 이름을 남기지 않는다.

export const MIRROR_MARK = 'won_mirror';
export const MIRROR_BUDGET_MS = 25000;
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export class DriveFail extends Error {
  constructor(status) { super('drive ' + status); this.status = Number(status) || 0; }
}
const cantFail = e => e instanceof DriveFail && (e.status === 403 || e.status === 404);

export function parseMirrorBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'mode') return null;
  return body.mode === 'auto' || body.mode === 'align' ? body.mode : null;
}

/** 앱 폴더를 위에서 아래 차례로. 부모가 보이지 않는 폴더(휴지통 아래 등)는 뺀다. */
export function topDown(folders) {
  const byParent = new Map();
  for (const f of folders) {
    const key = f.parent_id || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id)));
  const out = [], queue = [...(byParent.get('') || [])], seen = new Set();
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f.id)) continue;
    seen.add(f.id); out.push(f);
    queue.push(...(byParent.get(f.id) || []));
  }
  return out;
}

/**
 * deps:
 *  db.folders() → [{id,parent_id,name,sort_order,drive_folder_id}] (owner RLS, 휴지통 숨김)
 *  db.items() → [{document_id, folder_id}]
 *  db.documents() → [{id, file_id}]
 *  db.setDrive(id, drive, expect) → {ok, taken?}
 *  drive.get(id) → meta|null, drive.children(parentId) → [{id,name,mimeType,parents}], drive.createFolder(name,parent) → id,
 *  drive.patch(id, {name?, addParents?, removeParents?, appProperties?}) — 실패는 DriveFail(status) throw.
 *  now() → ms
 */
export async function mirrorLibrary({ libraryId, mode, db, drive, now = Date.now, budgetMs = MIRROR_BUDGET_MS }) {
  const started = now();
  const out = { ok: true, state: 'not_aligned', folders_made: 0, folders_fixed: 0, files_moved: 0, cant: 0, pending: 0, more: false, stopped: false };
  if (typeof libraryId !== 'string' || !DRIVE_ID.test(libraryId)) return { ...out, state: 'none' };
  let lib;
  try { lib = await drive.get(libraryId); } catch (e) { return { ...out, ok: false, code: 'drive_unavailable', pending: 1 }; }
  if (!lib || lib.trashed === true) return { ...out, ok: false, code: 'library_missing' };
  const aligned = lib.appProperties?.[MIRROR_MARK] === '1';
  out.state = aligned ? 'aligned' : 'not_aligned';
  if (mode === 'auto' && !aligned) return out;

  const late = () => now() - started > budgetMs;
  const stop = () => { out.stopped = true; };
  const failed = e => { if (mode === 'align') stop(); out.pending++; return e; };

  const folders = topDown(await db.folders());
  const pair = new Map(), used = new Set();
  for (const f of folders) if (typeof f.drive_folder_id === 'string' && DRIVE_ID.test(f.drive_folder_id)) used.add(f.drive_folder_id);
  const kids = new Map();
  async function childrenOf(parent) {
    if (!kids.has(parent)) kids.set(parent, await drive.children(parent));
    return kids.get(parent);
  }

  // 1) 폴더
  for (const f of folders) {
    if (out.stopped) break;
    if (late()) { out.more = true; break; }
    const parent = f.parent_id ? pair.get(f.parent_id) : libraryId;
    if (!parent) { out.pending++; continue; }
    try {
      let id = typeof f.drive_folder_id === 'string' && DRIVE_ID.test(f.drive_folder_id) ? f.drive_folder_id : null;
      let meta = id ? await drive.get(id) : null;
      if (meta && (meta.trashed === true || (meta.mimeType && meta.mimeType !== FOLDER_MIME))) meta = null;
      if (!meta) {
        const reuse = (await childrenOf(parent)).find(c => c.mimeType === FOLDER_MIME && c.name === f.name && !used.has(c.id));
        const next = reuse ? reuse.id : await drive.createFolder(f.name, parent);
        if (!reuse) { out.folders_made++; kids.get(parent)?.push({ id: next, name: f.name, mimeType: FOLDER_MIME, parents: [parent] }); }
        const saved = await db.setDrive(f.id, next, id);
        if (!saved?.ok) { out.pending++; continue; }
        if (id) used.delete(id);
        used.add(next); pair.set(f.id, next);
        continue;
      }
      const patch = {};
      if (meta.name !== f.name) patch.name = f.name;
      const parents = Array.isArray(meta.parents) ? meta.parents : [];
      if (!parents.includes(parent) || parents.length !== 1) { patch.addParents = parent; const rm = parents.filter(p => p !== parent); if (rm.length) patch.removeParents = rm.join(','); }
      if (Object.keys(patch).length) { await drive.patch(id, patch); out.folders_fixed++; }
      pair.set(f.id, id);
    } catch (e) { failed(e); }
  }

  // 2) 자료(폴더를 모두 맞춘 뒤에만)
  if (!out.stopped && !out.more) {
    const visible = new Set(folders.map(f => f.id));
    const managed = [libraryId, ...pair.values()];
    const where = new Map();
    for (const folderId of managed) {
      if (late()) { out.more = true; break; }
      try {
        for (const c of await childrenOf(folderId)) if (c.mimeType !== FOLDER_MIME) where.set(c.id, folderId);
      } catch (e) { failed(e); if (out.stopped) break; }
    }
    if (!out.stopped && !out.more) {
      const itemOf = new Map((await db.items()).map(i => [i.document_id, i.folder_id]));
      for (const doc of await db.documents()) {
        if (out.stopped) break;
        if (late()) { out.more = true; break; }
        const file = doc.file_id, cur = where.get(file);
        if (!file || !cur) continue; // 자료실 나무 밖 파일(회의자료·바구니 등)은 그대로
        const folderId = itemOf.get(doc.id);
        if (folderId && !visible.has(folderId)) continue; // 휴지통 폴더 안 자료는 그대로
        const target = folderId ? pair.get(folderId) : libraryId;
        if (!target) { out.pending++; continue; }
        if (target === cur) continue;
        try { await drive.patch(file, { addParents: target, removeParents: cur }); out.files_moved++; where.set(file, target); }
        catch (e) { if (cantFail(e)) out.cant++; else failed(e); }
      }
    }
  }

  // 3) 맞춤 표시: [드라이브 폴더 맞추기]를 끝까지(남은 것·대기 없이) 마쳤을 때만.
  if (mode === 'align' && !aligned && !out.more && !out.stopped && out.pending === 0) {
    try { await drive.patch(libraryId, { appProperties: { [MIRROR_MARK]: '1' } }); out.state = 'aligned'; }
    catch (e) { failed(e); }
  }
  return out;
}
