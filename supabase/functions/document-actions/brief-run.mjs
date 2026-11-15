// BRIEF-브리핑룸 PR ②(설계 docs/design/brief-room.md 4절): 브리핑 작업 한 건을 단계별로 이어 가는 곳. 입출력은 deps로만 받는다(Node 시험 가능).
// 단계: read(Drive 끝까지 읽기) → chunk(조각마다 AI 메모) → merge(합치기 AI + 서버 검사) → done.
// - 한 번 부를 때 budgetMs 안에서만 돌고, 못 끝내면 lease를 풀고 다음 부름(스스로 잇기 또는 화면)이 잇는다.
// - 작업 잡기는 lease + attempts 값 비교로 한 곳만(같은 작업을 두 실행이 동시에 돌리지 않음). 저장도 attempts가 내 값일 때만.
// - AI를 부르기 전마다 사람별 월 한도 판정(deps.capCheck). 한도면 failed/ai_monthly_cap. 판정을 못 읽으면 멈춤(닫힌 쪽).
// - 글 내용·AI 답은 로그에 남기지 않는다(고정 코드만). 끝나면 source_text를 비운다.
import {
  BRIEF_CHUNK_CHARS, BRIEF_MAX_CHUNKS, BRIEF_MIN_TEXT, CHUNK_INSTRUCTIONS, MERGE_INSTRUCTIONS,
  chunkInput, chunkWithPages, foldForMatch, mergeInput, pageStarts, pagesKnown, parseChunkNote,
  quoteCandidates, scopeText, splitChunks, stepTotal, tidyBriefText, verifyBrief,
} from '../_shared/brief-room.mjs';

export const BRIEF_TABLE = 'app_document_briefs';
export const BRIEF_LEASE_MS = 3 * 60 * 1000;
export const BRIEF_BUDGET_MS = 140 * 1000;
export const BRIEF_MAX_ATTEMPTS = 40;
export const BRIEF_STALE_MS = 30 * 1000;          // 화면이 '멈춘 작업'으로 보고 이어 달라고 하는 기준(lease가 지난 뒤)
export const CHUNK_MAX_TOKENS = 1400;
export const MERGE_MAX_TOKENS = 2000;
// 화면·응답에 돌려주는 칸(글 원문·조각 메모는 빼고).
export const BRIEF_PUBLIC = 'id,document_id,status,stage,step_no,step_total,page_count,brief,error_code,created_at,updated_at,finished_at,lease_until';

const S = { type: 'string' };
const LINES = { type: 'array', items: S };
export const CHUNK_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['lead', 'touches', 'todos', 'conflicts', 'quotes'],
  properties: {
    lead: S, touches: LINES, todos: LINES, conflicts: LINES,
    quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'heading', 'why'], properties: { text: S, heading: S, why: S } } },
  },
});
export const MERGE_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['lead', 'touches', 'todos', 'conflicts', 'quotes'],
  properties: {
    lead: S, touches: LINES, todos: LINES, conflicts: LINES,
    quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: S, why: S } } },
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isUuid = v => typeof v === 'string' && UUID.test(v);

export class BriefError extends Error {
  constructor(status, code) { super(code); this.name = 'BriefError'; this.status = status; this.code = code; }
}

/**
 * @param {{
 *  db: (path: string, opts?: {method?: string, body?: unknown, prefer?: string}) => Promise<any>,
 *  extract: (doc: Record<string, unknown>) => Promise<{text: string, reason: string}>,
 *  ai: (name: string, instructions: string, input: string, schema: object, maxTokens: number) => Promise<{ok: true, text: string|null, model: string} | {ok: false, code: string}>,
 *  capCheck: () => Promise<{ok: boolean, status?: number, code?: string}>,
 *  scope: () => Promise<{orgs: string[], areas: string[]}>,
 *  now: () => number,
 *  log?: (code: string) => void,
 *  budgetMs?: number,
 * }} deps
 */
