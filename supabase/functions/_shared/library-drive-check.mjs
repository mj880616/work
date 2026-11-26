// S69-52 ①(사용자 11/24 15:53 "파일 안에서 자료실에 해당하는 구글 드라이브 폴더를 클릭하면 자료실과 사실상 내용이 동일", 16:02 'ㄱ'):
// 자료실 ⋯ [드라이브와 맞는지 보기] — 자료실 폴더·자료와 드라이브 '자료실' 폴더 나무가 어긋난 곳을 찾아(scan) 보여 주고,
// 사용자가 고른 줄만(또는 모두) 맞추고(fix), 마지막 맞추기를 되돌린다(undo). workspace-drive POST ?action=drive-check가 부른다.
// DOM·네트워크 없음(db·drive는 부르는 쪽이 넣는다). 시험: tests/library-drive-check.test.mjs.
//
// 규칙(한 곳):
// - 폴더 구조의 원본은 드라이브 폴더, 자료실 폴더는 id(app_library_folders.drive_folder_id)로 대응하고 업무 정보(분류·조직·자료 연결)만 더 가진다.
// - 어긋남 다섯 가지(줄마다 [맞추기]):
//     missing  드라이브에 없는 자료실 폴더(짝이 없거나 지워짐) → 부모 짝 폴더 안에 같은 이름 폴더를 다시 쓰거나 만든다
//     extra    자료실에 없는 드라이브 폴더(자료실 나무 안) → 자료실에 같은 이름 폴더를 만들어 짝을 맺는다(드라이브가 원본)
//     file     다른 폴더에 있는 파일(자료는 자료실 폴더 X인데 드라이브 파일은 X의 짝 폴더가 아님) → 드라이브 파일을 X의 짝 폴더로 옮긴다(복사 아님)
//     name     이름 다른 폴더 → 바뀐 쪽을 알면 그쪽으로, 모르면 드라이브 이름으로(원본). 줄에서 반대쪽으로도 고를 수 있다
//     place    자리 다른 폴더(드라이브 부모가 자료실 부모의 짝이 아님) → 같은 규칙
// - '연결된 원본'(드라이브에서 가져오기로 연결만 한 파일 — 자료실 나무 밖 원래 자리)은 옮기지 않는다. 줄이 아니라 개수로만 보여 준다(linked).
//   자료실 나무 밖의 다른 앱 파일(회의자료·바구니 등)도 옮기지 않는다(outside).
// - 자동으로 지우지 않는다. 드라이브는 휴지통까지만(되돌리기에서 우리가 만든 빈 폴더만), 자료실 폴더는 자료실 휴지통까지만(되돌리기에서 우리가 만든 폴더만).
// - 되돌리기 기록은 드라이브 표식(appProperties)에 둔다(DB 변경 없음, library-files top-files와 같은 꼴):
//     won_sb 이번 맞추기 번호 · won_sa 한 일(쉼표 목록) · won_sf 옮기기 전 부모 · won_so1~4 바꾸기 전 이름 · won_sx 앱 폴더 id
//     won_sp 바꾸기 전 짝 · won_bn·won_bp 맞추기 전 '마지막으로 맞춘 모양' 표식(library-mirror SYNC_NAME·SYNC_PARENT)
//   한 일: mvf 파일 옮김 · mvd 드라이브 폴더 옮김 · rnd 드라이브 폴더 이름 바꿈 · mkd 드라이브 폴더 만듦 · pr 있던 드라이브 폴더와 짝
//          rna 자료실 폴더 이름 바꿈 · mva 자료실 폴더 옮김 · mka 자료실 폴더 만듦
// - 작업공간·드라이브 연결은 서버가 정한다(로그인한 사람의 owner 작업공간). 화면이 보내는 값은 줄 종류·id·방향·맞추기 번호뿐이고,
//   서버가 맞추기 때마다 다시 살펴(scan) 지금도 어긋난 줄만 고친다(화면이 보낸 id를 믿지 않음). 앱 표는 내 토큰(owner RLS)으로만 읽고 쓴다.
// - 한 번 부를 때 CHECK_BUDGET_MS까지만 하고 남으면 left > 0(화면이 이어서 부름).
// - 다루는 값은 폴더·자료 이름·id뿐(파일 내용은 열지 않음). 로그에는 숫자만.
import { DriveFail, FOLDER_MIME, PARENTS_PER_LIST, SYNC_HOLD, SYNC_NAME, SYNC_PARENT, appNameOk, decideFolder, isDriveId, nameSig, stampFor, topDown } from './library-mirror.mjs';

