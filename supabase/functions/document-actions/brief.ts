// BRIEF-브리핑룸 PR ②(설계 docs/design/brief-room.md 4절): document-actions의 브리핑 입구 두 개.
//   brief-start {document_id}  → 그 자료의 브리핑 작업(진행 중이면 그것) + 응답 뒤 서버가 이어서 만듦.
//   brief-step  {brief_id}     → 멈춘 작업(lease가 비었거나 지남)을 이어 달라는 부름. 화면이 열려 있을 때·스스로 잇기가 부른다.
// - 자료는 **로그인 토큰으로** 읽는다(owner RLS: 남의 작업공간 자료는 0행 → 404). 화면이 보낸 작업공간 값은 받지 않는다.
// - 작업 표(app_document_briefs) 쓰기는 서버 키의 정한 칸만(20261113220000). 화면은 그 표를 owner RLS로 읽기만 한다.
// - AI는 기존 공용 길(_shared/openai-responses.ts, 열쇠 WEB2_OPENAI_API_KEY), 부르기 전마다 사람별 월 한도(_shared/ai-user-cap.mjs,
//   DB 함수 app_workspace_ai_month — 서버가 확인한 작업공간만) 판정. 사용 기록은 기존 표 app_ai_daily_usage(로그인 토큰, ai-assist와 같은 행 모양).
// - 응답·로그에 글 내용·AI 답을 싣지 않는다(상태·고정 코드만).
import { aiConfigFrom, callOpenAi, estimateKrw, outputText, tokenCount } from "../_shared/openai-responses.ts";
import { AI_REASONING_TOKEN_HEADROOM, AI_TONE_RULE, DEFAULT_AI_MODEL, DEFAULT_PRICE_IN_KRW_PER_MTOK, DEFAULT_PRICE_OUT_KRW_PER_MTOK } from "../_shared/ai-model.ts";
import { checkAiUserCap } from "../_shared/ai-user-cap.mjs";
import { BRIEF_PUBLIC, BriefError, createBriefRunner, isUuid } from "./brief-run.mjs";
import type { DocumentFile, TextResult } from "../_shared/document-text.ts";

type Db = (path: string, opts?: { method?: string; body?: unknown; prefer?: string }) => Promise<any>;
export type BriefDeps = {
  userId: string;
  db: Db;                       // 서버 키 REST
  userDb: Db;                   // 로그인 토큰 REST(owner RLS)
  extractFor: (workspaceId: string) => (file: DocumentFile, opts: { raw: boolean }) => Promise<TextResult>;
  env: (name: string) => string | undefined;
  waitUntil: (p: Promise<unknown>) => void;
  continueLater: (briefId: string) => Promise<void>;   // 같은 함수에 brief-step 한 번(로그인 토큰)
  now?: () => number;
  log?: (code: string) => void;
};

const OPENAI_URL = "https://api.openai.com/v1/responses";
const SEOUL_MS = 9 * 60 * 60 * 1000;
const seoulDay = (ms: number) => new Date(ms + SEOUL_MS).toISOString().slice(0, 10);