export function createBriefRunner(deps) {
  const log = deps.log ?? (() => {});
  const iso = ms => new Date(ms).toISOString();
  const enc = encodeURIComponent;

  async function readRow(id) {
    const rows = await deps.db(`${BRIEF_TABLE}?id=eq.${enc(id)}&select=${BRIEF_PUBLIC},workspace_id,attempts,source_text,parts&limit=1`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  /** 진행 중 작업이 있으면 그것, 없으면 새 작업(queued). doc은 서버가 owner를 확인한 자료 행. */
  async function start({ userId, doc }) {
    const running = await deps.db(`${BRIEF_TABLE}?document_id=eq.${enc(doc.id)}&workspace_id=eq.${enc(doc.workspace_id)}&status=in.(queued,running)&select=${BRIEF_PUBLIC}&limit=1`);
    if (Array.isArray(running) && running[0]) return { row: running[0], created: false };
    const cap = await deps.capCheck();
    if (!cap.ok) throw new BriefError(cap.status ?? 503, cap.code ?? 'usage_unavailable');
    const made = await deps.db(`${BRIEF_TABLE}?select=${BRIEF_PUBLIC}`, {
      method: 'POST', prefer: 'return=representation',
      body: {
        workspace_id: doc.workspace_id, created_by: userId, document_id: doc.id,
        source_file_id: typeof doc.file_id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(doc.file_id) ? doc.file_id : null,
        status: 'queued', stage: 'read', step_no: 0, step_total: 0,
      },
    });
    if (!Array.isArray(made) || !made[0]) throw new BriefError(503, 'brief_unavailable');
    return { row: made[0], created: true };
  }

  /** lease가 비었거나 지난 작업만 잡는다. 잡으면 attempts 새 값, 못 잡으면 null. */
  async function claim(id, nowMs) {
    const row = await readRow(id);
    if (!row || row.status === 'done' || row.status === 'failed') return null;
    if (row.lease_until && Date.parse(row.lease_until) > nowMs) return null;
    const attempts = Number(row.attempts) || 0;
    if (attempts >= BRIEF_MAX_ATTEMPTS) {
      await deps.db(`${BRIEF_TABLE}?id=eq.${enc(id)}&attempts=eq.${attempts}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'failed', error_code: 'too_many_tries', source_text: null, lease_until: null, finished_at: iso(nowMs), updated_at: iso(nowMs) },
      });
      return null;
    }
    const got = await deps.db(`${BRIEF_TABLE}?id=eq.${enc(id)}&attempts=eq.${attempts}&status=in.(queued,running)&select=id`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { status: 'running', attempts: attempts + 1, lease_until: iso(nowMs + BRIEF_LEASE_MS), started_at: row.started_at ?? iso(nowMs), updated_at: iso(nowMs) },
    });
    if (!Array.isArray(got) || got.length !== 1) return null;
    return { ...row, status: 'running', attempts: attempts + 1 };
  }

  async function save(row, patch) {
    const nowMs = deps.now();
    const done = patch.status === 'done' || patch.status === 'failed';
    const body = { ...patch, updated_at: iso(nowMs), lease_until: done ? null : iso(nowMs + BRIEF_LEASE_MS) };
    if (done) { body.finished_at = iso(nowMs); body.source_text = null; }
    const r = await deps.db(`${BRIEF_TABLE}?id=eq.${enc(row.id)}&attempts=eq.${row.attempts}&select=id`, { method: 'PATCH', prefer: 'return=representation', body });
    if (!Array.isArray(r) || r.length !== 1) throw new BriefError(409, 'brief_taken'); // 다른 실행이 잡았다 → 이 실행은 멈춘다
    Object.assign(row, patch);
  }
  const fail = (row, code) => save(row, { status: 'failed', stage: row.stage, error_code: code });

  async function stepRead(row, doc) {
    const got = await deps.extract(doc);
    const { text } = tidyBriefText(got?.text ?? '');
    if (text.replace(/\s/g, '').length < BRIEF_MIN_TEXT) {
      await fail(row, got?.reason === 'too_large' ? 'too_large' : got?.reason === 'unsupported' ? 'unsupported' : 'no_text');
      return false;
    }
    const starts = pageStarts(text);
    const chunks = splitChunks(text, BRIEF_CHUNK_CHARS);
    if (chunks.length > BRIEF_MAX_CHUNKS) { await fail(row, 'too_large'); return false; }
    await save(row, { stage: 'chunk', source_text: text, page_count: pagesKnown(starts) ? starts.length : null, step_no: 0, step_total: stepTotal(chunks.length), parts: [] });
    return true;
  }

  // AI 한 번. 한도·호출 실패는 코드로 돌려준다(던지지 않음).
  async function callAi(name, instructions, input, schema, maxTokens) {
    const cap = await deps.capCheck();
    if (!cap.ok) return { ok: false, code: cap.code === 'ai_monthly_cap' ? 'ai_monthly_cap' : 'usage_unavailable', final: cap.code === 'ai_monthly_cap' };
    const r = await deps.ai(name, instructions, input, schema, maxTokens);
    return r.ok ? r : { ok: false, code: r.code, final: r.code === 'ai_not_configured' };
  }

  async function stepChunk(row, scope, title) {
    const text = row.source_text;
    if (typeof text !== 'string' || !text) { await fail(row, 'no_text'); return 'stop'; }
    const starts = pageStarts(text);
    const chunks = splitChunks(text, BRIEF_CHUNK_CHARS);
    const i = row.step_no;
    if (i >= chunks.length) { await save(row, { stage: 'merge' }); return 'next'; }
    const chunk = chunks[i];
    const body = chunkWithPages(text, starts, chunk);
    const r = await callAi('brief_chunk', CHUNK_INSTRUCTIONS, chunkInput({ index: i, total: chunks.length, title, scope, body }), CHUNK_SCHEMA, CHUNK_MAX_TOKENS);
    if (!r.ok) { if (r.final) { await fail(row, r.code); return 'stop'; } log(`brief_${r.code}`); return 'pause'; }
    const note = parseChunkNote(r.text ?? '', { folded: foldForMatch(text), starts, chunk })
      ?? { lead: '', touches: [], todos: [], conflicts: [], quotes: [], skipped: true };
    if (note.skipped) log('brief_chunk_bad_answer');
    const parts = Array.isArray(row.parts) ? [...row.parts, note] : [note];
    await save(row, { parts, step_no: i + 1, model: r.model ?? row.model ?? null });
    return 'next';
  }

  async function stepMerge(row, scope, title) {
    const notes = (Array.isArray(row.parts) ? row.parts : []).filter(n => n && !n.skipped);
    if (!notes.length) { await fail(row, 'ai_bad_answer'); return 'stop'; }
    const candidates = quoteCandidates(notes);
    const r = await callAi('brief_merge', MERGE_INSTRUCTIONS, mergeInput({ title, scope, notes, candidates }), MERGE_SCHEMA, MERGE_MAX_TOKENS);
    if (!r.ok) { if (r.final) { await fail(row, r.code); return 'stop'; } log(`brief_${r.code}`); return 'pause'; }
    const brief = verifyBrief(r.text ?? '', { candidates, pageCount: row.page_count ?? null });
    if (!brief) { await fail(row, 'ai_bad_answer'); return 'stop'; }
    await save(row, { status: 'done', stage: 'done', brief, step_no: row.step_total, model: r.model ?? row.model ?? null });
    return 'stop';
  }

  /**
   * 잡을 수 있으면 잡아서 budget 안에서 이어 간다. 돌려주는 값: 'done' | 'failed' | 'paused' | 'busy'(다른 실행이 잡고 있음).
   * @param {string} id
   * @param {Record<string, unknown>} doc 서버가 다시 읽은 자료 행(owner 확인됨)
   */
  async function run(id, doc) {
    const started = deps.now();
    const row = await claim(id, started);
    if (!row) return 'busy';
    const title = String(doc.title || doc.file_name || '').trim();
    let scopeLine = null;
    const scope = async () => scopeLine ??= (async () => { try { const s = await deps.scope(); return scopeText(s.orgs, s.areas); } catch { return scopeText(); } })();
    try {
      while (deps.now() - started < (deps.budgetMs ?? BRIEF_BUDGET_MS)) {
        let step;
        if (row.stage === 'read') step = (await stepRead(row, doc)) ? 'next' : 'stop';
        else if (row.stage === 'chunk') step = await stepChunk(row, await scope(), title);
        else if (row.stage === 'merge') step = await stepMerge(row, await scope(), title);
        else step = 'stop';
        if (step === 'stop') break;
        if (step === 'pause') break;
      }
    } catch (e) {
      if (e instanceof BriefError && e.code === 'brief_taken') return 'busy';
      log('brief_step_failed');
      try { await fail(row, 'brief_failed'); } catch { /* 다음 부름이 attempts로 정리 */ }
      return 'failed';
    }
    if (row.status === 'done' || row.status === 'failed') return row.status;
    // 못 끝냄: lease를 바로 풀어 다음 부름이 잡게 한다.
    try {
      await deps.db(`${BRIEF_TABLE}?id=eq.${enc(row.id)}&attempts=eq.${row.attempts}`, { method: 'PATCH', prefer: 'return=minimal', body: { lease_until: null, updated_at: iso(deps.now()) } });
    } catch { log('brief_release_failed'); }
    return 'paused';
  }

  return { start, run, claim, readRow };
}

/** 화면이 '멈춘 작업'으로 볼지(진행 중인데 lease가 비었거나 지났고 마지막 저장이 오래됨). */
export function isStalled(row, nowMs) {
  if (!row || (row.status !== 'queued' && row.status !== 'running')) return false;
  const lease = row.lease_until ? Date.parse(row.lease_until) : 0;
  const upd = row.updated_at ? Date.parse(row.updated_at) : 0;
  return lease <= nowMs && nowMs - upd >= BRIEF_STALE_MS;
}