export const CHECK_BUDGET_MS = 10000;
export const TREE_MAX_FOLDERS = 3000;
export const LINES_MAX = 300; // 종류마다 화면에 보내는 줄 최대(개수는 모두 셈)
export const FIX_MAX = 500;   // 한 번에 고를 수 있는 줄 최대
export const KINDS = Object.freeze(['missing', 'extra', 'name', 'place', 'file']);
export const MARK = Object.freeze({ batch: 'won_sb', act: 'won_sa', from: 'won_sf', old: 'won_so', app: 'won_sx', prev: 'won_sp', baseName: 'won_bn', baseParent: 'won_bp' });
const OLD_PARTS = 4, OLD_PART_BYTES = 110;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH = /^[a-z0-9]{8,40}$/;
const IMPORTED_NOTE = '드라이브에서 가져옴';
const cantFail = e => e instanceof DriveFail && (e.status === 403 || e.status === 404);
const enc = new TextEncoder();

/** 이름을 드라이브 표식 칸(한 칸 124바이트)에 나눠 담는다. 너무 길면 null(이름 되돌리기만 못 함). */
export function packName(name) {
  const parts = [];
  let cur = '';
  for (const ch of String(name ?? '')) {
    if (enc.encode(cur + ch).length > OLD_PART_BYTES) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur || !parts.length) parts.push(cur);
  if (parts.length > OLD_PARTS) return null;
  const out = {};
  for (let i = 0; i < OLD_PARTS; i++) out[MARK.old + (i + 1)] = i < parts.length ? parts[i] : null;
  return out;
}
export function unpackName(props) {
  const p = props && typeof props === 'object' ? props : {};
  if (typeof p[MARK.old + '1'] !== 'string') return null;
  let s = '';
  for (let i = 1; i <= OLD_PARTS; i++) if (typeof p[MARK.old + i] === 'string') s += p[MARK.old + i];
  return s;
}
/** 되돌리기 표식을 모두 지우는 값(드라이브는 null이면 그 칸을 지운다). */
export function clearMarks() {
  const out = { [MARK.batch]: null, [MARK.act]: null, [MARK.from]: null, [MARK.app]: null, [MARK.prev]: null, [MARK.baseName]: null, [MARK.baseParent]: null };
  for (let i = 1; i <= OLD_PARTS; i++) out[MARK.old + i] = null;
  return out;
}
export const newBatch = (now = Date.now(), rnd = Math.random) => now.toString(36) + Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, '0');

// 요청 모양:
//   {op:'scan'} | {op:'fix', all:true[, batch]} | {op:'fix', lines:[{kind,id[,to]}…][, batch]} | {op:'undo', batch}. 아니면 null.
export function parseCheckBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const keys = Object.keys(input).sort().join(',');
  if (input.op === 'scan') return keys === 'op' ? { op: 'scan' } : null;
  if (input.op === 'undo') return keys === 'batch,op' && BATCH.test(String(input.batch)) ? { op: 'undo', batch: input.batch } : null;
  if (input.op !== 'fix') return null;
  const batch = 'batch' in input ? input.batch : null;
  if (batch !== null && !BATCH.test(String(batch))) return null;
  const rest = keys.split(',').filter(k => k !== 'batch').join(',');
  if (rest === 'all,op') return input.all === true ? { op: 'fix', all: true, lines: null, batch } : null;
  if (rest !== 'lines,op' || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > FIX_MAX) return null;
  const lines = [];
  const seen = new Set();
  for (const l of input.lines) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
    const lk = Object.keys(l).sort().join(',');
    if (lk !== 'id,kind' && lk !== 'id,kind,to') return null;
    if (!KINDS.includes(l.kind)) return null;
    const idOk = l.kind === 'extra' ? isDriveId(l.id) : UUID.test(String(l.id));
    if (!idOk) return null;
    if ('to' in l && !((l.kind === 'name' || l.kind === 'place') && (l.to === 'app' || l.to === 'drive'))) return null;
    const key = l.kind + ':' + l.id;
    if (seen.has(key)) return null;
    seen.add(key);
    lines.push({ kind: l.kind, id: l.id, ...(l.to ? { to: l.to } : {}) });
  }
  return { op: 'fix', all: false, lines, batch };
}

