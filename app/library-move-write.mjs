// LIB-끌어옮기기저장실패(S69, 명진 11/24 16:09 "폴더밖에서 폴더로 드래그해서 이동하는데 … 저장하지 못했어요"): 자료 여럿을 폴더로(또는 폴더 밖으로) 옮기는 쓰기.
// 원인(사실, 코드): 전에는 자료 하나마다 요청 하나(559개면 559번)였고, 화면이 연결 줄을 일부만 읽은 자료(1000줄 한도 — 이어 읽기는 #2979 library-folder-data.js)는
//   '새 연결 넣기'(POST)가 이미 있는 줄과 겹쳐 거절(409·23505)되어 그대로 실패로 셌다.
// 지금: 100개씩 한 요청(이미 연결된 것 PATCH document_id=in.(…), 새로 넣을 것 POST 배열, 폴더 밖으로는 DELETE in.(…)).
//   한 묶음이 거절되면 그 묶음만 하나씩 다시 해 실패한 자료만 남긴다. 새로 넣기가 겹침(409)이면 그 자료의 지금 폴더를 읽어 기억한 뒤 PATCH(되돌리기가 그 자리로).
// 쓰는 곳은 그대로 소유자 RLS 표(app_library_folder_items) 하나 — 서버 권한·검사는 바뀌지 않는다. 드라이브 파일은 건드리지 않는다
//   (연결만 한 원본·앱이 만든 파일 모두 자료실 폴더 줄만 바뀜. 드라이브 위치는 저장 직후 drive-follow.mjs가 서버에 맞추게 부탁).
export const MOVE_CHUNK = 100;
const T_ITEMS = '/rest/v1/app_library_folder_items';
const enc = encodeURIComponent;
export const isDuplicate = e => Number(e?.status) === 409 || /23505|duplicate/i.test(`${e?.code || ''} ${e?.serverCode || ''} ${e?.message || ''}`);
const inList = ids => `document_id=in.(${ids.map(enc).join(',')})`;

// prev: [{id, had, folder}] (had = 화면이 아는 연결 줄이 있음, folder = 그 폴더). folderId: 옮길 폴더(null = 폴더 밖).
// all: 하나라도 실패하면 거기서 멈춘다(나머지는 failed) — 보상(되돌림)은 부르는 쪽이 done으로 한다.
// 돌려주는 것: {done:[id], failed:[id], firstError}. prev의 had·folder는 실제로 알게 된 값으로 고쳐 둔다(되돌리기용).
export async function writeMoves({api, ws, prev, folderId, all = false, chunk = MOVE_CHUNK, onProgress = () => {}}) {
  const w = id => `?document_id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}`;
  const done = [], failed = [];
  let firstError = null, seen = 0;
  const fail = (ids, e) => { firstError ??= e; failed.push(...ids); };
  async function one(p) {
    if (folderId === null) { await api(T_ITEMS + w(p.id), {method: 'DELETE', prefer: 'return=minimal', singleFlight: false}); return; }
    if (p.had) { await api(T_ITEMS + w(p.id), {method: 'PATCH', prefer: 'return=minimal', body: {folder_id: folderId}, singleFlight: false}); return; }
    try { await api(T_ITEMS, {method: 'POST', prefer: 'return=minimal', body: {document_id: p.id, folder_id: folderId, workspace_id: ws}, singleFlight: false}); }
    catch (e) {
      if (!isDuplicate(e)) throw e;
      // 화면이 몰랐던 연결 줄이 있다 — 지금 폴더를 읽어 되돌리기 자리로 기억하고 옮긴다.
      const rows = await api(T_ITEMS + w(p.id) + '&select=folder_id', {singleFlight: false});
      p.had = true; p.folder = Array.isArray(rows) && rows[0]?.folder_id || null;
      await api(T_ITEMS + w(p.id), {method: 'PATCH', prefer: 'return=minimal', body: {folder_id: folderId}, singleFlight: false});
    }
  }
  async function oneByOne(list) {
    for (const p of list) {
      if (all && failed.length) { failed.push(p.id); continue; }
      try { await one(p); done.push(p.id); } catch (e) { fail([p.id], e); }
    }
  }
  // 한 묶음 한 요청. 실제로 바뀐 줄(return=representation)이 모자라면 그 자료만 하나씩 다시.
  async function batch(list, kind) {
    // 하나뿐이면 예전과 같은 한 줄 요청(eq·객체 본문). 결과 확인은 거절(던짐) 여부로.
    if (list.length === 1 && kind !== 'post') { await one(list[0]); return list; }
    if (list.length === 1) { await api(T_ITEMS, {method: 'POST', prefer: 'return=minimal', body: {document_id: list[0].id, folder_id: folderId, workspace_id: ws}, singleFlight: false}); return list; }
    const ids = list.map(p => p.id), base = `?workspace_id=eq.${enc(ws)}&${inList(ids)}&select=document_id`;
    let changed;
    if (kind === 'delete') changed = await api(T_ITEMS + base, {method: 'DELETE', prefer: 'return=representation', singleFlight: false});
    else if (kind === 'patch') changed = await api(T_ITEMS + base, {method: 'PATCH', prefer: 'return=representation', body: {folder_id: folderId}, singleFlight: false});
    else { await api(T_ITEMS, {method: 'POST', prefer: 'return=minimal', body: list.map(p => ({document_id: p.id, folder_id: folderId, workspace_id: ws})), singleFlight: false}); return list; }
    // 줄 목록 없이 성공만 알린 응답(빈 본문)은 묶음 전체를 성공으로 본다(거절이면 위에서 던졌다).
    if (!Array.isArray(changed)) return list;
    const got = new Set(changed.map(r => r?.document_id));
    return list.filter(p => got.has(p.id));
  }
  async function runPart(part, kind) {
    if (!part.length) return;
    try {
      const ok = await batch(part, kind), okIds = new Set(ok.map(p => p.id));
      done.push(...ok.map(p => p.id));
      const rest = part.filter(p => !okIds.has(p.id));
      // 바뀌지 않은 줄: 폴더 밖으로는 이미 없는 것(= 됨), 옮기기는 화면이 안 연결 줄이 그 사이 없어진 것 → 새로 넣기로.
      if (kind === 'delete') done.push(...rest.map(p => p.id));
      else if (rest.length) { for (const p of rest) { p.had = false; p.folder = null; } await runPart(rest, 'post'); }
    } catch (e) {
      if (kind !== 'post' || !isDuplicate(e)) { if (part.length === 1) fail([part[0].id], e); else await oneByOne(part); return; }
      // 새로 넣을 묶음에 화면이 몰랐던 연결 줄이 섞였다: 그 줄들의 지금 폴더를 한 번에 읽어(되돌리기 자리) 옮기기와 넣기로 나눠 다시.
      let rows;
      try { rows = await api(T_ITEMS + `?workspace_id=eq.${enc(ws)}&${inList(part.map(p => p.id))}&select=document_id,folder_id`, {singleFlight: false}); }
      catch { await oneByOne(part); return; }
      const ids = new Set(part.map(p => p.id));
      const had = new Map((Array.isArray(rows) ? rows : []).filter(r => ids.has(r?.document_id)).map(r => [r.document_id, r.folder_id || null]));
      // 겹친 줄을 찾지 못하면(그 사이 바뀜) 다시 묶지 않고 하나씩 — 같은 묶음을 되풀이하지 않는다.
      if (!had.size) { await oneByOne(part); return; }
      for (const p of part) if (had.has(p.id)) { p.had = true; p.folder = had.get(p.id); }
      await runPart(part.filter(p => p.had), 'patch');
      await runPart(part.filter(p => !p.had), 'post');
    }
  }
  const groups = folderId === null
    ? [['delete', prev.filter(p => p.had)], ['skip', prev.filter(p => !p.had)]]
    : [['patch', prev.filter(p => p.had)], ['post', prev.filter(p => !p.had)]];
  for (const [kind, list] of groups) {
    if (kind === 'skip') { done.push(...list.map(p => p.id)); seen += list.length; continue; }
    for (let i = 0; i < list.length; i += chunk) {
      const part = list.slice(i, i + chunk);
      if (all && failed.length) { failed.push(...part.map(p => p.id)); seen += part.length; continue; }
      await runPart(part, kind);
      seen += part.length;
      try { onProgress({index: Math.min(seen, prev.length), total: prev.length}); } catch { /* 표시만 */ }
    }
  }
  return {done, failed, firstError};
}

