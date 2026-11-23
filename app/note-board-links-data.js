// S68-38 노트 보드 연결선(서버 표 app_note_board_links, migration 20261123090000)과 S68-38c 글 상자(app_note_board_texts, migration 20261123120000) 읽기·쓰기 한 곳.
// 기존 owner-RLS REST 길(rt.api)만 쓴다. 기기 저장 없음.
// - 서버가 막는 것: 남의 작업공간·다른 작업공간 노트·다른 보드 글 상자 잇기(RLS·외래 키), 작업공간·보드 바꾸기(칸 권한), 모양 틀린 값(검사). 화면은 같은 규칙으로 먼저 거른다.
// - 표가 아직 없으면(DB 적용 전, PostgREST 404/PGRST205) ready=false·missing=true: 보드는 카드만 그리고, 선을 그으려 하면 '준비 중'으로 알린다.
// - S68-38c 칸(글 상자 끝·곡선 지나는 점)이 아직 없으면(20261123120000 적용 전) 옛 칸으로 다시 읽어 선은 그대로 쓰고(v2=false),
//   글 상자·글 상자 잇기·곡선만 '준비 중'으로 알린다.
// - 화면은 바로 바뀌고(서버 답을 기다리지 않음) 실패하면 알리고 서버 값으로 다시 불러온다.
import { parseLink, parseText, endId } from './note-board-links-model.mjs';

const ws = rt => { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('작업공간을 확인하지 못했어요.'); return id; };
const FIELDS_V1 = 'id,board_id,from_note,to_note,from_side,to_side,shape,dash,ends,label';
const FIELDS = FIELDS_V1 + ',from_text,to_text,bend_x,bend_y';
const TEXT_FIELDS = 'id,board_id,body,x,y';
const TABLE = '/rest/v1/app_note_board_links', TEXTS = '/rest/v1/app_note_board_texts';
const V2_KEYS = ['from_text', 'to_text', 'bend_x', 'bend_y'];
const enc = encodeURIComponent;
const errText = error => `${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`;
const missingTable = (error, name = 'app_note_board_links') => new RegExp(`404|PGRST205|42P01|${name}`).test(errText(error));
const missingColumn = error => /42703|PGRST204|from_text|to_text|bend_x|bend_y/.test(errText(error));