/**
 * deps (library-mirror와 같은 꼴 + 더):
 *  db.folders() → [{id,parent_id,name,sort_order,drive_folder_id}] (owner RLS, 휴지통 숨김)
 *  db.items() → [{document_id, folder_id}], db.documents() → [{id, file_id, title, file_name, classification_note}]
 *  db.setDrive(id, drive, expect) → {ok, taken?}, db.renameFolder(id,name), db.moveFolder(id,parent|null),
 *  db.createFolder({parent_id,name}) → {id}, db.deleteFolder(id)(자료실 휴지통으로)
 *  drive.get(id) → meta|null, drive.list(parentIds[]) → 그 부모들 바로 아래(id,name,mimeType,parents,appProperties),
 *  drive.createFolder(name,parent,appProperties) → id, drive.patch(id,{name?,addParents?,removeParents?,appProperties?,trashed?}),
 *  drive.marked(batch) → 이 번호 표식이 붙은 것 전부(id,name,mimeType,parents,appProperties,trashed)
 */
async function readState({ libraryId, db, drive }) {
  if (!isDriveId(libraryId)) return { ok: false, code: 'none' };
  let lib;
  try { lib = await drive.get(libraryId); } catch { return { ok: false, code: 'drive_unavailable' }; }
  if (!lib || lib.trashed === true) return { ok: false, code: 'library_missing' };
  const folders = topDown(await db.folders());
  const visible = new Map(folders.map(f => [f.id, f]));
  // 드라이브 자료실 나무를 한 층씩(부모 여러 개를 한 번에) 읽는다.
  const dFolders = new Map(), where = new Map(), dChildren = new Map([[libraryId, []]]);
  let level = [libraryId], partial = false;
  while (level.length) {
    const next = [];
    for (let i = 0; i < level.length; i += PARENTS_PER_LIST) {
      const batch = level.slice(i, i + PARENTS_PER_LIST);
      const all = await drive.list(batch);
      for (const c of Array.isArray(all) ? all : []) {
        if (!isDriveId(c?.id) || c.trashed === true) continue;
        const p = (Array.isArray(c.parents) ? c.parents : []).find(x => batch.includes(x));
        if (!p) continue;
        if (c.mimeType === FOLDER_MIME) {
          if (dFolders.has(c.id)) continue;
          if (dFolders.size >= TREE_MAX_FOLDERS) { partial = true; continue; }
          dFolders.set(c.id, { ...c, at: p });
          dChildren.get(p)?.push(c.id);
          dChildren.set(c.id, []);
          next.push(c.id);
        } else where.set(c.id, p);
      }
    }
    level = next;
  }
  // 앱 폴더의 짝: 나무 안에서 찾고, 없으면 한 번 더 묻는다(나무 밖으로 옮겨졌거나 지워짐).
  const pairMeta = new Map();
  for (const f of folders) {
    const id = isDriveId(f.drive_folder_id) ? f.drive_folder_id : null;
    if (!id) continue;
    let m = dFolders.get(id) || null;
    if (!m) { try { m = await drive.get(id); } catch (e) { if (!cantFail(e)) throw e; m = null; } if (m) m = { ...m, outside: true }; }
    if (m && m.trashed !== true && (!m.mimeType || m.mimeType === FOLDER_MIME)) pairMeta.set(f.id, m);
  }
  const appOfDrive = new Map();
  for (const [fid, m] of pairMeta) appOfDrive.set(m.id, fid);
  const docs = await db.documents();
  const itemOf = new Map((await db.items()).map(i => [i.document_id, i.folder_id]));
  return { ok: true, lib, folders, visible, dFolders, dChildren, where, pairMeta, appOfDrive, docs, itemOf, partial, libraryId };
}

