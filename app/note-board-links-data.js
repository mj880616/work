// S68-38 노트 보드 연결선(서버 표 app_note_board_links, migration 20261123090000)과 S68-38c 글 상자(app_note_board_texts, migration 20261123120000) 읽기·쓰기 한 곳.
// 기존 owner-RLS REST 길(rt.api)만 쓴다. 기기 저장 없음.
// - 서버가 막는 것: 남의 작업공간·다른 작업공간 노트·다른 보드 글 상자 잇기(RLS·외래 키), 작업공간·보드 바꾸기(칸 권한), 모양 틀린 값(검사). 화면은 같은 규칙으로 먼저 거른다.
// - 표가 아직 없으면(DB 적용 전, PostgREST 404/PGRST205) ready=false·missing=true: 보드는 카드만 그리고, 선을 그으려 하면 '준비 중'으로 알린다.
// - S68-38c 칸(글 상자 끝·곡선 지나는 점)이 아직 없으면(20261123120000 적용 전) 옛 칸으로 다시 읽어 선은 그대로 쓰고(v2=false),
//   글 상자·글 상자 잇기·곡선만 '준비 중'으로 알린다.
// - S69-82 생각 지도 칸(가지 관계·순서·쪽·종류·색·모양·글자 크기·폭·접힘, migration 20261125000000)이 아직 없으면 글 상자를 옛 칸으로 다시 읽어
//   혼자 선 상자로 쓰고(mindmap=false), 가지 만들기·꾸미기만 '준비 중'으로 알린다. 읽은 줄은 note-board-mindmap-model.mjs nodeShape 모양.
// - S69-88 상자 틀 칸(손으로 정한 높이 h·손으로 둔 가지 자리 pinned, migration 20261125020000)이 아직 없으면 생각 지도 칸으로 다시 읽고(frame=false),
//   그 두 칸 저장만 건너뛴다(나머지 — 폭·자리·글·가지·꾸미기 — 는 그대로 저장). 화면은 frameReady()로 손으로 둔 가지 자리 대신 옛 '떼기'로 간다.
// - S69-91 ① 꾸미기 칸(겹침 순서·테두리·투명도·글자 꾸밈, migration 20261125040000)이 아직 없으면 틀 칸으로 다시 읽고(decor=false),
//   글자·도형 넣기와 새 꾸미기만 '준비 중'으로 알린다. 선의 점 끝·선 색·두께(migration 20261125040100)가 없으면 옛 칸으로 다시 읽고(lines=false),
//   선 넣기·선 끝 옮기기·꺾은선·선 색만 '준비 중'으로 알린다.
// - S71-51 모든 칸 가지 칸(카드 부모 parent_note·글자·도형 가지, migration 20261126230000)이 아직 없으면 꾸미기 칸으로 다시 읽고(branch=false),
//   카드 아래 가지·글자·도형 가지만 '준비 중'으로 알린다(상자 가지는 지금 그대로). 화면 줄은 parent_id 하나 + parent_card(부모가 카드)로 본다 —
//   서버로는 parent_card면 parent_note에, 아니면 parent_id에 보낸다(둘 중 하나만, 서버 check와 같음).
// - S71-53 관계선 칸(선 종류 kind 'line'·'relation', migration 20261127020000)이 아직 없으면 점 끝 칸으로 다시 읽고(relation=false),
//   관계선 만들기는 막는다('준비 중' 한 줄, 화면은 관계 잇기 메뉴를 보이지 않음). 관계선을 일반 선으로 바꿔 저장하지 않는다(kind가 없는 줄은 서버에 보내지 않음).
// - 화면은 바로 바뀌고(서버 답을 기다리지 않음) 실패하면 알리고 서버 값으로 다시 불러온다.
import { parseLink, parseText, endId } from './note-board-links-model.mjs';
import { nodeShape } from './note-board-mindmap-model.mjs';

