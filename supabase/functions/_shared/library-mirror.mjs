// S69-20 ③④⑤(명진 11/24 08:48 "ㄱ 폴더도"): 자료실 앱 폴더 구조를 구글 드라이브 '자료실' 폴더 아래에 똑같이 맞춘다.
// workspace-drive POST ?action=drive-mirror {mode:'auto'}가 부른다(새 자료실 폴더 표시 MIRROR_MARK는 library-files도 씀). DOM·네트워크 없음(db·drive는 부르는 쪽이 넣는다, 시험 tests/library-drive-mirror.test.mjs).
//
// 규칙(한 곳):
// - 기준은 앱(DB). 앱 폴더마다 짝 드라이브 폴더(app_library_folders.drive_folder_id). 짝이 없거나 드라이브에서 지워졌으면
//   부모 짝 폴더 안의 같은 이름 폴더(아직 아무 앱 폴더와도 짝이 아닌 것)를 다시 쓰고, 없으면 만든다. 이름·부모가 다르면 드라이브 쪽을 고친다.
// - 자료: 폴더 안 자료는 그 폴더의 짝, '폴더 밖' 자료는 '자료실' 폴더로. 파일 id는 그대로 두고 부모(parents)만 바꾼다(링크가 깨지지 않음).
//   지금 '자료실' 나무(자료실 폴더와 짝 폴더들) 안에 있는 파일만 옮긴다. 회의자료·바구니처럼 다른 곳에 있는 파일은 건드리지 않는다.
//   S71-05: 단, 드라이브에서 사람이 옮긴 자료(자료실 열 때 따라가기 drive-auto가 자료실을 고칠 것)는 덮지 않는다 — 판정은 followTarget 한 곳.
//   앱이 옮긴 지 FOLLOW_QUIET_MS 안(앱이 이김)·폴더 밖·맨 위·짝 없는 곳·옮긴 시각 모름은 지금처럼 앱 자리로 민다. 숫자 drive_wins.
// - 휴지통에 간 앱 폴더(화면에서 안 보이는 폴더)와 그 안 자료는 드라이브에서 그대로 둔다(되살리면 다시 맞춘다). 드라이브의 폴더·파일은 절대 지우지 않는다.
// - S70-76 LIB-드라이브늘같게(명진 11/24·11/26 "자료실은 그냥 드라이브를 항상 반영하는걸로"): 갈래는 'auto' 하나다. 화면은 자료를 옮기거나
//   폴더를 만들거나 이름을 바꾸거나 옮길 때마다 그 자리에서 부르고(app/drive-follow.mjs), 자료실에 들어올 때도 한 번 부른다.
//   [드라이브 폴더 맞추기]('align')·[드라이브와 맞는지 보기]는 일회용이 되어 지웠다(AGENTS.md 4절). 맞춤 표시(appProperties won_mirror=1)가
//   아직 없는 자료실(옛 사용자)도 'auto'가 기존 자료까지 맞추고, 끝까지(남은 것·대기 없이) 마치면 표시를 붙인다(표시는 기록일 뿐 막지 않음).
// - 밀린 것: 기준은 서버 DB(자료실 폴더·연결 줄)이고 드라이브와 다른 곳을 부를 때마다 서버가 다시 계산한다. 그래서 드라이브 쪽이 실패해도
//   잃지 않고, 다음 부름(어느 기기든 자료실 열기·다음 옮기기·[다시])에서 서버가 다시 한다. 밀린 수는 pending·left로 돌려준다.
// - 시간 한도(budgetMs) 안에서만 하고, 남으면 more:true(이어서 다시 부르면 이어서 함). 드라이브 실패는 멈추지 않고 대기(pending)로 센다.
//   S69-40(명진 11/24 13시 "폴더 0개 만들고 자료 0개 옮겼어요"가 되풀이): 한도는 화면 기다림(45초)보다 훨씬 짧게(10초) 두고, 드라이브 읽기는
//   폴더 하나씩 묻지 않고 부모 폴더 여러 개를 한 번에(drive.list) 묻는다. 그래서 한 번 부를 때마다 앞에서 읽기만 하다 끝나지 않고 꼭 몇 개씩 옮긴다.
//   left = 아직 옮길 자료 수(화면 진행 표시), stage = 멈춘 단계(library·folders·list·files·mark — 화면 일상어 한 줄).
// - 드라이브 실패는 앱 동작을 막지 않는다: 셀 수 있는 숫자(pending·cant)만 돌려주고 다음 부름에서 다시 한다.
//   cant = 드라이브가 이 앱에 그 파일 권한을 주지 않음(403·404: 앱이 만들지 않은 파일 등) — 다시 해도 안 되므로 대기로 세지 않는다.
// - 다루는 값은 폴더 이름·파일 id·폴더 id뿐(파일 내용은 열지 않음). 로그에도 이름을 남기지 않는다.
// S69-52 ①(명진 11/24 "파일 안에서 자료실에 해당하는 구글 드라이브 폴더를 클릭하면 자료실과 사실상 내용이 동일"): 폴더 구조의 원본은 드라이브 폴더,
//   자료실은 id로 대응한다. 짝 드라이브 폴더마다 '마지막으로 맞춘 모양' 표식(appProperties won_n = 이름 지문, won_p = 부모 드라이브 id)을 붙여 두고,
//   다음 읽기 때 어느 쪽이 바뀌었는지 본다(decideFolder):
//     드라이브만 바뀜(이름·부모) → 자료실이 따라간다(앱 폴더 이름·부모를 고침, 내 토큰·owner RLS·나무 검사 그대로).
//     자료실만 바뀜 → 드라이브를 고친다(지금까지와 같음). 표식이 아직 없는 옛 짝 → 지금까지와 같이 자료실 기준(legacy).
//     둘 다 바뀜·따라갈 수 없음(드라이브에서 자료실 밖·짝 없는 폴더로 옮김, 이름이 자료실 규칙(1~40자)에 안 맞음) → 아무것도 바꾸지 않고
//     conflicts로 센다(S70-76: 점검 창은 지웠고, 숫자만 서버 기록에 남는다).

