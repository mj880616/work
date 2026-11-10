// FILES-클라우드탐색기 ④ E2E 공용 흉내 서버(파일 화면). 파일·폴더 이름과 id는 모두 가짜.
// 색인 읽기 함수(app_cloud_list·app_cloud_trail·app_cloud_find_in(켜진 출처만, S49-26)·옛 app_cloud_find)와 Edge cloud-files(status·sync·folder·thumb·media·preview·open-url,
// S48-45 쓰기 rename·mkdir·move·trash·across, S49-27 copy, S49-28 전송 작업표 job_add·job_list·job_pause·job_resume)를 흉내 낸다.
// 작업표: job_list를 부를 때마다 가장 오래된 줄이 한 걸음 나아간다(작은 것은 끝, 큰 것(big)은 40%씩). jobsHold면 멈춰 있고, jobFail이면 첫 줄이 그 까닭으로 한 번 실패.
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openHome } from './home-entry.mjs';
import { servePagesCors } from './hwp-editor.mjs';
// S52-44 ③: 한글 파일 미리보기는 저장소 한글 엔진(칸막이 iframe)이 읽는다 — 흉내 서버는 진짜 시험용 한글 파일을 돌려준다.
const HWP = readFileSync(new URL('../../fixtures/hwp-lab/sample.hwp', import.meta.url)), HWPX = readFileSync(new URL('../../fixtures/hwp-lab/sample.hwpx', import.meta.url));
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
export const UPLOAD_HOST = 'https://upload.example.test';
// 시계는 2026-10-06 10:00 서울(home-entry.mjs).
const item = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 1000, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });
export const ITEMS = () => [
  item({ source: 'od', item_id: 'OD!1', name: '가짜 문서함', is_folder: true, size_bytes: null }),
  item({ source: 'od', item_id: 'OD!2', name: '가짜 사진함', is_folder: true, size_bytes: null }),
  item({ source: 'od', item_id: 'OD!10', parent_id: 'OD!1', name: '가짜 2026', is_folder: true, size_bytes: null }),
  item({ source: 'od', item_id: 'OD!11', parent_id: 'OD!1', name: '가짜 안내문.pdf', mime: 'application/pdf', size_bytes: 1258291, modified_at: '2026-10-05T03:00:00Z' }),
  item({ source: 'od', item_id: 'OD!12', parent_id: 'OD!1', name: '가짜 예산표.xlsx', size_bytes: 63488, modified_at: '2026-10-06T00:12:00Z', starred: true }),
  item({ source: 'od', item_id: 'OD!13', parent_id: 'OD!1', name: '가짜 메모.txt', mime: 'text/plain', size_bytes: 3000, modified_at: '2026-09-20T01:00:00Z' }),
  item({ source: 'od', item_id: 'OD!14', parent_id: 'OD!10', name: '가짜 계획안.hwpx', size_bytes: 188416, modified_at: '2026-10-06T00:05:00Z' }),
  item({ source: 'od', item_id: 'OD!20', parent_id: 'OD!2', name: '가짜 현장.jpg', mime: 'image/jpeg', size_bytes: 3565158, modified_at: '2026-10-04T01:00:00Z' }),
  item({ source: 'gd', item_id: 'gdFolder1', name: '가짜 업무 공간', is_folder: true, size_bytes: null }),
  item({ source: 'gd', item_id: 'gdDoc1', parent_id: 'gdFolder1', name: '가짜 결과 정리.pdf', mime: 'application/pdf', size_bytes: 655360, modified_at: '2026-10-05T05:00:00Z', library_doc_id: 'd0000000-0000-4000-8000-000000000001', _text: '가짜 협약 문구' }),
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// 한 쪽짜리 가짜 PDF(글 'Fake'), xref 위치는 계산해서 맞춘다.
export function fakePdf() {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 24 Tf 40 100 Td (Fake) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export async function filesServer(page, { connected = { od: true, gd: true }, prefs = [], prefsFail = false, prefsMissing = false } = {}) {
  // findFail: {status, message} — 찾기·묶음 읽기를 그 오류로 실패시킨다(서버 시간 초과 흉내 등).
  const server = { items: ITEMS(), calls: [], pendingSync: null, directItems: [], findFail: null, jobs: [], jobSeq: 0, jobsHold: false, jobFail: '',
    slots: {}, upChunk: 4, slotHold: false, puts: [], prefs: prefs.map(x => ({ ...x })), prefCalls: [], prefReads: 0 };
  // 흉내 클라우드 이어 올리기 자리(브라우저가 조각을 직접 보냄, CORS 머리 포함). slotHold면 조각 응답을 붙잡아 둔다(멈춤·숨김 시험).
  await page.route(UPLOAD_HOST + '/**', async route => {
    const req = route.request(), cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT', 'access-control-allow-headers': 'content-range' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const slot = server.slots[req.url()];
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers()['content-range'] || '');
    server.puts.push({ url: req.url(), range: req.headers()['content-range'] || '', auth: req.headers().authorization || '' });
    if (!slot || !range) return route.fulfill({ status: 404, headers: cors });
    while (server.slotHold) await new Promise(r => setTimeout(r, 50));
    if (Number(range[1]) !== slot.bytes) return route.fulfill({ status: 400, headers: cors });
    slot.bytes = Number(range[2]) + 1;
    // 화면이 조각을 멈춰(abort) 응답을 받을 곳이 없으면 그대로 둔다(클라우드는 받은 만큼 기억).
    const reply = o => route.fulfill(o).catch(() => {});
    if (slot.bytes < slot.size) return reply({ status: 308, headers: cors });
    return reply({ status: 201, headers: cors, contentType: 'application/json', body: JSON.stringify({ id: 'cloudNew' + (Object.keys(server.slots).indexOf(req.url()) + 1) }) });
  });
  const trail = (source, id) => {
    const out = [];
    let cur = server.items.find(i => i.source === source && i.item_id === id), depth = 0;
    while (cur) { out.push({ item_id: cur.item_id, name: cur.name, depth: depth++ }); cur = server.items.find(i => i.source === source && i.item_id === cur.parent_id); }
    return out;
  };
  const view = i => { const { _text, ...row } = i; return row; };
  const pathOf = i => trail(i.source, i.parent_id).reverse().map(t => t.name).join(' › ');
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/cloud-files') {
      server.calls.push({ what: 'edge', action: body?.action, body, auth: req.headers().authorization || '', range: req.headers().range || '' });
      const a = body?.action;
      if (a === 'status') return ok({ ok: true, od: { connected: connected.od, scanning: false, synced_at: '2026-10-06T00:59:00Z', index_done_at: '2026-10-01T00:00:00Z', error: null }, gd: { connected: connected.gd, scanning: false, synced_at: '2026-10-06T00:58:00Z', index_done_at: '2026-10-01T00:00:00Z', error: null } });
      // S50-14: server.syncReply가 있으면 출처별 응답(more·done·error)을 그 값으로(처음 훑기 남음·실패 흉내).
      if (a === 'sync') { const d = server.pendingSync || { changed: [], removed: [] }; server.pendingSync = null; return ok({ ok: true, od: { fresh: true }, gd: { fresh: true }, reload: false, ...(server.syncReply || {}), ...d }); }
      // S48-65 폴더 바로 읽기: 색인에 없는 줄(server.directItems 중 그 폴더 것)을 색인에 합치고 새로 찾은 수를 돌려준다.
      if (a === 'folder') {
        const here = server.directItems.filter(i => i.source === body.source && (i.parent_id ?? null) === (body.id ?? null));
        const fresh = here.filter(i => !server.items.some(x => x.source === i.source && x.item_id === i.item_id));
        server.items.push(...fresh);
        return ok({ ok: true, found: here.length, added: fresh.length, truncated: false, changed: fresh.map(view), reload: false });
      }
      if (a === 'thumb') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (a === 'preview') return route.fulfill({ status: 200, contentType: 'application/pdf', body: fakePdf() });
      if (a === 'media') {
        const it = server.items.find(i => i.source === body.source && i.item_id === body.id);
        if (it?.mime === 'text/plain') return route.fulfill({ status: 206, contentType: 'text/plain; charset=utf-8', body: '가짜 메모 첫 줄\n둘째 줄' });
        if (/\.hwpx?$/i.test(it?.name || '')) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: /x$/i.test(it.name) ? HWPX : HWP });
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: fakePdf() });
      }
      if (a === 'open-url') return ok({ ok: true, url: 'https://example.org/fake-open' });
      if (['job_add', 'job_list', 'job_pause', 'job_resume'].includes(a)) {
        if (a !== 'job_list' && body.confirm !== true) return ok({ ok: false, error: 'confirm_required' }, 400);
        const find = (src, id) => server.items.find(i => i.source === src && i.item_id === id && !i.trashed);
        const taken = (src, parent) => server.items.filter(i => i.source === src && (i.parent_id ?? null) === (parent ?? null) && !i.trashed).map(i => i.name);
        const numbered = (name, list) => { if (!list.some(n => n.toLowerCase() === name.toLowerCase())) return name; const m = /^(.*?)(\.[A-Za-z0-9]{1,10})?$/.exec(name); for (let i = 2; ; i++) { const n = `${m[1]} (${i})${m[2] || ''}`; if (!list.some(x => x.toLowerCase() === n.toLowerCase())) return n; } };
        const view = j => { const { _failed, ...v } = j; return v; };
        const list = () => [...server.jobs].reverse().map(view);
        if (a === 'job_add') {
          const made = body.items.map(it => {
            const src = find(it.source, it.id), seq = ++server.jobSeq;
            const big = it.source !== body.to_source && src.size_bytes > 200 * 1024 * 1024;
            const j = { id: `b0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, kind: body.kind, origin: 'cloud', src_source: it.source, src_id: it.id, dest_source: body.to_source, dest_parent: body.to ?? null,
              name: src.name, result_name: null, same_name: it.skip ? 'skipped' : it.numbered ? 'numbered' : null, is_folder: !!src.is_folder, size_bytes: src.size_bytes, big: big && !!it.big,
              status: it.skip ? 'skipped' : big && !it.big ? 'failed' : 'queued', sent_bytes: 0, result_item_id: null, kept_original: false, error_code: big && !it.big ? 'big_not_confirmed' : null,
              created_at: `2026-10-06T01:00:${String(seq).padStart(2, '0')}Z`, finished_at: null };
            server.jobs.push(j); return view(j);
          });
          return ok({ ok: true, jobs: made.reverse() });
        }
        if (a === 'job_list') {
          const j = server.jobsHold ? null : server.jobs.find(x => x.origin !== 'device' && (x.status === 'queued' || x.status === 'running'));
          if (j && server.jobFail && !j._failed) { j._failed = true; j.status = 'failed'; j.error_code = server.jobFail; }
          else if (j) {
            j.status = 'running';
            if (j.big) j.sent_bytes = Math.min(j.size_bytes, j.sent_bytes + Math.ceil(j.size_bytes * 0.4));
            if (!j.big || j.sent_bytes >= j.size_bytes) {
              const it = find(j.src_source, j.src_id), seq = ++server.copySeqJ || (server.copySeqJ = 1);
              const copy = item({ ...view(it), source: j.dest_source, item_id: j.dest_source === 'od' ? 'OD!J' + server.jobSeq + j.id.slice(-2) : 'gdJob' + j.id.slice(-2), parent_id: j.dest_parent, name: numbered(it.name, taken(j.dest_source, j.dest_parent)), trashed: false, starred: false });
              server.items.push(copy);
              if (j.kind === 'move') it.trashed = true;
              Object.assign(j, { status: 'done', sent_bytes: j.size_bytes ?? 0, result_item_id: copy.item_id, result_name: copy.name, finished_at: '2026-10-06T01:01:00Z' });
              void seq;
            }
          }
          return ok({ ok: true, jobs: list() });
        }
        const pick = x => body.all === true || (body.ids || []).includes(x.id);
        const changed = [];
        for (const x of server.jobs) {
          if (!pick(x)) continue;
          if (a === 'job_pause' && ['queued', 'running'].includes(x.status)) { x.status = 'paused'; changed.push(view(x)); }
          if (a === 'job_resume' && ['paused', 'failed'].includes(x.status)) { x.status = 'queued'; x.error_code = null; changed.push(view(x)); }
        }
        return ok({ ok: true, jobs: changed });
      }
      // S49-33 올리기(기기 → 클라우드): 서버는 자리(흉내 주소 UPLOAD_HOST/slot/N)만 열어 주고 화면이 조각을 직접 보낸다. 별표 켜고 끄기.
      if (['upload_open', 'upload_resume', 'upload_progress', 'upload_done', 'star'].includes(a)) {
        if (body.confirm !== true) return ok({ ok: false, error: 'confirm_required' }, 400);
        const view = j => { const { _slot, ...v } = j; return v; };
        const taken = (src, parent) => server.items.filter(i => i.source === src && (i.parent_id ?? null) === (parent ?? null) && !i.trashed).map(i => i.name);
        const numbered = (name, list) => { if (!list.some(n => n.toLowerCase() === name.toLowerCase())) return name; const m = /^(.*?)(\.[A-Za-z0-9]{1,10})?$/.exec(name); for (let i = 2; ; i++) { const n = `${m[1]} (${i})${m[2] || ''}`; if (!list.some(x => x.toLowerCase() === n.toLowerCase())) return n; } };
        if (a === 'star') {
          for (const id of body.ids) { const it = server.items.find(i => i.source === body.source && i.item_id === id); if (it) it.starred = body.on; }
          return ok({ ok: true, source: body.source, ids: body.ids, starred: body.on });
        }
        if (a === 'upload_open') {
          if (body.size > 200 * 1024 * 1024 && !body.big) return ok({ ok: false, error: 'big_not_confirmed' }, 400);
          const seq = ++server.jobSeq, nm = numbered(body.name, taken(body.to_source, body.to));
          const url = `${UPLOAD_HOST}/slot/${seq}`;
          server.slots[url] = { bytes: 0, size: body.size, puts: 0 };
          const j = { id: `b0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, kind: 'copy', origin: 'device', src_source: 'dev', src_id: null, dest_source: body.to_source, dest_parent: body.to ?? null,
            name: body.name, result_name: nm, same_name: nm !== body.name ? 'numbered' : null, is_folder: false, size_bytes: body.size, big: body.size > 200 * 1024 * 1024,
            status: 'queued', sent_bytes: 0, result_item_id: null, kept_original: false, error_code: null, created_at: `2026-10-06T01:00:${String(seq).padStart(2, '0')}Z`, finished_at: null, _slot: url };
          server.jobs.push(j);
          return ok({ ok: true, job: view(j), upload: { url, offset: 0, chunk: server.upChunk } });
        }
        const j = server.jobs.find(x => x.id === body.id && x.origin === 'device');
        if (!j) return ok({ ok: false, error: 'job_not_found' }, 404);
        if (a === 'upload_resume') {
          if (body.name !== j.name || body.size !== j.size_bytes) return ok({ ok: false, error: 'file_mismatch' }, 409);
          j.status = 'running'; j.error_code = null;
          const slot = server.slots[j._slot];
          j.sent_bytes = slot.bytes;
          return ok({ ok: true, job: view(j), upload: { url: j._slot, offset: slot.bytes, chunk: server.upChunk } });
        }
        if (a === 'upload_progress') {
          if (j.status !== 'running') return ok({ ok: true, job: view(j) });
          if (body.error) Object.assign(j, { status: 'failed', error_code: body.error }); else j.sent_bytes = body.sent;
          return ok({ ok: true, job: view(j) });
        }
        if (a === 'upload_done') {
          const it = item({ source: j.dest_source, item_id: j.dest_source === 'od' ? 'OD!U' + j.id.slice(-2) : 'gdUp' + j.id.slice(-2), parent_id: j.dest_parent, name: j.result_name, size_bytes: j.size_bytes, modified_at: '2026-10-06T01:00:00Z' });
          server.items.push(it);
          Object.assign(j, { status: 'done', sent_bytes: j.size_bytes, result_item_id: it.item_id, finished_at: '2026-10-06T01:01:00Z' });
          server.doneBody = body;
          return ok({ ok: true, job: view(j), changed: [it] });
        }
      }
      // S48-45 쓰기: confirm:true 없으면 거절(서버와 같음). 결과는 바뀐 줄·지운 줄.
      if (['rename', 'mkdir', 'move', 'trash', 'across', 'copy'].includes(a)) {
        if (body.confirm !== true) return ok({ ok: false, error: 'confirm_required' }, 400);
        const find = (src, id) => server.items.find(i => i.source === src && i.item_id === id && !i.trashed);
        if (a === 'rename') { const it = find(body.source, body.id); if (server.items.some(i => i !== it && i.source === it.source && i.parent_id === it.parent_id && i.name === body.name)) return ok({ ok: false, error: 'name_taken' }, 409); it.name = body.name; return ok({ ok: true, changed: [view(it)], removed: [] }); }
        if (a === 'mkdir') { const it = item({ source: body.source, item_id: body.source === 'od' ? 'OD!90' : 'gdNew90', parent_id: body.parent ?? null, name: body.name, is_folder: true, size_bytes: null }); server.items.push(it); return ok({ ok: true, changed: [view(it)], removed: [] }); }
        // 같은 이름: copy·across는 늘, move는 numbered:true일 때 번호를 붙인다(Edge와 같은 규칙, 공용 numberedName).
        const taken = (src, parent) => server.items.filter(i => i.source === src && (i.parent_id ?? null) === (parent ?? null) && !i.trashed).map(i => i.name);
        const numbered = (name, list) => { if (!list.some(n => n.toLowerCase() === name.toLowerCase())) return name; const m = /^(.*?)(\.[A-Za-z0-9]{1,10})?$/.exec(name); for (let i = 2; ; i++) { const n = `${m[1]} (${i})${m[2] || ''}`; if (!list.some(x => x.toLowerCase() === n.toLowerCase())) return n; } };
        if (a === 'move') { const changed = body.ids.map(id => { const it = find(body.source, id); if (body.numbered && (it.parent_id ?? null) !== (body.to ?? null)) it.name = numbered(it.name, taken(body.source, body.to)); it.parent_id = body.to ?? null; return view(it); }); return ok({ ok: true, changed, removed: [], failed: [], left: [] }); }
        if (a === 'copy') {
          if (server.copyDelayMs) await new Promise(r => setTimeout(r, server.copyDelayMs));
          const it = find(body.source, body.id), dest = body.to_source || body.source;
          server.copySeq = (server.copySeq || 0) + 1;
          const copy = item({ ...view(it), source: dest, item_id: dest === 'od' ? 'OD!C' + server.copySeq : 'gdCopy' + server.copySeq, parent_id: body.to ?? null, name: numbered(it.name, taken(dest, body.to)), trashed: false, starred: false });
          server.items.push(copy); return ok({ ok: true, changed: [view(copy)], removed: [] });
        }
        if (a === 'trash') { for (const id of body.ids) find(body.source, id).trashed = true; return ok({ ok: true, changed: [], removed: body.ids.map(id => ({ source: body.source, id })), failed: [], left: [] }); }
        if (a === 'across') { const it = find(body.source, body.id); it.trashed = true; const copy = item({ ...view(it), source: body.to_source, item_id: body.to_source === 'od' ? 'OD!91' : 'gdNew91', parent_id: body.to ?? null, trashed: false }); server.items.push(copy); return ok({ ok: true, changed: [view(copy)], removed: [{ source: body.source, id: body.id }], kept_original: false }); }
      }
      return ok({ ok: false, error: 'action_invalid' }, 400);
    }
    // S48-45 ⑦ 같은 파일 보기: 색인 표를 해시로 읽는다.
    if (p === '/rest/v1/app_cloud_items' && method === 'GET') {
      server.calls.push({ what: 'app_cloud_items', search: u.search, auth: req.headers().authorization || '' });
      const hash = (u.searchParams.get('hash') || '').replace(/^eq\./, ''), src = (u.searchParams.get('source') || '').replace(/^eq\./, '');
      return ok(server.items.filter(i => i.hash === hash && i.source === src && !i.trashed).map(i => ({ source: i.source, item_id: i.item_id, parent_id: i.parent_id, name: i.name, hash: i.hash, trashed: false })));
    }
    // FOLDER-순서·색 ③-2: 폴더 색·순서 표(app_folder_prefs) 읽기와 서버 함수 app_folder_prefs_apply(owner만, 표를 직접 쓰지 않음) 흉내.
    if (p === '/rest/v1/app_folder_prefs' && method === 'GET') {
      server.prefReads++;
      if (prefsMissing) return ok({ code: 'PGRST205', message: 'Could not find the table public.app_folder_prefs' }, 404);
      return ok(server.prefs);
    }
    if (p === '/rest/v1/rpc/app_folder_prefs_apply' && method === 'POST') {
      server.prefCalls.push({ source: body.p_source, items: body.p_items, ws: body.p_workspace_id });
      if (prefsFail || prefsMissing) return ok({ code: prefsMissing ? 'PGRST202' : '42501', message: prefsMissing ? 'function not found' : 'FOLDER_PREFS_FORBIDDEN' }, prefsMissing ? 404 : 403);
      for (const it of body.p_items) {
        let row = server.prefs.find(x => x.source === body.p_source && x.folder_key === it.k);
        if (!row) server.prefs.push(row = { source: body.p_source, folder_key: it.k, color: null, sort_order: null });
        if ('c' in it) row.color = it.c;
        if ('o' in it) row.sort_order = it.o;
      }
      return ok({ ok: true, count: body.p_items.length });
    }
    if (!p.startsWith('/rest/v1/rpc/app_cloud_')) return route.fallback();
    const name = p.slice('/rest/v1/rpc/'.length);
    server.calls.push({ what: name, body, auth: req.headers().authorization || '' });
    const live = server.items.filter(i => !i.trashed);
    if (name === 'app_cloud_list') {
      return ok(live.filter(i => i.source === body.p_source && (i.parent_id ?? null) === (body.p_parent_id ?? null))
        .map(i => ({ ...view(i), child_count: i.is_folder ? live.filter(c => c.source === i.source && c.parent_id === i.item_id && !c.is_folder).length : null })));
    }
    if (name === 'app_cloud_trail') return ok(trail(body.p_source, body.p_item_id));
    if (name === 'app_cloud_find' || name === 'app_cloud_find_in') {
      if (server.findFail) return ok({ code: '57014', message: server.findFail.message }, server.findFail.status);
      // 새 함수는 켜진 출처(p_sources)만 서버가 거른다. 옛 함수는 두 출처 모두.
      const srcs = name === 'app_cloud_find_in' ? body.p_sources : ['od', 'gd'];
      if (!Array.isArray(srcs) || srcs.some(x => !['od', 'gd'].includes(x))) return ok({ code: '22023', message: 'CLOUD_FIND_BAD_SOURCES' }, 400);
      const live = server.items.filter(i => !i.trashed && srcs.includes(i.source));
      let rows;
      if (body.p_query) {
        const words = body.p_query.split(' ');
        rows = live.filter(i => words.every(w => `${i.name} ${i._text || ''}`.includes(w))).map(i => ({ ...view(i), match_in: words.every(w => i.name.includes(w)) ? 'name' : 'text' }));
      } else if (body.p_shelf === 'starred') rows = live.filter(i => i.starred).map(view);
      else rows = live.filter(i => !i.is_folder).sort((a, b) => body.p_shelf === 'big' ? b.size_bytes - a.size_bytes : b.modified_at.localeCompare(a.modified_at)).map(view);
      return ok(rows.map(r => ({ ...r, match_in: r.match_in ?? null, folder_path: pathOf(r) })));
    }
    return ok([]);
  });
  return server;
}

