// S68-38 노트 보드 연결선(서버 표 app_note_board_links, migration 20261123090000) 읽기·쓰기 한 곳. 기존 owner-RLS REST 길(rt.api)만 쓴다. 기기 저장 없음.
// - 서버가 막는 것: 남의 작업공간·다른 작업공간 노트 잇기(RLS), 작업공간·보드 바꾸기(칸 권한), 모양 틀린 값(검사). 화면은 같은 규칙으로 먼저 거른다.
// - 표가 아직 없으면(DB 적용 전, PostgREST 404/PGRST205) ready=false·missing=true: 보드는 카드만 그리고, 선을 그으려 하면 '준비 중'으로 알린다.
// - 화면은 바로 바뀌고(서버 답을 기다리지 않음) 실패하면 알리고 서버 값으로 다시 불러온다.
import { parseLink } from './note-board-links-model.mjs';

const ws = rt => { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('작업공간을 확인하지 못했어요.'); return id; };
const FIELDS = 'id,board_id,from_note,to_note,from_side,to_side,shape,dash,ends,label';
const TABLE = '/rest/v1/app_note_board_links';
const enc = encodeURIComponent;
const missingTable = error => /404|PGRST205|42P01|app_note_board_links/.test(`${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`);

export async function readBoardLinks(rt = window.KPTURuntime) {
  try {
    const rows = await rt.api(`${TABLE}?workspace_id=eq.${enc(ws(rt))}&select=${FIELDS}&order=created_at.asc,id.asc&limit=10000`);
    return {ready:true, links:(Array.isArray(rows) ? rows : []).map(parseLink).filter(Boolean)};
  } catch (error) {
    return {ready:false, links:[], missing:missingTable(error)};
  }
}
export async function addBoardLink({board_id, from_note, to_note, from_side = null, to_side = null, shape = 'curve', dash = 'solid', ends = 'end', label = null}, rt = window.KPTURuntime) {
  const rows = await rt.api(`${TABLE}?select=${FIELDS}`, {method:'POST', prefer:'return=representation', body:{workspace_id:ws(rt), board_id, from_note, to_note, from_side, to_side, shape, dash, ends, label}});
  const link = Array.isArray(rows) && rows.length === 1 ? parseLink(rows[0]) : null;
  if (!link) throw new Error('연결선을 저장하지 못했어요.');
  return link;
}
const PATCHABLE = ['from_note', 'to_note', 'from_side', 'to_side', 'shape', 'dash', 'ends', 'label'];
export async function updateBoardLink(id, patch, rt = window.KPTURuntime) {
  const body = Object.fromEntries(Object.entries(patch).filter(([k]) => PATCHABLE.includes(k)));
  const rows = await rt.api(`${TABLE}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws(rt))}&select=${FIELDS}`, {method:'PATCH', prefer:'return=representation', body});
  const link = Array.isArray(rows) && rows.length === 1 ? parseLink(rows[0]) : null;
  if (!link) throw new Error('연결선을 바꾸지 못했어요.');
  return link;
}
// filter: {id} 한 줄 · {board_id} 그 보드의 선 전부(보드 삭제) · {board_id, note} 그 보드에서 그 노트에 붙은 선(보드에서 빼기).
export async function deleteBoardLinks(filter, rt = window.KPTURuntime) {
  const q = [`workspace_id=eq.${enc(ws(rt))}`];
  if (filter.id) q.push(`id=eq.${enc(filter.id)}`);
  else if (filter.board_id) {
    q.push(`board_id=eq.${enc(filter.board_id)}`);
    if (filter.note) q.push(`or=(from_note.eq.${enc(filter.note)},to_note.eq.${enc(filter.note)})`);
  } else throw new Error('삭제할 연결선을 확인하지 못했어요.');
  await rt.api(`${TABLE}?${q.join('&')}&select=id`, {method:'DELETE', prefer:'return=representation'});
}

// 노트 화면 하나가 쓰는 연결선 모음(한 작업공간). scope(): 지금 작업공간 표시(바뀌면 늦은 답은 버림). onChange: 다시 그리기. toast: 알림 한 줄.
export function createBoardLinks({rt = window.KPTURuntime, scope = () => null, onChange = () => {}, toast = () => {}} = {}) {
  let links = [], ready = false, missing = false, loading = null, loadedFor;
  async function load(force = false) {
    const owner = scope();
    if (!force && loadedFor === owner) return loading; // 한 작업공간에 한 번(실패해도 다시 그릴 때마다 묻지 않음 — 선을 그으려 하면 알림)
    loadedFor = owner;
    const run = (async () => {
      const r = await readBoardLinks(rt);
      if (owner !== scope()) return;
      links = r.links; ready = r.ready; missing = !!r.missing; onChange();
    })();
    loading = run; try { await run; } finally { if (loading === run) loading = null; }
  }
  const failed = async text => { toast(text); await load(true); };
  const blocked = () => {
    if (ready) return false;
    toast(missing ? '연결선은 아직 서버에 저장할 수 없어요(준비 중).' : '연결선을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.');
    if (!missing && !loading) void load(true); // 잠깐 끊긴 것이면 다시 읽어 둔다
    return true;
  };
  return {
    load,
    reset() { links = []; ready = false; missing = false; loadedFor = undefined; },
    ready:() => ready,
    all:() => links,
    forBoard:boardId => links.filter(l => l.board_id === boardId),
    async add(link) {
      if (blocked()) return null;
      const temp = {id:`tmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, from_side:null, to_side:null, shape:'curve', dash:'solid', ends:'end', label:null, ...link, pending:true};
      links = [...links, temp]; onChange();
      const owner = scope();
      try { const saved = await addBoardLink(link, rt); if (owner !== scope()) return null; links = links.map(l => (l.id === temp.id ? saved : l)); onChange(); return saved; }
      catch { if (owner === scope()) await failed('연결선을 저장하지 못했어요. 다시 불러올게요.'); return null; }
    },
    async update(id, patch) {
      if (blocked()) return;
      const old = links.find(l => l.id === id); if (!old || old.pending) return;
      links = links.map(l => (l.id === id ? {...l, ...patch} : l)); onChange();
      const owner = scope();
      try { const saved = await updateBoardLink(id, patch, rt); if (owner === scope()) { links = links.map(l => (l.id === id ? saved : l)); onChange(); } }
      catch { if (owner === scope()) await failed('연결선을 바꾸지 못했어요. 다시 불러올게요.'); }
    },
    async remove(id) {
      if (blocked()) return;
      if (!links.some(l => l.id === id && !l.pending)) return;
      links = links.filter(l => l.id !== id); onChange();
      const owner = scope();
      try { await deleteBoardLinks({id}, rt); } catch { if (owner === scope()) await failed('연결선을 삭제하지 못했어요. 다시 불러올게요.'); }
    },
    // 보드 삭제·보드에서 노트 빼기: 그 선들도 정리한다(표가 없거나 선이 없으면 서버에 묻지 않음).
    async removeBoard(boardId, note = null) {
      const hit = links.filter(l => l.board_id === boardId && (!note || l.from_note === note || l.to_note === note));
      if (!ready || !hit.length) return;
      links = links.filter(l => !hit.includes(l)); onChange();
      const owner = scope();
      try { await deleteBoardLinks(note ? {board_id:boardId, note} : {board_id:boardId}, rt); }
      catch { if (owner === scope()) await failed('연결선을 다 정리하지 못했어요. 다시 불러올게요.'); }
    },
  };
}