export async function briefAction(action: "brief-start" | "brief-step", body: Record<string, unknown>, deps: BriefDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((code: string) => console.error(JSON.stringify({ fn: "document-actions", code })));
  const config = aiConfigFrom(deps.env, { keyName: "WEB2_OPENAI_API_KEY", model: DEFAULT_AI_MODEL, priceIn: DEFAULT_PRICE_IN_KRW_PER_MTOK, priceOut: DEFAULT_PRICE_OUT_KRW_PER_MTOK });
  if (!config) throw new BriefError(503, "ai_not_configured");

  // 자료 행: 로그인 토큰으로(owner RLS). 브리핑 작업에서 오면 작업의 자료 id로 다시 읽는다.
  async function readDoc(id: string) {
    const rows = await deps.userDb(`app_documents?id=eq.${encodeURIComponent(id)}&select=id,workspace_id,title,file_id,file_name,mime_type,file_size&limit=1`);
    const doc = Array.isArray(rows) ? rows[0] : null;
    if (!doc || String(doc.id).toLowerCase() !== id || !isUuid(String(doc.workspace_id).toLowerCase())) throw new BriefError(404, "not_found");
    doc.workspace_id = String(doc.workspace_id).toLowerCase();
    return doc;
  }

  let workspaceId = "";
  const capCheck = () => checkAiUserCap(async () => {
    return await deps.db("rpc/app_workspace_ai_month", { method: "POST", body: { p_workspace: workspaceId } });
  }, { price: config.price });

  // 사용 기록: 오늘 행(작업공간·사용자·날짜)에 더한다(ai-assist writeUsage와 같은 행 모양, 숫자만).
  async function addUsage(input: number, output: number) {
    const day = seoulDay(now());
    const rows = await deps.userDb(`app_ai_daily_usage?workspace_id=eq.${workspaceId}&user_id=eq.${deps.userId}&day=eq.${day}&select=requests,input_tokens,output_tokens&limit=1`);
    const t = Array.isArray(rows) ? rows[0] : null;
    await deps.userDb("app_ai_daily_usage?on_conflict=workspace_id,user_id,day", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { workspace_id: workspaceId, user_id: deps.userId, day, requests: tokenCount(t?.requests) + 1,
        input_tokens: tokenCount(t?.input_tokens) + input, output_tokens: tokenCount(t?.output_tokens) + output, updated_at: new Date(now()).toISOString() },
    });
  }

  const ai = async (name: string, instructions: string, input: string, schema: object, maxTokens: number) => {
    const result = await callOpenAi({ doFetch: fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: (c) => log(c) }, config.key, {
      model: config.model, store: false, max_output_tokens: maxTokens + AI_REASONING_TOKEN_HEADROOM,
      // 말투는 공용 규칙 한 줄(AI-말투통일). 옮긴 원문 인용은 규칙이 말하듯 원문 그대로 둔다(서버가 원문 대조).
      input: [{ role: "developer", content: `${instructions}\n${AI_TONE_RULE}` }, { role: "user", content: input }],
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }, { url: OPENAI_URL, timeoutMs: 90000, retryDelayMs: 1000, maxResponseBytes: 256 * 1024 });
    const used = result.ok ? result.usage : result.charged ? { input: Math.ceil(input.length * 1.2), output: maxTokens } : { input: 0, output: 0 };
    if (used.input || used.output) { try { await addUsage(used.input, used.output); } catch { log("brief_usage_record_failed"); } }
    if (!result.ok) return { ok: false as const, code: result.code };
    return { ok: true as const, text: outputText(result.raw), model: config.model, krw: estimateKrw(used.input, used.output, config.price) };
  };

  const scope = async () => {
    const rows = await deps.userDb(`app_suborganizations?workspace_id=eq.${workspaceId}&select=name,active&order=name.asc&limit=200`);
    const orgs = (Array.isArray(rows) ? rows : []).filter((r) => r?.active !== false && typeof r?.name === "string").map((r) => r.name);
    return { orgs, areas: [] as string[] };
  };

  const runnerFor = (doc: Record<string, any>) => createBriefRunner({
    db: deps.db,
    extract: (d: Record<string, any>) => deps.extractFor(doc.workspace_id)({
      fileId: typeof d.file_id === "string" ? d.file_id : "", name: String(d.file_name || ""), mime: String(d.mime_type || ""),
      size: Number.isSafeInteger(d.file_size) ? d.file_size : null,
    }, { raw: true }),
    ai, capCheck, scope, now, log,
  });

  // 응답 뒤 이어 돌리고, 못 끝냈으면(시간) 같은 함수에 한 번 더 부탁한다.
  const kick = (runner: ReturnType<typeof createBriefRunner>, id: string, doc: Record<string, any>) => deps.waitUntil((async () => {
    const out = await runner.run(id, doc).catch(() => "failed");
    if (out === "paused") await deps.continueLater(id).catch(() => log("brief_continue_failed"));
  })());

  if (action === "brief-start") {
    const id = String(body?.document_id ?? "").toLowerCase();
    if (!isUuid(id)) throw new BriefError(400, "invalid_request");
    const doc = await readDoc(id);
    workspaceId = doc.workspace_id;
    const runner = runnerFor(doc);
    const { row } = await runner.start({ userId: deps.userId, doc });
    kick(runner, row.id, doc);
    return { ok: true, brief: row };
  }

  const briefId = String(body?.brief_id ?? "").toLowerCase();
  if (!isUuid(briefId)) throw new BriefError(400, "invalid_request");
  // 작업 행도 로그인 토큰으로 읽는다(owner 읽기 정책): 남의 작업이면 0행.
  const mine = await deps.userDb(`app_document_briefs?id=eq.${briefId}&select=${BRIEF_PUBLIC}&limit=1`);
  const row = Array.isArray(mine) ? mine[0] : null;
  if (!row || String(row.id).toLowerCase() !== briefId) throw new BriefError(404, "not_found");
  if (row.status === "done" || row.status === "failed") return { ok: true, brief: row };
  const doc = await readDoc(String(row.document_id).toLowerCase());
  workspaceId = doc.workspace_id;
  kick(runnerFor(doc), briefId, doc);
  return { ok: true, brief: row };
}