export async function start(page, width, opts) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  await servePagesCors(page); // 한글 엔진 파일(GitHub Pages처럼 다른 출처 허용 머리)
  const server = await filesServer(page, opts);
  return { errors, server };
}
// S50-33: 폴드 펼침도 기본은 한 칸(PC처럼 나무 + 목록). 서버에 '두 칸'이 기억돼 있으면 한 칸 시험은 [한 칸 보기]를 눌러 끈 뒤 시작한다({two: true}면 그대로).
// S51-18: 폴드 칸은 600px부터(공용 판정 screen-width.mjs). 앱 틀(하단바 메뉴)은 지금처럼 760px 이하라 600~760은 폰 틀 메뉴로 연다.
export async function openFiles(page, width, { two = false } = {}) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '파일' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '파일', exact: true }).click();
  await expect(page.locator('#filesView')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('files');
  if (width >= 600 && width < 1200 && !two) {
    const btn = page.locator('#filesRoot [data-fx-two]');
    await expect(btn).toBeVisible();
    // 서버에 '끔'이 이미 기억돼 있으면(다시 열기) 그대로 둔다.
    if ((await btn.textContent())?.trim() === '한 칸 보기') await btn.click();
    await expect(btn).toHaveText('두 칸 보기');
    await expect(page.locator('#filesRoot [data-fx-pane-i="1"]')).toHaveCount(0);
  }
}