// 드라이브 폴더 하나가 앱이 따로 쓰는 폴더인가('정리 대기'·첨부 폴더 등 다른 기능의 표식) — 자료실 폴더로 세지 않는다.
const appUse = m => { const p = m?.appProperties && typeof m.appProperties === 'object' ? m.appProperties : {}; return Object.keys(p).some(k => k.startsWith('won_tidy') || k.startsWith('kptu_')); };

/** 지금 상태 → 어긋남 줄. 순수(읽은 값만). */
export function judge(st) {
  const { folders, visible, dFolders, where, pairMeta, appOfDrive, docs, itemOf, libraryId } = st;
  const appPath = id => { const names = []; let cur = visible.get(id); for (let d = 0; cur && d < 120; d++) { names.unshift(cur.name); cur = cur.parent_id ? visible.get(cur.parent_id) : null; } return names; };
  const drivePath = id => { const names = []; let cur = dFolders.get(id); for (let d = 0; cur && d < 120; d++) { names.unshift(String(cur.name || '')); cur = dFolders.get(cur.at); } return names; };
  const appParentOf = d => d === libraryId ? null : appOfDrive.get(d);
  const expectedParent = f => f.parent_id ? pairMeta.get(f.parent_id)?.id || null : libraryId;
  const lines = { missing: [], extra: [], name: [], place: [], file: [] };
  // 표식으로 앱이 쓰는 폴더 아래는 통째로 뺀다.
  const skip = new Set();
  for (const [id, m] of dFolders) { let cur = m; for (let d = 0; cur && d < 120; d++) { if (appUse(cur)) { skip.add(id); break; } cur = dFolders.get(cur.at); } }
  for (const f of folders) {
    const m = pairMeta.get(f.id);
    if (!m) { lines.missing.push({ kind: 'missing', id: f.id, name: f.name, path: appPath(f.id) }); continue; }
    const parentDrive = expectedParent(f);
    const d = decideFolder({ name: f.name, parentDrive }, m, appParentOf);
    if (d.name !== 'same') {
      const suggest = d.name === 'app' ? 'app' : d.name === 'drive' ? 'drive' : null;
      lines.name.push({ kind: 'name', id: f.id, app_name: f.name, drive_name: String(m.name || ''), path: appPath(f.id), suggest, can_app: appNameOk(m.name) });
    }
    if (d.parent !== 'same' && parentDrive) {
      const cur = Array.isArray(m.parents) && m.parents.length === 1 ? m.parents[0] : null;
      const canApp = !!cur && appParentOf(cur) !== undefined && appParentOf(cur) !== f.id;
      const suggest = d.parent === 'app' && canApp ? 'app' : d.parent === 'drive' ? 'drive' : null;
      lines.place.push({ kind: 'place', id: f.id, name: f.name, path: appPath(f.id), drive_path: m.outside ? null : drivePath(m.id), outside: !!m.outside, suggest, can_app: canApp });
    }
  }
  const paired = new Set([...pairMeta.values()].map(m => m.id));
  const depth = id => { let n = 0, cur = dFolders.get(id); while (cur && n < 120) { n++; cur = dFolders.get(cur.at); } return n; };
  for (const [id, m] of dFolders) {
    if (paired.has(id) || skip.has(id)) continue;
    const parentPaired = m.at === libraryId || appOfDrive.has(m.at);
    const props = m.appProperties && typeof m.appProperties === 'object' ? m.appProperties : {};
    lines.extra.push({ kind: 'extra', id, name: String(m.name || ''), path: drivePath(id), depth: depth(id), parent_ready: parentPaired, in_trash: !!props[SYNC_NAME], can_app: appNameOk(m.name) });
  }
  lines.extra.sort((a, b) => a.depth - b.depth || a.path.join('/').localeCompare(b.path.join('/'), 'ko'));
  let linked = 0, outside = 0, waiting = 0;
  const linkedLines = [];
  for (const doc of docs) {
    const file = doc.file_id;
    if (!isDriveId(file)) continue;
    const folderId = itemOf.get(doc.id) || null;
    if (folderId && !visible.has(folderId)) continue; // 휴지통 폴더 안 자료는 그대로
    const cur = where.get(file);
    if (!cur) {
      if (String(doc.classification_note || '').startsWith(IMPORTED_NOTE)) { linked++; if (linkedLines.length < LINES_MAX) linkedLines.push({ id: doc.id, title: String(doc.title || doc.file_name || '') }); }
      else outside++;
      continue;
    }
    const target = folderId ? pairMeta.get(folderId)?.id || null : libraryId;
    if (!target) { waiting++; continue; } // 폴더 짝부터(missing 줄)
    if (target === cur) continue;
    lines.file.push({ kind: 'file', id: doc.id, title: String(doc.title || doc.file_name || ''), from: cur === libraryId ? [] : drivePath(cur), to: folderId ? appPath(folderId) : [], file_id: file, from_id: cur, to_id: target });
  }
  const counts = {};
  for (const k of KINDS) counts[k] = lines[k].length;
  return { lines, counts, linked, linked_lines: linkedLines, outside, waiting };
}