export const MIRROR_MARK = 'won_mirror';
export const MIRROR_BUDGET_MS = 10000;
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const PARENTS_PER_LIST = 40;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export class DriveFail extends Error {
  constructor(status) { super('drive ' + status); this.status = Number(status) || 0; }
}
const cantFail = e => e instanceof DriveFail && (e.status === 403 || e.status === 404);
export const isDriveId = v => typeof v === 'string' && DRIVE_ID.test(v);

// S69-52: 마지막으로 맞춘 모양 표식. 이름은 지문(8자리)만 — 드라이브 표식 한 칸은 124바이트까지라 긴 한글 이름은 못 담는다.
export const SYNC_NAME = 'won_n';
export const SYNC_PARENT = 'won_p';
// 되돌리기 뒤 '양쪽 다 바뀜'으로 붙들어 두는 값(어떤 지문과도 같지 않음 — 다음 읽기가 어느 쪽도 덮어쓰지 않고 목록에 띄운다).
export const SYNC_HOLD = '0';
/** 이름 지문: NFC로 맞춘 이름의 FNV-1a 32비트(16진 8자리). */
export function nameSig(name) {
  const s = String(name ?? '').normalize('NFC');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** 자료실 폴더 이름 규칙(DB 검사 app_library_folders_name_check와 같음): 1~40자, 앞뒤 공백 없음, 제어 문자 없음. */
export const appNameOk = name => typeof name === 'string' && name.length >= 1 && [...name].length <= 40 && name === name.trim() && !/[\u0000-\u001f\u007f]/.test(name);

/**
 * 짝 폴더 하나의 이름·부모를 어느 쪽에 맞출지. 답 {name, parent}: 'same' | 'drive'(드라이브를 자료실처럼) | 'app'(자료실을 드라이브처럼)
 *   | 'legacy'(표식 없음 — 부르는 쪽이 정함: 맞추기는 자료실 기준, 점검은 '어느 쪽인지 모름') | 'conflict'(둘 다 바뀜·따라갈 수 없음).
 * app: {name, parentDrive(앱 부모의 짝 드라이브 id 또는 자료실 폴더 id)}, drive: {name, parents, appProperties},
 * appParentOf(driveId) → 앱 부모 id(자료실 폴더면 null) | undefined(자료실이 모르는 폴더).
 */
export function decideFolder(app, drive, appParentOf = () => undefined) {
  const props = drive?.appProperties && typeof drive.appProperties === 'object' ? drive.appProperties : {};
  const out = { name: 'same', parent: 'same' };
  if (drive.name !== app.name) {
    const base = props[SYNC_NAME];
    if (!base) out.name = 'legacy';
    else {
      const dCh = nameSig(drive.name) !== base, aCh = nameSig(app.name) !== base;
      out.name = dCh && !aCh ? (appNameOk(drive.name) ? 'app' : 'conflict') : aCh && !dCh ? 'drive' : dCh && aCh ? 'conflict' : 'drive';
    }
  }
  const ps = Array.isArray(drive.parents) ? drive.parents : [];
  if (app.parentDrive && (!ps.includes(app.parentDrive) || ps.length !== 1)) {
    const base = props[SYNC_PARENT], cur = ps.length === 1 ? ps[0] : null;
    if (!base) out.parent = 'legacy';
    else if (!cur) out.parent = 'drive';
    else {
      const dCh = cur !== base, aCh = app.parentDrive !== base;
      if (dCh && !aCh) out.parent = appParentOf(cur) === undefined ? 'conflict' : 'app';
      else out.parent = aCh && !dCh ? 'drive' : dCh && aCh ? 'conflict' : 'drive';
    }
  }
  return out;
}
/** 맞춘 뒤 붙일 표식(이미 같으면 빈 객체). */
export function stampFor(drive, name, parent) {
  const props = drive?.appProperties && typeof drive.appProperties === 'object' ? drive.appProperties : {};
  const out = {};
  if (name != null && props[SYNC_NAME] !== nameSig(name)) out[SYNC_NAME] = nameSig(name);
  if (parent != null && props[SYNC_PARENT] !== parent && String(parent).length <= 110) out[SYNC_PARENT] = parent;
  return out;
}

/**
 * S71-05 자료 한 개의 자리가 앱과 드라이브에서 다를 때 '드라이브가 이기는가' — 한 곳의 규칙.
 * 드라이브 맞추기(mirrorLibrary 2단계)와 자료실 열 때 따라가기(library-files drive-auto planFollow)가 같이 쓴다(중복 구현 금지).
 *   답 {to}: 드라이브에서 사람이 옮긴 것 → 자료실이 드라이브 부모의 짝 폴더(to)로 따라가고, 맞추기는 드라이브를 덮지 않는다.
 *   답 {skip}: 드라이브가 이기지 않음 → 따라가기는 그대로 두고, 맞추기는 앱 자리로 민다(지금까지와 같음).
 *     same(이미 같음) · loose(폴더 밖 자료 — 연결 줄이 없어 앱에서 언제 뺐는지 모름) · trashed(휴지통·안 보이는 폴더) · parents(부모가 하나가 아님)
 *     · top(드라이브 부모가 자료실 맨 위) · nopair(짝 없는 폴더) · unknown(옮긴 시각을 모름 — DB 칸 적용 전) · quiet(앱에서 FOLLOW_QUIET_MS 안에 옮김 = 앱이 이김).
 * 두 쪽이 같은 답을 쓰므로 어느 쪽이 먼저 돌아도 끝 자리가 같다: 따라가기가 먼저면 자료실이 바뀌어(옮긴 시각도 새로) 맞추기는 '이미 같음',
 *   맞추기가 먼저면 드라이브를 그대로 두고 다음 따라가기가 자료실을 고친다. 앱이 막 옮긴 것(quiet)은 따라가기가 쉬고 맞추기가 드라이브로 민다.
 * item: {folder_id, moved_at} | null · parents: 파일의 드라이브 부모 id들 · appPair: Map(보이는 자료실 폴더 id → 짝 드라이브 id 또는 null)
 * · pairOf: Map(드라이브 폴더 id → 보이는 자료실 폴더 id)
 */
export const FOLLOW_QUIET_MS = 30 * 60 * 1000; // S70-73c: 앱에서 옮긴 지 이 안이면 드라이브 위치를 따라가지 않음(드라이브 맞추기가 끝나기 전)
export function followTarget({ item, parents, appPair, pairOf, libraryId, now = Date.now(), quietMs = FOLLOW_QUIET_MS }) {
  if (!item?.folder_id) return { skip: 'loose' };
  if (!appPair.has(item.folder_id)) return { skip: 'trashed' };
  const ps = (Array.isArray(parents) ? parents : []).filter(isDriveId);
  if (ps.length !== 1) return { skip: 'parents' };
  const dp = ps[0];
  if (appPair.get(item.folder_id) === dp) return { skip: 'same' };
  if (dp === libraryId) return { skip: 'top' };
  const to = pairOf.get(dp);
  if (!to || to === item.folder_id) return { skip: 'nopair' };
  const at = Date.parse(String(item.moved_at ?? ''));
  if (!Number.isFinite(at)) return { skip: 'unknown' };
  if (now - at < quietMs) return { skip: 'quiet' };
  return { to };
}

export function parseMirrorBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'mode') return null;
  return body.mode === 'auto' ? 'auto' : null; // S70-76: 'align'([드라이브 폴더 맞추기])은 지웠다
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
 *  db.items() → [{document_id, folder_id, moved_at?}] (S71-05 moved_at: 드라이브에서 옮긴 것을 덮지 않는 판정 followTarget)
 *  db.documents() → [{id, file_id}]
 *  db.setDrive(id, drive, expect) → {ok, taken?}
 *  drive.get(id) → meta|null, drive.children(parentId) → [{id,name,mimeType,parents}], drive.createFolder(name,parent) → id,
 *  drive.list?(parentIds[]) → 그 부모들 바로 아래 전부(한 번에 묻기, 없으면 children을 하나씩),
 *  drive.patch(id, {name?, addParents?, removeParents?, appProperties?, trashed?}) — 실패는 DriveFail(status) throw.
 *  db.renameFolder?(id, name), db.moveFolder?(id, parentId|null) — S69-52 드라이브에서 바뀐 것을 자료실이 따라갈 때(없으면 따라가지 않고 conflicts로 셈).
 *  drive.createFolder(name, parent, appProperties?) — S69-52 새 짝 폴더에 처음부터 표식.
 *  now() → ms(시간 한도), clock() → ms(S71-05 옮긴 시각과 견주는 실제 시각)
 */