// FOLDER-나무새기준 ②(S51-12): 폰 나무는 그 자리 펼치기라 폴더 목록(그 폴더만)은 두 손가락 벌리기로 연다. id 없음 = 저장소 맨 위(상자 머리 위에서).
export async function phoneFolder(page, source, id = '') {
  const { pinch } = await import('./pinch.mjs');
  const tree = page.locator('#filesRoot [data-fx-tree]');
  await pinch(page, id ? tree.locator(`[data-fx-fold="${source}:${id}"]`) : tree.locator(`[data-fx-box="${source}"] .ft-box-head`), 'out');
  await expect(tree).toBeHidden();
  // '그 폴더만' 상자는 0.2초 동안 줄 자리에서 올라온다(folder-focus-motion.js riseFromRow). 움직이는 동안 누르면 줄이 아직
  // 제자리에 오지 않아 위 머리줄(폴더 이름)이 눌릴 수 있으므로, 움직임이 끝난(다 그려진) 뒤 돌려준다(STAB-main화면시험흔들림).
  await page.waitForFunction(() => document.getAnimations().every(a => a.constructor !== Animation || a.playState !== 'running'));
}
// 나무에서 그 폴더 목록 열기: 넓은 화면은 나무 줄 이름을 누르고, 폰(상자 나무)은 두 손가락 벌리기.
export async function treeGo(page, source, id = '') {
  const go = page.locator(`#filesRoot [data-fx-tree] [data-fx-go="${source}"][data-fx-id="${id}"]`).first();
  const box = page.locator(`#filesRoot [data-fx-tree] [data-fx-box="${source}"]`);
  // 두 손가락 길은 폰 한 칸 나무(data-fx-pane="tree")에서만. 넓은 화면도 저장소 상자가 먼저 보이므로(나무 줄은 폴더를 읽은 뒤)
  // 상자만 보고 고르면 줄이 그려지기 전에 넓은 화면에서 벌리기를 해 나무가 그대로 남는다(STAB-폰파일판).
  const phoneTree = () => page.locator('#filesRoot[data-fx-pane="tree"]').count().then(n => n > 0);
  await expect.poll(async () => (await go.isVisible()) || ((await box.isVisible()) && (await phoneTree()))).toBe(true);
  if (await go.isVisible()) await go.click(); else await phoneFolder(page, source, id);
}