/** 화면에 보낼 모양(내부 id는 뺀다). */
export function scanView(st, j) {
  const view = {};
  for (const k of KINDS) view[k] = j.lines[k].slice(0, LINES_MAX).map(({ file_id, from_id, to_id, depth, ...rest }) => rest);
  return { ok: true, counts: j.counts, lines: view, linked: j.linked, linked_lines: j.linked_lines, outside: j.outside, waiting: j.waiting, partial: !!st.partial, total: KINDS.reduce((a, k) => a + j.counts[k], 0) };
}

export async function scanLibrary(deps) {
  const st = await readState(deps);
  if (!st.ok) return { ok: false, code: st.code };
  return scanView(st, judge(st));
}

// 표식 한 묶음(되돌리기 기록) 만들기. acts에 더하고, 처음 붙일 때만 맞추기 전 표식을 적는다.
function undoMarks(meta, batch, act, extra = {}) {
  const p = meta?.appProperties && typeof meta.appProperties === 'object' ? meta.appProperties : {};
  const same = p[MARK.batch] === batch;
  const acts = same && typeof p[MARK.act] === 'string' ? p[MARK.act].split(',').filter(Boolean) : [];
  if (!acts.includes(act)) acts.push(act);
  const out = { [MARK.batch]: batch, [MARK.act]: acts.join(','), ...extra };
  if (!same) { out[MARK.baseName] = p[SYNC_NAME] || ''; out[MARK.baseParent] = p[SYNC_PARENT] || ''; }
  return out;
}

const ORDER = { missing: 0, extra: 1, name: 2, place: 3, file: 4 };

/**
 * 고른 줄(또는 모두) 맞추기. 답 {ok, batch, done, failed, cant, skipped, left, reasons:{…}, more}
 * reasons: parent_first(위 폴더부터) · long_name(이름이 자료실 규칙에 안 맞음) · in_trash(자료실 휴지통 폴더의 짝) · gone(이미 맞음·없어짐) · cant_app(자료실이 모르는 자리)
 */