const ws = rt => { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('작업공간을 확인하지 못했어요.'); return id; };
const FIELDS_V1 = 'id,board_id,from_note,to_note,from_side,to_side,shape,dash,ends,label';
const FIELDS = FIELDS_V1 + ',from_text,to_text,bend_x,bend_y';
const LINE_KEYS = ['from_x', 'from_y', 'to_x', 'to_y', 'color', 'width'];
const FIELDS_LINES = `${FIELDS},${LINE_KEYS.join(',')}`;
const FIELDS_REL = `${FIELDS_LINES},kind`; // S71-53
const linkFields = ({v2 = true, lines = true, relation = false} = {}) => (!v2 ? FIELDS_V1 : !lines ? FIELDS : relation ? FIELDS_REL : FIELDS_LINES);
const TEXT_FIELDS_V2 = 'id,board_id,body,x,y';
const MAP_KEYS = ['parent_id', 'ord', 'side', 'kind', 'color', 'shape', 'font', 'w', 'collapsed'];
const TEXT_FIELDS = `${TEXT_FIELDS_V2},${MAP_KEYS.join(',')}`;
const FRAME_KEYS = ['h', 'pinned'];
const TEXT_FIELDS_FRAME = `${TEXT_FIELDS},${FRAME_KEYS.join(',')}`;
const DECOR_KEYS = ['z', 'stroke', 'stroke_w', 'dash', 'alpha', 'bold', 'align', 'ink'];
const TEXT_FIELDS_DECOR = `${TEXT_FIELDS_FRAME},${DECOR_KEYS.join(',')}`;
const BRANCH_KEYS = ['parent_note'];
const TEXT_FIELDS_BRANCH = `${TEXT_FIELDS_DECOR},${BRANCH_KEYS.join(',')}`;
const textFields = ({mindmap = true, frame = true, decor = true, branch = false} = {}) => (!mindmap ? TEXT_FIELDS_V2 : !frame ? TEXT_FIELDS : !decor ? TEXT_FIELDS_FRAME : branch ? TEXT_FIELDS_BRANCH : TEXT_FIELDS_DECOR);
const TABLE = '/rest/v1/app_note_board_links', TEXTS = '/rest/v1/app_note_board_texts';
const V2_KEYS = ['from_text', 'to_text', 'bend_x', 'bend_y'];
const enc = encodeURIComponent;
const errText = error => `${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`;
const missingTable = (error, name = 'app_note_board_links') => new RegExp(`404|PGRST205|42P01|${name}`).test(errText(error));
const missingColumn = error => /42703|PGRST204|from_text|to_text|bend_x|bend_y/.test(errText(error));
const missingMapColumn = error => /42703|PGRST204|parent_id|collapsed|column .* does not exist/.test(errText(error)) && !/404|PGRST205|42P01/.test(errText(error));
const missingNewColumn = error => /42703|PGRST204|column .* does not exist/.test(errText(error)) && !/404|PGRST205|42P01/.test(errText(error));
const toNode = row => nodeShape(parseText(row), row);