// 되돌리기(옮긴 것만, 그 사이 또 옮겨진 것은 건드리지 않음 — 지금 폴더가 folderId인 줄만). 돌려주는 것: 되돌린 개수.
export async function undoMoves({api, ws, moved, folderId, chunk = MOVE_CHUNK}) {
  let back = 0;
  const guard = folderId ? `&folder_id=eq.${enc(folderId)}` : '';
  const count = (out, n) => (Array.isArray(out) ? out.length : n);
  if (folderId === null) {
    // 폴더 밖으로 옮긴 것 → 이전 폴더로 다시 넣기. 그 사이 다른 폴더에 들어간 자료는 겹침 거절 → 그 자료만 건너뜀.
    const rows = moved.filter(p => p.had && p.folder).map(p => ({document_id: p.id, folder_id: p.folder, workspace_id: ws}));
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);
      try { await api(T_ITEMS, {method: 'POST', prefer: 'return=minimal', body: part, singleFlight: false}); back += part.length; }
      catch { for (const r of part) { try { await api(T_ITEMS, {method: 'POST', prefer: 'return=minimal', body: r, singleFlight: false}); back++; } catch { /* 그 사이 바뀜 */ } } }
    }
    return back;
  }
  const by = new Map();
  for (const p of moved) { const k = p.had ? (p.folder || '') : null; const key = k === null ? '\u0000del' : k; if (!by.has(key)) by.set(key, []); by.get(key).push(p.id); }
  for (const [key, ids] of by) {
    for (let i = 0; i < ids.length; i += chunk) {
      const part = ids.slice(i, i + chunk), q = `?workspace_id=eq.${enc(ws)}&${inList(part)}${guard}&select=document_id`;
      try {
        if (key === '\u0000del' || key === '') back += count(await api(T_ITEMS + q, {method: 'DELETE', prefer: 'return=representation', singleFlight: false}), part.length);
        else back += count(await api(T_ITEMS + q, {method: 'PATCH', prefer: 'return=representation', body: {folder_id: key}, singleFlight: false}), part.length);
      } catch { /* 남은 것은 목록 다시 읽기가 보여 준다 */ }
    }
  }
  return back;
}