// 읽기: 새 칸으로 읽고, 칸이 없으면 옛 칸으로. 글 상자 표는 같이(동시에) 묻고, 없으면 글 상자만 준비 안 됨.
export async function readBoardLinks(rt = window.KPTURuntime) {
  const where = `workspace_id=eq.${enc(ws(rt))}`;
  const get = fields => rt.api(`${TABLE}?${where}&select=${fields}&order=created_at.asc,id.asc&limit=10000`);
  const linksAsk = get(FIELDS);
  const textsAsk = rt.api(`${TEXTS}?${where}&select=${TEXT_FIELDS}&order=created_at.asc,id.asc&limit=10000`).then(got => ({ok:true, got}), () => ({ok:false}));
  let rows, v2 = true;
  try { rows = await linksAsk; }
  catch (error) {
    if (!missingColumn(error) || /404|PGRST205|42P01/.test(errText(error))) { await textsAsk; return {ready:false, links:[], missing:missingTable(error), texts:[], textsReady:false}; }
    try { rows = await get(FIELDS_V1); v2 = false; } catch (again) { await textsAsk; return {ready:false, links:[], missing:missingTable(again), texts:[], textsReady:false}; }
  }
  const t = await textsAsk, textsReady = v2 && t.ok;
  const texts = textsReady ? (Array.isArray(t.got) ? t.got : []).map(parseText).filter(Boolean) : [];
  return {ready:true, v2, links:(Array.isArray(rows) ? rows : []).map(parseLink).filter(Boolean), texts, textsReady};
}
const v2Body = body => Object.fromEntries(Object.entries(body).filter(([k, v]) => !V2_KEYS.includes(k) || v != null));
export async function addBoardLink({board_id, from_note = null, to_note = null, from_text = null, to_text = null, from_side = null, to_side = null, shape = 'line', dash = 'solid', ends = 'end', label = null, bend_x = null, bend_y = null}, rt = window.KPTURuntime, {v2 = true} = {}) {
  const body = {workspace_id:ws(rt), board_id, from_note, to_note, from_text, to_text, from_side, to_side, shape, dash, ends, label, bend_x, bend_y};
  const rows = await rt.api(`${TABLE}?select=${v2 ? FIELDS : FIELDS_V1}`, {method:'POST', prefer:'return=representation', body:v2 ? body : v2Body(body)});
  const link = Array.isArray(rows) && rows.length === 1 ? parseLink(rows[0]) : null;
  if (!link) throw new Error('연결선을 저장하지 못했어요.');
  return link;
}
const PATCHABLE = ['from_note', 'to_note', 'from_side', 'to_side', 'shape', 'dash', 'ends', 'label', ...V2_KEYS];
export async function updateBoardLink(id, patch, rt = window.KPTURuntime, {v2 = true} = {}) {
  let body = Object.fromEntries(Object.entries(patch).filter(([k]) => PATCHABLE.includes(k)));
  if (!v2) body = v2Body(body);
  const rows = await rt.api(`${TABLE}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws(rt))}&select=${v2 ? FIELDS : FIELDS_V1}`, {method:'PATCH', prefer:'return=representation', body});
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
// 글 상자 넣기·고치기(글·자리)·지우기({id} 하나 · {board_id} 그 보드 전부). 지우면 서버가 그 상자에 붙은 선도 지운다(cascade).
export async function addBoardText({board_id, body, x, y}, rt = window.KPTURuntime) {
  const rows = await rt.api(`${TEXTS}?select=${TEXT_FIELDS}`, {method:'POST', prefer:'return=representation', body:{workspace_id:ws(rt), board_id, body, x:Math.round(x), y:Math.round(y)}});
  const text = Array.isArray(rows) && rows.length === 1 ? parseText(rows[0]) : null;
  if (!text) throw new Error('글 상자를 저장하지 못했어요.');
  return text;
}
export async function updateBoardText(id, patch, rt = window.KPTURuntime) {
  const body = {};
  if (typeof patch.body === 'string') body.body = patch.body;
  for (const k of ['x', 'y']) if (Number.isFinite(patch[k])) body[k] = Math.round(patch[k]);
  const rows = await rt.api(`${TEXTS}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws(rt))}&select=${TEXT_FIELDS}`, {method:'PATCH', prefer:'return=representation', body});
  const text = Array.isArray(rows) && rows.length === 1 ? parseText(rows[0]) : null;
  if (!text) throw new Error('글 상자를 바꾸지 못했어요.');
  return text;
}
export async function deleteBoardTexts(filter, rt = window.KPTURuntime) {
  const q = [`workspace_id=eq.${enc(ws(rt))}`];
  if (filter.id) q.push(`id=eq.${enc(filter.id)}`);
  else if (filter.board_id) q.push(`board_id=eq.${enc(filter.board_id)}`);
  else throw new Error('삭제할 글 상자를 확인하지 못했어요.');
  await rt.api(`${TEXTS}?${q.join('&')}&select=id`, {method:'DELETE', prefer:'return=representation'});
}

const tempId = kind => `tmp-${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const touches = (l, id) => endId(l, 'from') === id || endId(l, 'to') === id;
const needsV2 = body => V2_KEYS.some(k => body[k] != null);

// 노트 화면 하나가 쓰는 연결선·글 상자 모음(한 작업공간). scope(): 지금 작업공간 표시(바뀌면 늦은 답은 버림). onChange: 다시 그리기. toast: 알림 한 줄.
export function createBoardLinks({rt = window.KPTURuntime, scope = () => null, onChange = () => {}, toast = () => {}} = {}) {
  let links = [], texts = [], ready = false, v2 = false, textsReady = false, missing = false, loading = null, loadedFor;
  async function load(force = false) {
    const owner = scope();
    if (!force && loadedFor === owner) return loading; // 한 작업공간에 한 번(실패해도 다시 그릴 때마다 묻지 않음 — 선을 그으려 하면 알림)
    loadedFor = owner;
    const run = (async () => {
      const r = await readBoardLinks(rt);
      if (owner !== scope()) return;
      links = r.links; ready = r.ready; v2 = !!r.v2; texts = r.texts || []; textsReady = !!r.textsReady; missing = !!r.missing; onChange();
    })();
    loading = run; try { await run; } finally { if (loading === run) loading = null; }
  }
  const failed = async text => { toast(text); await load(true); };
  const blocked = (body = null) => {
    if (ready && (!body || v2 || !needsV2(body))) return false;
    if (ready) { toast('글 상자 잇기·곡선은 아직 서버에 저장할 수 없어요(준비 중).'); return true; }
    toast(missing ? '연결선은 아직 서버에 저장할 수 없어요(준비 중).' : '연결선을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.');
    if (!missing && !loading) void load(true); // 잠깐 끊긴 것이면 다시 읽어 둔다
    return true;
  };
  const textBlocked = () => {
    if (textsReady) return false;
    toast(ready && !v2 || missing ? '글 상자는 아직 서버에 저장할 수 없어요(준비 중).' : '글 상자를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.');
    if (!missing && !loading && (v2 || !ready)) void load(true);
    return true;
  };
  return {
    load,
    reset() { links = []; texts = []; ready = false; v2 = false; textsReady = false; missing = false; loadedFor = undefined; },
    ready:() => ready,
    canBend:() => ready && v2,
    textsReady:() => textsReady,
    checkTexts:() => !textBlocked(), // 글 상자를 만들 수 있나(못 하면 알림 한 줄)
    all:() => links,
    forBoard:boardId => links.filter(l => l.board_id === boardId),
    textsFor:boardId => texts.filter(t => t.board_id === boardId),
    async add(link) {
      if (blocked(link)) return null;
      const temp = {id:tempId('l'), from_note:null, to_note:null, from_text:null, to_text:null, from_side:null, to_side:null, shape:'line', dash:'solid', ends:'end', label:null, bend_x:null, bend_y:null, ...link, pending:true};
      links = [...links, temp]; onChange();
      const owner = scope();
      try { const saved = await addBoardLink(link, rt, {v2}); if (owner !== scope()) return null; links = links.map(l => (l.id === temp.id ? saved : l)); onChange(); return saved; }
      catch { if (owner === scope()) await failed('연결선을 저장하지 못했어요. 다시 불러올게요.'); return null; }
    },
    async update(id, patch) {
      if (blocked(patch)) { onChange(); return; } // 끌던 곡선 미리 보기를 되돌린다
      const old = links.find(l => l.id === id); if (!old || old.pending) return;
      links = links.map(l => (l.id === id ? {...l, ...patch} : l)); onChange();
      const owner = scope();
      try { const saved = await updateBoardLink(id, patch, rt, {v2}); if (owner === scope()) { links = links.map(l => (l.id === id ? saved : l)); onChange(); } }
      catch { if (owner === scope()) await failed('연결선을 바꾸지 못했어요. 다시 불러올게요.'); }
    },
    async remove(id) {
      if (blocked()) return;
      if (!links.some(l => l.id === id && !l.pending)) return;
      links = links.filter(l => l.id !== id); onChange();
      const owner = scope();
      try { await deleteBoardLinks({id}, rt); } catch { if (owner === scope()) await failed('연결선을 삭제하지 못했어요. 다시 불러올게요.'); }
    },
    // 보드 삭제·보드에서 노트 빼기: 그 선들(보드 삭제면 글 상자도)을 정리한다(표가 없거나 지울 것이 없으면 서버에 묻지 않음).
    async removeBoard(boardId, note = null) {
      const hit = links.filter(l => l.board_id === boardId && (!note || l.from_note === note || l.to_note === note));
      const hitTexts = note ? [] : texts.filter(t => t.board_id === boardId);
      if ((!ready || !hit.length) && (!textsReady || !hitTexts.length)) return;
      links = links.filter(l => !hit.includes(l)); texts = texts.filter(t => !hitTexts.includes(t)); onChange();
      const owner = scope();
      try {
        if (textsReady && hitTexts.length) await deleteBoardTexts({board_id:boardId}, rt); // 글 상자 끝 선은 서버가 함께 지운다
        if (ready && hit.length) await deleteBoardLinks(note ? {board_id:boardId, note} : {board_id:boardId}, rt);
      } catch { if (owner === scope()) await failed('연결선·글 상자를 다 정리하지 못했어요. 다시 불러올게요.'); }
    },
    // ---- 글 상자 ----
    async addText(text) {
      if (textBlocked()) return null;
      const temp = {id:tempId('t'), ...text, pending:true};
      texts = [...texts, temp]; onChange();
      const owner = scope();
      try { const saved = await addBoardText(text, rt); if (owner !== scope()) return null; texts = texts.map(t => (t.id === temp.id ? saved : t)); onChange(); return saved; }
      catch { if (owner === scope()) await failed('글 상자를 저장하지 못했어요. 다시 불러올게요.'); return null; }
    },
    async updateText(id, patch) {
      if (textBlocked()) { onChange(); return; }
      const old = texts.find(t => t.id === id); if (!old || old.pending) return;
      texts = texts.map(t => (t.id === id ? {...t, ...patch} : t)); onChange();
      const owner = scope();
      try { const saved = await updateBoardText(id, patch, rt); if (owner === scope()) { texts = texts.map(t => (t.id === id ? saved : t)); onChange(); } }
      catch { if (owner === scope()) await failed('글 상자를 바꾸지 못했어요. 다시 불러올게요.'); }
    },
    async removeText(id) {
      if (textBlocked()) return;
      if (!texts.some(t => t.id === id && !t.pending)) return;
      texts = texts.filter(t => t.id !== id); links = links.filter(l => !touches(l, id)); onChange();
      const owner = scope();
      try { await deleteBoardTexts({id}, rt); } catch { if (owner === scope()) await failed('글 상자를 삭제하지 못했어요. 다시 불러올게요.'); }
    },
  };
}