// 읽기: 새 칸으로 읽고, 칸이 없으면 옛 칸으로. 글 상자 표는 같이(동시에) 묻고, 없으면 글 상자만 준비 안 됨.
export async function readBoardLinks(rt = window.KPTURuntime) {
  const where = `workspace_id=eq.${enc(ws(rt))}`;
  const get = fields => rt.api(`${TABLE}?${where}&select=${fields}&order=created_at.asc,id.asc&limit=10000`);
  const linksAsk = get(FIELDS_REL);
  const getTexts = fields => rt.api(`${TEXTS}?${where}&select=${fields}&order=created_at.asc,id.asc&limit=10000`);
  const older = async () => { try { return {ok:true, got:await getTexts(TEXT_FIELDS_V2), mindmap:false}; } catch { return {ok:false}; } };
  const frameAsk = () => getTexts(TEXT_FIELDS_FRAME).then(got => ({ok:true, got, mindmap:true, frame:true, decor:false}), async error => {
    if (!missingMapColumn(error)) return {ok:false};
    try { return {ok:true, got:await getTexts(TEXT_FIELDS), mindmap:true, frame:false}; }
    catch (again) { return missingMapColumn(again) ? older() : {ok:false}; }
  });
  const decorAsk = () => getTexts(TEXT_FIELDS_DECOR).then(got => ({ok:true, got, mindmap:true, frame:true, decor:true, branch:false}), error => (missingNewColumn(error) ? frameAsk() : {ok:false}));
  const textsAsk = getTexts(TEXT_FIELDS_BRANCH).then(got => ({ok:true, got, mindmap:true, frame:true, decor:true, branch:true}), error => (missingNewColumn(error) ? decorAsk() : {ok:false}));
  let rows, v2 = true, lines = true, relation = true;
  const oldLinks = async () => { // 점 끝·선 색 칸 적용 전: S68-38c 칸으로, 그것도 없으면 옛 칸으로
    lines = false; relation = false;
    try { return {rows:await get(FIELDS)}; }
    catch (error) {
      if (!missingColumn(error) || /404|PGRST205|42P01/.test(errText(error))) return {fail:error};
      try { const got = await get(FIELDS_V1); v2 = false; return {rows:got}; } catch (again) { return {fail:again}; }
    }
  };
  let got;
  try { got = {rows:await linksAsk}; }
  catch (error) {
    if (!missingNewColumn(error)) got = {fail:error};
    else { // S71-53: 관계선 칸(kind) 적용 전 — 점 끝 칸으로, 그것도 없으면 더 옛 칸으로
      relation = false;
      try { got = {rows:await get(FIELDS_LINES)}; } catch (again) { got = missingNewColumn(again) ? await oldLinks() : {fail:again}; }
    }
  }
  if (got.fail) { await textsAsk; return {ready:false, links:[], missing:missingTable(got.fail), texts:[], textsReady:false}; }
  rows = got.rows;
  const t = await textsAsk, textsReady = v2 && t.ok;
  const texts = textsReady ? (Array.isArray(t.got) ? t.got : []).map(toNode).filter(Boolean) : [];
  return {ready:true, v2, lines:v2 && lines, relation:v2 && lines && relation, links:(Array.isArray(rows) ? rows : []).map(parseLink).filter(Boolean), texts, textsReady, mindmap:textsReady && !!t.mindmap, frame:textsReady && !!t.frame, decor:textsReady && !!t.decor, branch:textsReady && !!t.branch};
}
const v2Body = body => Object.fromEntries(Object.entries(body).filter(([k, v]) => !V2_KEYS.includes(k) || v != null));
const linesBody = body => Object.fromEntries(Object.entries(body).filter(([k, v]) => !LINE_KEYS.includes(k) || v != null));
export async function addBoardLink({board_id, from_note = null, to_note = null, from_text = null, to_text = null, from_side = null, to_side = null, shape = 'line', dash = 'solid', ends = 'end', label = null, bend_x = null, bend_y = null,
  from_x = null, from_y = null, to_x = null, to_y = null, color = null, width = null, kind = 'line'}, rt = window.KPTURuntime, {v2 = true, lines = true, relation = false} = {}) {
  let body = {workspace_id:ws(rt), board_id, from_note, to_note, from_text, to_text, from_side, to_side, shape, dash, ends, label, bend_x, bend_y, from_x, from_y, to_x, to_y, color, width};
  body = linesBody(body); // 새 칸(점 끝·선 색·두께)은 값이 있을 때만 보낸다 — 옛 선 넣기는 옛 모양 그대로
  if (kind === 'relation') { if (!relation) throw new Error('관계선은 아직 서버에 저장할 수 없어요.'); body.kind = 'relation'; } // S71-53: 관계선은 칸이 있을 때만(일반 선으로 바꿔 저장하지 않음)
  const rows = await rt.api(`${TABLE}?select=${linkFields({v2, lines, relation})}`, {method:'POST', prefer:'return=representation', body:v2 ? body : v2Body(body)});
  const link = Array.isArray(rows) && rows.length === 1 ? parseLink(rows[0]) : null;
  if (!link) throw new Error('연결선을 저장하지 못했어요.');
  return link;
}
const PATCHABLE = ['from_note', 'to_note', 'from_side', 'to_side', 'shape', 'dash', 'ends', 'label', ...V2_KEYS, 'from_text', 'to_text', ...LINE_KEYS];
export async function updateBoardLink(id, patch, rt = window.KPTURuntime, {v2 = true, lines = true, relation = false} = {}) {
  let body = Object.fromEntries(Object.entries(patch).filter(([k]) => PATCHABLE.includes(k)));
  if (!lines) body = Object.fromEntries(Object.entries(body).filter(([k]) => !LINE_KEYS.includes(k)));
  if (!v2) body = v2Body(body);
  const rows = await rt.api(`${TABLE}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws(rt))}&select=${linkFields({v2, lines, relation})}`, {method:'PATCH', prefer:'return=representation', body});
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
// 글 상자 넣기·고치기(글·자리·생각 지도 칸)·지우기({id} 하나 · {board_id} 그 보드 전부). 지우면 서버가 그 상자에 붙은 선과 그 아래 가지도 지운다(cascade).
// mindmap=false(새 칸 적용 전)면 옛 칸만 보내고 옛 칸으로 받는다.
// S71-51: 부모 칸 — 화면 줄의 parent_id(+ parent_card)를 서버 칸 둘(parent_id·parent_note) 중 하나로. 가지 칸이 없는 서버면 parent_id만(카드 부모는 화면이 먼저 막는다).
const mapBody = (patch, frame = true, decor = true, branch = false) => {
  const out = Object.fromEntries([...MAP_KEYS, ...(frame ? FRAME_KEYS : []), ...(frame && decor ? DECOR_KEYS : [])].filter(k => Object.hasOwn(patch, k)).map(k => [k, patch[k]]));
  if (branch && frame && decor && Object.hasOwn(patch, 'parent_id')) {
    const card = patch.parent_card === true && !!patch.parent_id;
    out.parent_id = card ? null : patch.parent_id ?? null; out.parent_note = card ? patch.parent_id : null;
  }
  return out;
};
export async function addBoardText({board_id, body, x, y, ...rest}, rt = window.KPTURuntime, {mindmap = true, frame = true, decor = true, branch = false} = {}) {
  const sent = {workspace_id:ws(rt), board_id, body, x:Math.round(x), y:Math.round(y), ...(mindmap ? mapBody(rest, frame, decor, branch) : {})};
  const rows = await rt.api(`${TEXTS}?select=${textFields({mindmap, frame, decor, branch})}`, {method:'POST', prefer:'return=representation', body:sent});
  const text = Array.isArray(rows) && rows.length === 1 ? toNode(rows[0]) : null;
  if (!text) throw new Error('상자를 저장하지 못했어요.');
  return text;
}
export async function updateBoardText(id, patch, rt = window.KPTURuntime, {mindmap = true, frame = true, decor = true, branch = false} = {}) {
  const body = mindmap ? mapBody(patch, frame, decor, branch) : {};
  if (typeof patch.body === 'string') body.body = patch.body;
  for (const k of ['x', 'y']) if (Number.isFinite(patch[k])) body[k] = Math.round(patch[k]);
  const rows = await rt.api(`${TEXTS}?id=eq.${enc(id)}&workspace_id=eq.${enc(ws(rt))}&select=${textFields({mindmap, frame, decor, branch})}`, {method:'PATCH', prefer:'return=representation', body});
  const text = Array.isArray(rows) && rows.length === 1 ? toNode(rows[0]) : null;
  if (!text) throw new Error('상자를 바꾸지 못했어요.');
  return text;
}
export async function deleteBoardTexts(filter, rt = window.KPTURuntime) {
  const q = [`workspace_id=eq.${enc(ws(rt))}`];
  if (filter.id) q.push(`id=eq.${enc(filter.id)}`);
  else if (filter.board_id) q.push(`board_id=eq.${enc(filter.board_id)}`);
  else throw new Error('삭제할 상자를 확인하지 못했어요.');
  await rt.api(`${TEXTS}?${q.join('&')}&select=id`, {method:'DELETE', prefer:'return=representation'});
}

const tempId = kind => `tmp-${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const touches = (l, id) => endId(l, 'from') === id || endId(l, 'to') === id;
const needsV2 = body => V2_KEYS.some(k => body[k] != null);
const needsLines = body => LINE_KEYS.some(k => body[k] != null) || body.shape === 'elbow';

// 노트 화면 하나가 쓰는 연결선·글 상자 모음(한 작업공간). scope(): 지금 작업공간 표시(바뀌면 늦은 답은 버림). onChange: 다시 그리기. toast: 알림 한 줄.
export function createBoardLinks({rt = window.KPTURuntime, scope = () => null, onChange = () => {}, toast = () => {}} = {}) {
  let links = [], texts = [], ready = false, v2 = false, lines = false, relation = false, textsReady = false, mindmap = false, frame = false, decor = false, branch = false, missing = false, loading = null, loadedFor;
  async function load(force = false) {
    const owner = scope();
    if (!force && loadedFor === owner) return loading; // 한 작업공간에 한 번(실패해도 다시 그릴 때마다 묻지 않음 — 선을 그으려 하면 알림)
    loadedFor = owner;
    const run = (async () => {
      const r = await readBoardLinks(rt);
      if (owner !== scope()) return;
      links = r.links; ready = r.ready; v2 = !!r.v2; lines = !!r.lines; relation = !!r.relation; texts = r.texts || []; textsReady = !!r.textsReady; mindmap = !!r.mindmap; frame = !!r.frame; decor = !!r.decor; branch = !!r.branch; missing = !!r.missing; onChange();
    })();
    loading = run; try { await run; } finally { if (loading === run) loading = null; }
  }
  const failed = async text => { toast(text); await load(true); };
  const blocked = (body = null) => {
    if (ready && body?.kind === 'relation' && !relation) { toast('관계선은 아직 서버에 저장할 수 없어요(준비 중).'); return true; } // S71-53
    if (ready && (!body || ((v2 || !needsV2(body)) && (lines || !needsLines(body))))) return false;
    if (ready) { toast(v2 ? '선 넣기·선 끝 옮기기·꺾은선·선 색은 아직 서버에 저장할 수 없어요(준비 중).' : '상자 잇기·곡선은 아직 서버에 저장할 수 없어요(준비 중).'); return true; }
    toast(missing ? '연결선은 아직 서버에 저장할 수 없어요(준비 중).' : '연결선을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.');
    if (!missing && !loading) void load(true); // 잠깐 끊긴 것이면 다시 읽어 둔다
    return true;
  };
  const textBlocked = () => {
    if (textsReady) return false;
    toast(ready && !v2 || missing ? '상자는 아직 서버에 저장할 수 없어요(준비 중).' : '상자를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.');
    if (!missing && !loading && (v2 || !ready)) void load(true);
    return true;
  };
  // 가지·꾸미기(생각 지도 칸)를 쓸 수 있나 — 못 쓰면 알림 한 줄.
  const mapBlocked = () => {
    if (textBlocked()) return true;
    if (mindmap) return false;
    toast('가지 만들기·꾸미기는 아직 서버에 저장할 수 없어요(준비 중).');
    return true;
  };
  const MAP_DEFAULTS = {parent_id:null, ord:0, side:null, kind:'topic', color:null, shape:'round', font:2, w:null, collapsed:false};
  const needsMap = patch => MAP_KEYS.some(k => Object.hasOwn(patch, k) && patch[k] !== MAP_DEFAULTS[k]);
  // S69-91: 글자·도형·새 모양·새 색·꾸미기 칸은 꾸미기 칸이 있어야 저장된다(없으면 알림 한 줄).
  const OLD_SHAPES = ['round', 'rect', 'pill', 'plain'];
  const needsDecor = patch => DECOR_KEYS.some(k => Object.hasOwn(patch, k) && patch[k] != null && patch[k] !== false && patch[k] !== 0)
    || ['label', 'shape'].includes(patch.kind) || (Object.hasOwn(patch, 'shape') && !OLD_SHAPES.includes(patch.shape)) || (Number.isInteger(patch.color) && (patch.color < 0 || patch.color > 7));
  const decorBlocked = () => {
    if (mapBlocked()) return true;
    if (decor && frame) return false;
    toast('글자·도형·꾸미기는 아직 서버에 저장할 수 없어요(준비 중).');
    return true;
  };
  // S71-51: 카드 아래 가지·글자/도형 가지는 모든 칸 가지 칸이 있어야 저장된다(없으면 알림 한 줄). now = 고치기 전 줄(종류를 보려고).
  const needsBranch = (patch, now = null) => {
    const row = {...(now || {}), ...patch};
    return (patch.parent_card === true && !!patch.parent_id) || (!!row.parent_id && Object.hasOwn(patch, 'parent_id') && ['label', 'shape'].includes(row.kind))
      || (!!patch.parent_id && ['label', 'shape'].includes(patch.kind));
  };
  const branchBlocked = () => {
    if (decorBlocked()) return true;
    if (branch) return false;
    toast('카드·글자·도형에서 가지 뻗기는 아직 서버에 저장할 수 없어요(준비 중).');
    return true;
  };
  const textGate = (patch, now = null) => (needsBranch(patch, now) ? branchBlocked() : needsDecor(patch) ? decorBlocked() : needsMap(patch) ? mapBlocked() : textBlocked());
  // 틀 칸(높이·손으로 둔 자리)이 아직 없는 서버면 그 칸만 뺀다(저장만 건너뜀 — 화면은 서버 값으로 돌아감).
  const frameless = asked => {
    // S71-51: 부모를 바꾸는데 카드 표시가 없으면 글 상자 부모(화면 줄의 옛 parent_card가 남지 않게).
    const patch = Object.hasOwn(asked, 'parent_id') && !Object.hasOwn(asked, 'parent_card') ? {...asked, parent_card:false} : asked;
    return frame ? patch : Object.fromEntries(Object.entries(patch).filter(([k]) => !FRAME_KEYS.includes(k)));
  };
  // 지운 상자 아래 가지 id(서버 cascade와 같게 화면에서도 함께 뺀다).
  const branchOf = id => { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const t of texts) if (t.parent_id && out.has(t.parent_id) && !out.has(t.id)) { out.add(t.id); grew = true; } } return out; };
  const api = {
    load,
    reset() { links = []; texts = []; ready = false; v2 = false; lines = false; relation = false; textsReady = false; mindmap = false; frame = false; decor = false; branch = false; missing = false; loadedFor = undefined; },
    mindmapReady:() => mindmap,
    frameReady:() => mindmap && frame,
    decorReady:() => mindmap && frame && decor,
    branchReady:() => mindmap && frame && decor && branch,
    checkBranch:() => !branchBlocked(),
    linesReady:() => ready && v2 && lines,
    relationReady:() => ready && v2 && lines && relation, // S71-53 관계선 칸(kind)이 있나
    checkRelation:() => !blocked({kind:'relation'}),
    checkDecor:() => !decorBlocked(),
    checkLines:() => !blocked({from_x:0}),
    checkMindmap:() => !mapBlocked(),
    ready:() => ready,
    canBend:() => ready && v2,
    textsReady:() => textsReady,
    checkTexts:() => !textBlocked(), // 글 상자를 만들 수 있나(못 하면 알림 한 줄)
    all:() => links,
    forBoard:boardId => links.filter(l => l.board_id === boardId),
    textsFor:boardId => texts.filter(t => t.board_id === boardId),
    async add(link) {
      if (blocked(link)) return null;
      const temp = {id:tempId('l'), from_note:null, to_note:null, from_text:null, to_text:null, from_x:null, from_y:null, to_x:null, to_y:null, color:null, width:null, from_side:null, to_side:null, shape:'line', dash:'solid', ends:'end', label:null, bend_x:null, bend_y:null, kind:'line', ...link, pending:true};
      links = [...links, temp]; onChange();
      const owner = scope();
      try { const saved = await addBoardLink(link, rt, {v2, lines, relation}); if (owner !== scope()) return null; links = links.map(l => (l.id === temp.id ? saved : l)); onChange(); return saved; }
      catch { if (owner === scope()) await failed('연결선을 저장하지 못했어요. 다시 불러올게요.'); return null; }
    },
    async update(id, patch) {
      if (blocked(patch)) { onChange(); return; } // 끌던 곡선 미리 보기를 되돌린다
      const old = links.find(l => l.id === id); if (!old || old.pending) return;
      links = links.map(l => (l.id === id ? {...l, ...patch} : l)); onChange();
      const owner = scope();
      try { const saved = await updateBoardLink(id, patch, rt, {v2, lines, relation}); if (owner === scope()) { links = links.map(l => (l.id === id ? saved : l)); onChange(); } }
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
      } catch { if (owner === scope()) await failed('연결선·상자를 다 정리하지 못했어요. 다시 불러올게요.'); }
    },
    // ---- 글 상자 ----
    async addText(asked) {
      const text = frameless(asked);
      if (textGate(text)) return null;
      const temp = {...nodeShape({id:tempId('t'), board_id:text.board_id, body:text.body, x:text.x, y:text.y}, text), pending:true};
      texts = [...texts, temp]; onChange();
      const owner = scope();
      try { const saved = await addBoardText(text, rt, {mindmap, frame, decor, branch}); if (owner !== scope()) return null; texts = texts.map(t => (t.id === temp.id ? saved : t)); onChange(); return saved; }
      catch { if (owner === scope()) await failed('상자를 저장하지 못했어요. 다시 불러올게요.'); return null; }
    },
    async updateText(id, asked) {
      const patch = frameless(asked);
      const old = texts.find(t => t.id === id);
      if (!Object.keys(patch).length || textGate(patch, old)) { onChange(); return; }
      if (!old || old.pending) return;
      texts = texts.map(t => (t.id === id ? {...t, ...patch} : t)); onChange();
      const owner = scope();
      try { const saved = await updateBoardText(id, patch, rt, {mindmap, frame, decor, branch}); if (owner === scope()) { texts = texts.map(t => (t.id === id ? saved : t)); onChange(); } }
      catch { if (owner === scope()) await failed('상자를 바꾸지 못했어요. 다시 불러올게요.'); }
    },
    // 여러 상자를 한 번에(형제 순서 다시 매기기·가지 옮겨 붙이기): 화면은 한 번에 바꾸고 서버에는 줄마다 보낸다.
    async updateTexts(list) {
      const items = list.map(({id, patch}) => ({id, patch:frameless(patch)})).filter(({id, patch}) => Object.keys(patch).length && texts.some(t => t.id === id && !t.pending));
      if (!items.length) return;
      const nowOf = id => texts.find(t => t.id === id);
      if (items.some(({id, patch}) => needsBranch(patch, nowOf(id))) ? branchBlocked() : items.some(({patch}) => needsDecor(patch)) ? decorBlocked() : items.some(({patch}) => needsMap(patch)) ? mapBlocked() : textBlocked()) { onChange(); return; }
      const by = new Map(items.map(({id, patch}) => [id, patch]));
      texts = texts.map(t => (by.has(t.id) ? {...t, ...by.get(t.id)} : t)); onChange();
      const owner = scope();
      try {
        const saved = await Promise.all(items.map(({id, patch}) => updateBoardText(id, patch, rt, {mindmap, frame, decor, branch})));
        if (owner === scope()) { const got = new Map(saved.map(t => [t.id, t])); texts = texts.map(t => got.get(t.id) || t); onChange(); }
      } catch { if (owner === scope()) await failed('상자를 바꾸지 못했어요. 다시 불러올게요.'); }
    },
    // S70-03 여러 개 한 번에 지우기(고른 것 Delete·Backspace·우클릭 [삭제]): 상자는 아래 가지째, 선은 그 선, noteIds = 보드에서 빼는 카드의 선.
    // 화면은 한 번에 바꾸고 서버에는 뿌리 상자·남은 선만 보낸다(아래 가지·붙은 선은 서버 cascade). 지운 줄을 돌려준다(되돌리기용) — 못 하면 null.
    async removeMany({textIds = [], linkIds = [], noteIds = [], boardId = null} = {}) {
      const tIds = [...new Set(textIds)].filter(id => texts.some(t => t.id === id && !t.pending));
      if (tIds.length && textBlocked()) return null;
      const gone = new Set(); for (const id of tIds) for (const g of branchOf(id)) gone.add(g);
      const goneTexts = texts.filter(t => gone.has(t.id)), notes = new Set(noteIds), want = new Set(linkIds);
      const goneLinks = links.filter(l => !l.pending && (want.has(l.id) || [...gone].some(g => touches(l, g)) || (boardId && l.board_id === boardId && (notes.has(l.from_note) || notes.has(l.to_note)))));
      if (!goneTexts.length && !goneLinks.length) return {texts:[], links:[]};
      texts = texts.filter(t => !gone.has(t.id)); links = links.filter(l => !goneLinks.includes(l)); onChange();
      const roots = goneTexts.filter(t => !(t.parent_id && gone.has(t.parent_id))).map(t => t.id);
      const loose = goneLinks.filter(l => ![...gone].some(g => touches(l, g)));
      const owner = scope();
      try { await Promise.all([...roots.map(id => deleteBoardTexts({id}, rt)), ...loose.map(l => deleteBoardLinks({id:l.id}, rt))]); }
      catch { if (owner === scope()) await failed('삭제하지 못했어요. 다시 불러올게요.'); return null; }
      return {texts:goneTexts, links:goneLinks};
    },
    // 되돌리기: 지운 상자를 위(뿌리)부터 다시 만들고(새 id), 선은 새 id로 이어 다시 긋는다. 끝이 없어진 선은 건너뛴다. 다 되면 true.
    async restore({texts:rows = [], links:lrows = []} = {}, alive = () => true) {
      const map = new Map(), inSet = new Set(rows.map(t => t.id));
      let left = rows.slice(), ok = true;
      while (left.length) {
        const ready = left.filter(t => !t.parent_id || !inSet.has(t.parent_id) || map.has(t.parent_id));
        if (!ready.length) { ok = false; break; }
        left = left.filter(t => !ready.includes(t));
        const saved = await Promise.all(ready.map(t => {
          const {id:_id, pending:_p, workspace_id:_w, created_at:_c, updated_at:_u, ...rest} = t;
          return api.addText({...rest, parent_id:t.parent_id && inSet.has(t.parent_id) ? map.get(t.parent_id) ?? null : t.parent_id ?? null});
        }));
        ready.forEach((t, i) => { if (saved[i]) map.set(t.id, saved[i].id); else ok = false; });
      }
      const there = id => map.get(id) || (texts.some(t => t.id === id) ? id : null);
      for (const l of lrows) {
        const {id:_id, pending:_p, workspace_id:_w, created_at:_c, ...rest} = l, next = {...rest};
        let skip = false;
        for (const side of ['from', 'to']) if (l[`${side}_text`]) { const t = there(l[`${side}_text`]); if (t) next[`${side}_text`] = t; else skip = true; }
        for (const side of ['from', 'to']) if (l[`${side}_note`] && !alive(l[`${side}_note`])) skip = true;
        if (skip) { ok = false; continue; }
        if (!(await api.add(next))) ok = false;
      }
      return ok;
    },
    async removeText(id) {
      if (textBlocked()) return;
      if (!texts.some(t => t.id === id && !t.pending)) return;
      const gone = branchOf(id);
      texts = texts.filter(t => !gone.has(t.id)); links = links.filter(l => ![...gone].some(g => touches(l, g))); onChange();
      const owner = scope();
      try { await deleteBoardTexts({id}, rt); } catch { if (owner === scope()) await failed('상자를 삭제하지 못했어요. 다시 불러올게요.'); }
    },
  };
  return api;
}