export async function mirrorLibrary({ libraryId, db, drive, now = Date.now, clock = Date.now, budgetMs = MIRROR_BUDGET_MS }) {
  const started = now();
  const out = { ok: true, state: 'not_aligned', folders_made: 0, folders_fixed: 0, files_moved: 0, cant: 0, pending: 0, left: 0, more: false, stopped: false, stage: null, app_renamed: 0, app_moved: 0, conflicts: 0, stamped: 0, drive_wins: 0 };
  if (typeof libraryId !== 'string' || !DRIVE_ID.test(libraryId)) return { ...out, state: 'none' };
  let lib;
  try { lib = await drive.get(libraryId); } catch (e) { return { ...out, ok: false, code: 'drive_unavailable', stage: 'library', pending: 1 }; }
  if (!lib || lib.trashed === true) return { ...out, ok: false, code: 'library_missing', stage: 'library' };
  const aligned = lib.appProperties?.[MIRROR_MARK] === '1';
  out.state = aligned ? 'aligned' : 'not_aligned';

  const late = () => now() - started > budgetMs;
  const failed = (e, stage) => { out.stage = out.stage || stage; out.pending++; return e; };

  // 부모 드라이브 폴더 → 바로 아래(폴더·파일). 여러 부모를 한 번에 묻는다.
  const kids = new Map();
  async function listMany(parents) {
    const need = [...new Set(parents)].filter(p => !kids.has(p));
    for (let i = 0; i < need.length; i += PARENTS_PER_LIST) {
      const batch = need.slice(i, i + PARENTS_PER_LIST);
      if (typeof drive.list === 'function') {
        const all = await drive.list(batch);
        for (const p of batch) kids.set(p, []);
        for (const c of Array.isArray(all) ? all : []) for (const p of Array.isArray(c.parents) ? c.parents : []) if (kids.has(p) && batch.includes(p)) kids.get(p).push(c);
      } else {
        for (const p of batch) kids.set(p, await drive.children(p));
      }
    }
  }
  const childrenOf = p => kids.get(p) || [];

  const folders = topDown(await db.folders());
  const pair = new Map(), used = new Set(), appOfDrive = new Map(), metaOf = new Map();
  for (const f of folders) if (isDriveId(f.drive_folder_id)) { used.add(f.drive_folder_id); appOfDrive.set(f.drive_folder_id, f.id); }
  // 드라이브 폴더 id → 앱 부모(자료실 폴더면 null, 모르는 폴더면 undefined). S69-52 드라이브에서 옮긴 폴더를 따라갈 때.
  const appParentOf = d => d === libraryId ? null : appOfDrive.get(d);
  const canFollow = typeof db.renameFolder === 'function' && typeof db.moveFolder === 'function';

  // 1) 폴더: 한 층씩(그 층의 부모들을 한 번에 읽고) 위에서 아래로.
  const byParent = new Map();
  for (const f of folders) { const k = f.parent_id || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(f); }
  let level = byParent.get('') || [];
  while (level.length && !out.stopped && !out.more) {
    const parents = level.map(f => f.parent_id ? pair.get(f.parent_id) : libraryId).filter(Boolean);
    try { await listMany(parents); } catch (e) { failed(e, 'list'); }
    const next = [];
    for (const f of level) {
      if (out.stopped) break;
      if (late()) { out.more = true; break; }
      const parent = f.parent_id ? pair.get(f.parent_id) : libraryId;
      if (!parent) { out.pending++; continue; }
      if (!kids.has(parent)) { out.pending++; continue; } // 그 부모 목록을 못 읽었으면 같은 이름 폴더를 또 만들지 않게 다음 부름으로
      try {
        let id = isDriveId(f.drive_folder_id) ? f.drive_folder_id : null;
        let meta = id ? childrenOf(parent).find(c => c.id === id) || null : null;
        if (id && !meta) meta = await drive.get(id); // 다른 곳으로 옮겨졌거나 지워짐
        if (meta && (meta.trashed === true || (meta.mimeType && meta.mimeType !== FOLDER_MIME))) meta = null;
        if (!meta) {
          const reuse = childrenOf(parent).find(c => c.mimeType === FOLDER_MIME && c.name === f.name && !used.has(c.id));
          const made = reuse ? reuse.id : await drive.createFolder(f.name, parent, { [SYNC_NAME]: nameSig(f.name), [SYNC_PARENT]: parent });
          if (!reuse) { out.folders_made++; if (kids.has(parent)) kids.get(parent).push({ id: made, name: f.name, mimeType: FOLDER_MIME, parents: [parent], appProperties: { [SYNC_NAME]: nameSig(f.name), [SYNC_PARENT]: parent } }); kids.set(made, []); }
          const saved = await db.setDrive(f.id, made, id);
          if (!saved?.ok) { out.pending++; continue; }
          if (id) { used.delete(id); appOfDrive.delete(id); }
          used.add(made); appOfDrive.set(made, f.id); pair.set(f.id, made); next.push(...(byParent.get(f.id) || []));
          metaOf.set(f.id, reuse ? { ...reuse, appProperties: reuse.appProperties || {} } : { id: made, name: f.name, parents: [parent], appProperties: { [SYNC_NAME]: nameSig(f.name), [SYNC_PARENT]: parent } });
          continue;
        }
        // S69-52: 어느 쪽이 바뀌었는지 보고 맞춘다(표식 없는 옛 짝은 지금까지와 같이 자료실 기준).
        const d = decideFolder({ name: f.name, parentDrive: parent }, meta, appParentOf);
        const nameAct = d.name === 'legacy' ? 'drive' : d.name, parentAct = d.parent === 'legacy' ? 'drive' : d.parent;
        const patch = {};
        let agreedName = f.name, agreedParent = parent, conflict = false;
        if (nameAct === 'drive') patch.name = f.name;
        else if (nameAct === 'app') {
          if (canFollow) { await db.renameFolder(f.id, meta.name); f.name = meta.name; agreedName = meta.name; out.app_renamed++; }
          else { conflict = true; agreedName = null; }
        } else if (nameAct === 'conflict') { conflict = true; agreedName = null; }
        const ps = Array.isArray(meta.parents) ? meta.parents : [];
        if (parentAct === 'drive') { patch.addParents = parent; const rm = ps.filter(p => p !== parent); if (rm.length) patch.removeParents = rm.join(','); }
        else if (parentAct === 'app') {
          const to = appParentOf(ps[0]);
          if (canFollow && to !== undefined) { await db.moveFolder(f.id, to); f.parent_id = to; agreedParent = ps[0]; out.app_moved++; }
          else { conflict = true; agreedParent = null; }
        } else if (parentAct === 'conflict') { conflict = true; agreedParent = null; }
        if (conflict) out.conflicts++;
        const stamp = stampFor(meta, agreedName, agreedParent);
        if (Object.keys(patch).length) {
          if (Object.keys(stamp).length) patch.appProperties = stamp;
          await drive.patch(id, patch); out.folders_fixed++;
          meta = { ...meta, appProperties: { ...(meta.appProperties || {}), ...stamp } };
        }
        metaOf.set(f.id, meta);
        pair.set(f.id, id); next.push(...(byParent.get(f.id) || []));
      } catch (e) { failed(e, 'folders'); }
    }
    level = next;
  }

  // 2) 자료(폴더를 모두 맞춘 뒤에만): 자료실 나무 안 파일 자리를 한 번에 읽고, 옮길 것만 차례로 옮긴다.
  if (!out.stopped && !out.more) {
    const visible = new Set(folders.map(f => f.id));
    const managed = [libraryId, ...pair.values()];
    try { await listMany(managed); } catch (e) { failed(e, 'list'); }
    if (!out.stopped) {
      const where = new Map(), parentsOf = new Map();
      for (const folderId of managed) for (const c of childrenOf(folderId)) if (c.mimeType !== FOLDER_MIME) { where.set(c.id, folderId); parentsOf.set(c.id, Array.isArray(c.parents) && c.parents.length ? c.parents : [folderId]); }
      const itemOf = new Map((await db.items()).map(i => [i.document_id, i]));
      const followNow = clock(); // 옮긴 시각과 견주는 실제 시각(now는 시간 한도용 — 시험이 작은 수로 돌림)
      const todo = [];
      for (const doc of await db.documents()) {
        const file = doc.file_id, cur = where.get(file);
        if (!file || !cur) continue; // 자료실 나무 밖 파일(회의자료·바구니 등)은 그대로
        const item = itemOf.get(doc.id) || null, folderId = item?.folder_id || null;
        if (folderId && !visible.has(folderId)) continue; // 휴지통 폴더 안 자료는 그대로
        const target = folderId ? pair.get(folderId) : libraryId;
        if (!target) { out.pending++; continue; }
        if (target === cur) continue;
        // S71-05: 드라이브에서 사람이 옮긴 것(따라가기가 자료실을 고칠 것)은 덮지 않는다 — followTarget 한 곳의 규칙.
        if (followTarget({ item, parents: parentsOf.get(file), appPair: pair, pairOf: appOfDrive, libraryId, now: followNow }).to) { out.drive_wins++; continue; }
        todo.push([file, cur, target]);
      }
      out.left = todo.length;
      for (const [file, cur, target] of todo) {
        if (out.stopped) break;
        if (late()) { out.more = true; break; }
        try { await drive.patch(file, { addParents: target, removeParents: cur }); out.files_moved++; out.left--; where.set(file, target); }
        catch (e) { if (cantFail(e)) { out.cant++; out.left--; } else failed(e, 'files'); }
      }
    }
  }

  // S69-52: 표식이 없는(또는 낡은) 짝 폴더에 '지금 맞춘 모양' 표식을 남은 시간 안에서 붙인다(한 번 붙으면 다시 하지 않음 — 다음 부름에 이어서).
  // 이름·부모가 이미 같은 것만(다른 것은 위에서 고치며 붙였다). 실패는 대기로 세지 않는다(맞추기에는 영향 없음).
  if (!out.stopped && !out.more) {
    for (const f of folders) {
      if (late()) break;
      const id = pair.get(f.id), meta = metaOf.get(f.id);
      if (!id || !meta) continue;
      const parent = f.parent_id ? pair.get(f.parent_id) : libraryId;
      if (meta.name !== f.name || !parent || !(Array.isArray(meta.parents) && meta.parents.length === 1 && meta.parents[0] === parent)) continue;
      const stamp = stampFor(meta, f.name, parent);
      if (!Object.keys(stamp).length) continue;
      try { await drive.patch(id, { appProperties: stamp }); out.stamped++; } catch { /* 다음에 다시 */ }
    }
  }

  // 3) 맞춤 표시: 처음으로 끝까지(남은 것·대기 없이) 맞췄을 때 한 번(S70-76: 'auto'가 저절로).
  if (!aligned && !out.more && !out.stopped && out.pending === 0) {
    try { await drive.patch(libraryId, { appProperties: { [MIRROR_MARK]: '1' } }); out.state = 'aligned'; }
    catch (e) { failed(e, 'mark'); }
  }
  return out;
}
