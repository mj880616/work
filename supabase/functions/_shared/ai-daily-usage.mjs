// S48-15(빠짐31): AI를 부르는 서버 함수가 쓴 토큰을 홈 'AI 사용량' 줄이 세는 기존 표(app_ai_daily_usage)에 더한다.
// - 표·칸·행 단위(작업공간·사용자·날짜 1행)는 ai-assist(writeUsage)·page-ai-draft·meeting-ai-draft와 같다. 새 표·새 권한 없음.
// - 날짜는 ai-assist와 같은 서울 날짜(seoulDays)라 같은 날 같은 행에 더해진다. advanced_requests는 그대로 둔다.
// - 숫자만 넣는다(재료 글·AI 답·파일 이름은 넣지 않음). 기록 실패는 본 작업을 막지 않는다: 던지지 않고 오류 코드만 남긴다.
// - Node 시험·Deno 배포 양쪽에서 읽으므로 .mjs로 둔다(ai-prices.mjs와 같은 방식).

/** @param {unknown} v */
const tok = v => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** @param {number} nowMs */
export function seoulDay(nowMs) {
  const d = new Date(nowMs + 9 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// 요청 하나 동안 부른 AI 횟수·토큰을 모은다. raw는 OpenAI Responses 응답(usage.input_tokens·output_tokens).
/** @returns {{ add: (raw: unknown) => void, readonly calls: number, readonly input: number, readonly output: number }} */
export function createAiUsageMeter() {
  const m = { calls: 0, input: 0, output: 0 };
  return {
    add(raw) {
      const u = raw && typeof raw === 'object' && raw.usage && typeof raw.usage === 'object' ? raw.usage : {};
      m.calls += 1;
      m.input += tok(u.input_tokens);
      m.output += tok(u.output_tokens);
    },
    get calls() { return m.calls; },
    get input() { return m.input; },
    get output() { return m.output; },
  };
}

// admin: service role supabase-js 클라이언트. 작업공간·사용자는 서버가 DB·로그인에서 확인한 값만 넘긴다(화면 값 불신).
// 돌려주는 값: 'skipped'(부른 AI 없음) | 'recorded' | 'failed'. 어떤 경우에도 던지지 않는다.
/**
 * @param {any} admin
 * @param {{ workspaceId?: string, userId?: string, meter?: { calls: number, input: number, output: number }, nowMs?: number, log?: (msg: string, detail?: Record<string, unknown>) => void }} [opts]
 * @returns {Promise<'skipped'|'recorded'|'failed'>}
 */
export async function recordAiDailyUsage(admin, { workspaceId, userId, meter, nowMs = Date.now(), log = console.warn } = {}) {
  try {
    if (!meter || meter.calls < 1) return 'skipped';
    if (!workspaceId || !userId) throw Object.assign(new Error('missing_owner'), { code: 'missing_owner' });
    const day = seoulDay(nowMs);
    const { data: old, error: readError } = await admin.from('app_ai_daily_usage')
      .select('requests,advanced_requests,input_tokens,output_tokens')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('day', day).maybeSingle();
    if (readError) throw readError;
    const { error } = await admin.from('app_ai_daily_usage').upsert({
      workspace_id: workspaceId,
      user_id: userId,
      day,
      requests: tok(old?.requests) + meter.calls,
      advanced_requests: tok(old?.advanced_requests),
      input_tokens: tok(old?.input_tokens) + meter.input,
      output_tokens: tok(old?.output_tokens) + meter.output,
      updated_at: new Date(nowMs).toISOString(),
    }, { onConflict: 'workspace_id,user_id,day' });
    if (error) throw error;
    return 'recorded';
  } catch (e) {
    try { log('ai usage not recorded', { code: String(e?.code || 'unknown').slice(0, 40) }); } catch { /* 기록 실패 알림도 본 작업을 막지 않는다 */ }
    return 'failed';
  }
}
