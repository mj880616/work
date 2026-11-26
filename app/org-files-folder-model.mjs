// ORG-기록자료폴더(사용자 11/24 "앞으로 조직관리에서 각 조직 기록 자료 추가하면 궤도 조직 각 조직 폴더에 저장"):
// 담당조직 기록에 붙여 올린 자료를 자료실 '모으는 폴더(부모) › 그 조직 이름 폴더'에 넣는 규칙의 유일한 곳. 순수 함수만(화면·네트워크 없음).
// 폴더 이름·경로는 코드에 박지 않는다(AGENTS.md 5절). 부모 폴더는 사람마다 서버에 저장(app_profiles.org_files_folder),
// 조직 ↔ 폴더 짝은 이름이 아니라 폴더 id로 서버에 저장(app_library_folders.organization_id) — 조직·폴더 이름을 바꿔도 짝은 그대로다.
// 시험: tests/org-files-folder-model.test.mjs
import {orgKey} from './org-name-match.mjs';
import {word} from './brand/brand.mjs';

// 줄 id 모양(서버 uuid). 값 자체는 서버가 외래 키·소유자 검사로 다시 확인한다.
const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isFolderId = v => typeof v === 'string' && ROW_ID.test(v);

// 폴더 이름과 조직 이름이 같은가: 띄어쓰기·가운뎃점·문장부호·대소문자 차이는 같게 본다(조직 이름 비교 한 곳 org-name-match.mjs의 기본 키).
export const sameFolderName = (folderName, orgName) => { const a = orgKey(folderName); return !!a && a === orgKey(orgName); };

// 새 폴더 이름: 조직 이름 그대로(폴더 이름 규칙 1~40자, 앞뒤 공백·제어문자 없음 — library-tree.js cleanFolderName과 같음).
export function orgFolderName(orgName) {
  const name = String(orgName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name ? [...name].slice(0, 40).join('').trim() : '';
}

// 첫 사용 때 물어볼 부모 폴더 추정: 바로 아래 폴더 이름이 담당조직 이름과 같은 것이 가장 많은 폴더(2개 이상일 때만, 같은 수가 둘 이상이면 추정하지 않음).
// folders = 보이는 폴더(휴지통 제외) [{id,parent_id,name}], orgs = [{id,name}]. 반환: 폴더 줄 또는 null.
export function guessParentFolder(folders, orgs) {
  const list = Array.isArray(folders) ? folders : [], names = (Array.isArray(orgs) ? orgs : []).map(o => orgKey(o?.name)).filter(Boolean);
  if (!names.length) return null;
  const keys = new Set(names), count = new Map();
  for (const f of list) {
    if (!f?.parent_id || !keys.has(orgKey(f.name))) continue;
    count.set(f.parent_id, (count.get(f.parent_id) || 0) + 1);
  }
  let best = null, top = 0, tie = false;
  for (const [id, n] of count) { if (n > top) { best = id; top = n; tie = false; } else if (n === top) tie = true; }
  if (!best || top < 2 || tie) return null;
  return list.find(f => f.id === best) || null;
}

// 화면이 쓸 부모 폴더: 저장된 id가 지금 보이는 폴더에 있을 때만(휴지통에 넣었으면 다시 묻는다).
export const liveParent = (id, folders) => (isFolderId(id) && (folders || []).find(f => f?.id === id)) || null;

// 이 조직의 자료를 넣을 폴더를 정한다. links = [{id, organization_id}](서버의 짝 칸, 보이는 폴더만).
// 반환: {kind:'linked', folder} 이미 짝이 있음(어디로 옮겼든 그 폴더) | {kind:'match', folder} 부모 아래 같은 이름의 짝 없는 폴더 → 짝을 지어 씀
//      | {kind:'create', parent, name} 새로 만듦 | null(부모 없음·이름 없음).
export function planOrgFolder({folders, links, parent, org}) {
  const list = Array.isArray(folders) ? folders : [], orgId = org?.id;
  if (!orgId) return null;
  const linkedIds = new Set((links || []).filter(l => l?.organization_id).map(l => l.id));
  const mine = (links || []).find(l => l?.organization_id === orgId && list.some(f => f.id === l.id));
  if (mine) return {kind: 'linked', folder: list.find(f => f.id === mine.id)};
  if (!parent?.id) return null;
  const match = list.filter(f => f.parent_id === parent.id && !linkedIds.has(f.id) && sameFolderName(f.name, org.name))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))[0];
  if (match) return {kind: 'match', folder: match};
  const name = orgFolderName(org.name);
  return name ? {kind: 'create', parent, name} : null;
}

// 지난 조직 자료 모으기: 옮길 자료 = 담당조직이 붙은 자료 중 폴더 밖이거나 받는 폴더(잡동사니)에 있는 것. 사람이 고른 다른 폴더에 든 자료는 그대로 둔다.
// docs = [{id, organization_id}], items = [{document_id, folder_id}], visibleIds = 보이는 폴더 id 집합, receiveId = 받는 폴더 id|null.
// 반환: Map(조직 id → [{id, from}]) — from = 지금 폴더 id|null(되돌리기용).
export function gatherPlan({docs, items, visibleIds, receiveId = null, orgIds}) {
  const at = new Map((items || []).map(x => [x.document_id, x.folder_id || null])), ok = orgIds ? new Set(orgIds) : null, out = new Map();
  for (const d of docs || []) {
    const org = d?.organization_id;
    if (!org || (ok && !ok.has(org))) continue;
    const from = at.get(d.id) ?? null;
    if (from && visibleIds && !visibleIds.has(from)) continue; // 휴지통 폴더 안 자료는 건드리지 않음
    if (from && from !== receiveId) continue;
    if (!out.has(org)) out.set(org, []);
    out.get(org).push({id: d.id, from});
  }
  return out;
}

export const ASK_TEXT = name => word`조직 기록 자료를 ‘${name}’ 폴더에 모을까요?`;
export const gatherLine = (moved, failed = 0) => word`지난 조직 기록 자료 ${moved}개를 조직 폴더로 모았어요` + (failed ? ` · 못 옮김 ${failed}` : '');