export async function fixLibrary({ libraryId, db, drive, lines = null, all = false, batch = null, now = Date.now, budgetMs = CHECK_BUDGET_MS, makeBatch = newBatch }) {
  const started = now();
  const late = () => now() - started > budgetMs;
  const st = await readState({ libraryId, db, drive });
  if (!st.ok) return { ok: false, code: st.code };
  const j = judge(st);
  const b = batch && BATCH.test(batch) ? batch : makeBatch();
  const out = { ok: true, batch: b, done: 0, failed: 0, cant: 0, skipped: 0, left: 0, more: false, reasons: {} };
  const why = r => { out.skipped++; out.reasons[r] = (out.reasons[r] || 0) + 1; };
  const now_ = new Map();
  for (const k of KINDS) for (const l of j.lines[k]) now_.set(k + ':' + l.id, l);
  let todo;
  if (all) todo = KINDS.flatMap(k => j.lines[k].map(l => ({ kind: k, id: l.id })));
  else todo = (lines || []).map(l => ({ ...l }));
  todo.sort((a, b2) => ORDER[a.kind] - ORDER[b2.kind]);
  const { pairMeta, appOfDrive, visible, dFolders, dChildren } = st;
  const pairOf = fid => fid ? pairMeta.get(fid)?.id || null : libraryId;
  const usedDrive = new Set([...pairMeta.values()].map(m => m.id));
  for (let i = 0; i < todo.length; i++) {
    if (late()) { out.more = true; out.left = todo.length - i; break; }
    const want = todo[i];
    const line = now_.get(want.kind + ':' + want.id);
    if (!line) { why('gone'); continue; }
    try {
      if (want.kind === 'missing') {
        const f = visible.get(want.id);
        const parent = pairOf(f.parent_id);
        if (!parent) { why('parent_first'); continue; }
        const old = isDriveId(f.drive_folder_id) ? f.drive_folder_id : null;
        const reuseId = (dChildren.get(parent) || []).find(id => { const m = dFolders.get(id); return m && m.name === f.name && !usedDrive.has(id) && !appUse(m); });
        let made;
        if (reuseId) {
          const m = dFolders.get(reuseId);
          made = reuseId;
          const saved = await db.setDrive(f.id, made, old);
          if (!saved?.ok) { why(saved?.taken ? 'in_trash' : 'gone'); continue; }
          await drive.patch(made, { appProperties: { ...undoMarks(m, b, 'pr', { [MARK.app]: f.id, [MARK.prev]: old || '' }), ...stampFor(m, f.name, parent) } });
        } else {
          made = await drive.createFolder(f.name, parent, { [SYNC_NAME]: nameSig(f.name), [SYNC_PARENT]: parent, ...undoMarks({}, b, 'mkd', { [MARK.app]: f.id, [MARK.prev]: old || '' }) });
          const saved = await db.setDrive(f.id, made, old);
          if (!saved?.ok) { out.failed++; continue; } // 만든 빈 폴더는 남는다(되돌리기 번호가 붙어 있어 [되돌리기]가 휴지통으로)
        }
        usedDrive.add(made); appOfDrive.set(made, f.id);
        const meta = { id: made, name: f.name, parents: [parent], at: parent, appProperties: { [SYNC_NAME]: nameSig(f.name), [SYNC_PARENT]: parent } };
        pairMeta.set(f.id, meta); dFolders.set(made, meta); if (!dChildren.has(made)) dChildren.set(made, []);
        out.done++;
      } else if (want.kind === 'extra') {
        const m = dFolders.get(want.id);
        if (line.in_trash) { why('in_trash'); continue; }
        if (!appNameOk(m.name)) { why('long_name'); continue; }
        const parentApp = m.at === libraryId ? null : appOfDrive.get(m.at);
        if (parentApp === undefined) { why('parent_first'); continue; }
        const row = await db.createFolder({ parent_id: parentApp, name: m.name });
        if (!row?.id) { out.failed++; continue; }
        const saved = await db.setDrive(row.id, m.id, null);
        if (!saved?.ok) { await db.deleteFolder(row.id); why(saved?.taken ? 'in_trash' : 'gone'); continue; }
        await drive.patch(m.id, { appProperties: { ...undoMarks(m, b, 'mka', { [MARK.app]: row.id }), ...stampFor(m, m.name, m.at) } });
        appOfDrive.set(m.id, row.id); usedDrive.add(m.id);
        const f = { id: row.id, parent_id: parentApp, name: m.name, drive_folder_id: m.id };
        visible.set(row.id, f); pairMeta.set(row.id, m);
        out.done++;
      } else if (want.kind === 'name') {
        const f = visible.get(want.id), m = pairMeta.get(want.id);
        const to = want.to || line.suggest || (line.can_app ? 'app' : 'drive');
        if (to === 'app') {
          if (!appNameOk(m.name)) { why('long_name'); continue; }
          const old = packName(f.name);
          await db.renameFolder(f.id, m.name);
          await drive.patch(m.id, { appProperties: { ...undoMarks(m, b, 'rna', { [MARK.app]: f.id, ...(old || {}) }), [SYNC_NAME]: nameSig(m.name) } });
          f.name = m.name;
        } else {
          const old = packName(m.name);
          await drive.patch(m.id, { name: f.name, appProperties: { ...undoMarks(m, b, 'rnd', { [MARK.app]: f.id, ...(old || {}) }), [SYNC_NAME]: nameSig(f.name) } });
          m.name = f.name;
        }
        out.done++;
      } else if (want.kind === 'place') {
        const f = visible.get(want.id), m = pairMeta.get(want.id);
        const cur = Array.isArray(m.parents) && m.parents.length === 1 ? m.parents[0] : null;
        const to = want.to || line.suggest || (line.can_app ? 'app' : 'drive');
        if (to === 'app') {
          const parentApp = cur === libraryId ? null : appOfDrive.get(cur);
          if (!cur || parentApp === undefined || parentApp === f.id) { why('cant_app'); continue; }
          await db.moveFolder(f.id, parentApp);
          await drive.patch(m.id, { appProperties: { ...undoMarks(m, b, 'mva', { [MARK.app]: f.id, [MARK.from]: f.parent_id || 'top' }), [SYNC_PARENT]: cur } });
          f.parent_id = parentApp;
        } else {
          const parent = pairOf(f.parent_id);
          if (!parent) { why('parent_first'); continue; }
          const ps = Array.isArray(m.parents) ? m.parents : [];
          const rm = ps.filter(p => p !== parent);
          await drive.patch(m.id, { addParents: parent, ...(rm.length ? { removeParents: rm.join(',') } : {}), appProperties: { ...undoMarks(m, b, 'mvd', { [MARK.app]: f.id, [MARK.from]: cur || '' }), [SYNC_PARENT]: parent } });
          m.parents = [parent];
        }
        out.done++;
      } else if (want.kind === 'file') {
        const l = line;
        // 짝이 방금 생겼을 수 있다(같은 부름의 missing) — 지금 짝으로 다시 본다.
        const target = l.to_id;
        await drive.patch(l.file_id, { addParents: target, removeParents: l.from_id, appProperties: undoMarks({}, b, 'mvf', { [MARK.from]: l.from_id }) });
        out.done++;
      }
    } catch (e) {
      if (cantFail(e)) out.cant++;
      else if (e instanceof DriveFail) { out.failed++; out.more = true; out.left = todo.length - i - 1; break; }
      else out.failed++;
    }
  }
  return out;
}

/**
 * 마지막 맞추기 되돌리기(같은 번호 표식이 붙은 것만). 답 {ok, restored, cant, left, more}
 * 파일 먼저 → 이름·자리 → 짝·만든 폴더(만든 드라이브 폴더는 비었을 때만 드라이브 휴지통, 만든 자료실 폴더는 자료실 휴지통).
 */
export async function undoLibrary({ libraryId, db, drive, batch, now = Date.now, budgetMs = CHECK_BUDGET_MS }) {
  const started = now();
  const late = () => now() - started > budgetMs;
  const out = { ok: true, restored: 0, cant: 0, left: 0, more: false };
  if (!BATCH.test(String(batch)) || !isDriveId(libraryId)) return { ...out, ok: false, code: 'bad_batch' };
  const all = (await drive.marked(batch)).filter(m => m?.appProperties?.[MARK.batch] === batch && isDriveId(m.id));
  const rank = m => { const a = String(m.appProperties[MARK.act] || ''); return a.includes('mvf') ? 0 : /mkd|mka|pr/.test(a) ? 2 : 1; };
  all.sort((a, b) => rank(a) - rank(b));
  const afterFiles = new Set(all.filter(m => rank(m) === 0).map(m => m.id));
  for (let i = 0; i < all.length; i++) {
    if (late()) { out.more = true; out.left = all.length - i; break; }
    const m = all[i], p = m.appProperties;
    const acts = String(p[MARK.act] || '').split(',').filter(Boolean);
    const appId = UUID.test(String(p[MARK.app] || '')) ? p[MARK.app] : null;
    const patch = { appProperties: clearMarks() };
    // 맞추기 전 '마지막으로 맞춘 모양'으로(없었으면 붙들어 두는 값 — 다음 읽기가 어느 쪽도 덮어쓰지 않고 목록에 띄운다).
    const holdName = p[MARK.baseName] ? p[MARK.baseName] : SYNC_HOLD, holdParent = p[MARK.baseParent] ? p[MARK.baseParent] : SYNC_HOLD;
    try {
      let trash = false;
      for (const a of acts) {
        if (a === 'mvf' || a === 'mvd') {
          const from = p[MARK.from];
          const ps = Array.isArray(m.parents) ? m.parents : [];
          if (isDriveId(from) && !ps.includes(from)) { patch.addParents = from; if (ps.length) patch.removeParents = ps.join(','); }
          if (a === 'mvd') patch.appProperties[SYNC_PARENT] = holdParent;
        } else if (a === 'rnd') {
          const old = unpackName(p);
          if (old) patch.name = old;
          patch.appProperties[SYNC_NAME] = holdName;
        } else if (a === 'rna') {
          const old = unpackName(p);
          if (appId && old && appNameOk(old)) await db.renameFolder(appId, old);
          patch.appProperties[SYNC_NAME] = holdName;
        } else if (a === 'mva') {
          const from = p[MARK.from];
          if (appId && (from === 'top' || UUID.test(String(from)))) await db.moveFolder(appId, from === 'top' ? null : from);
          patch.appProperties[SYNC_PARENT] = holdParent;
        } else if (a === 'pr') {
          const prev = isDriveId(p[MARK.prev]) ? p[MARK.prev] : null;
          if (appId) await db.setDrive(appId, prev, m.id);
          patch.appProperties[SYNC_NAME] = p[MARK.baseName] || null; patch.appProperties[SYNC_PARENT] = p[MARK.baseParent] || null;
        } else if (a === 'mka') {
          if (appId) { await db.setDrive(appId, null, m.id); await db.deleteFolder(appId); }
          patch.appProperties[SYNC_NAME] = null; patch.appProperties[SYNC_PARENT] = null;
        } else if (a === 'mkd') {
          const prev = isDriveId(p[MARK.prev]) ? p[MARK.prev] : null;
          if (appId) await db.setDrive(appId, prev, m.id);
          // 우리가 만든 폴더 — 안이 비었으면(옮긴 파일을 먼저 되돌렸으니) 드라이브 휴지통으로. 무언가 있으면 그대로 둔다.
          const inside = await drive.list([m.id]);
          if (!(Array.isArray(inside) ? inside : []).some(c => c && c.trashed !== true && !afterFiles.has(c.id))) trash = true;
        }
      }
      if (trash) patch.trashed = true;
      await drive.patch(m.id, patch);
      out.restored++;
    } catch (e) {
      if (cantFail(e)) out.cant++;
      else { out.more = true; out.left = all.length - i; break; }
    }
  }
  return out;
}
