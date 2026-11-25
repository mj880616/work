// S70-55 I-3 AI-비용보기 5단계(설계 docs/design/ai-cost-view.md 2.2절 (가)·5절): 기능 키를 한 곳에 둔다.
// - AI(OpenAI)를 부르는 서버 함수는 부른 뒤 기능별 표 app_ai_usage_events에 1행을 넣는다(migration 20261125235000).
//   칸은 작업공간·서울 날짜·기능 키·공급자·모델 이름·호출 수·입력/출력 토큰뿐이다. 재료 글·AI 답·파일 이름·사람 id는 넣지 않는다.
// - 하루 한도(app_ai_daily_usage.requests)·월 상한 판정은 지금 표 그대로다. 이 표는 옆에 더하기만 한다(읽어서 막지 않는다).
// - 기록 실패는 AI 응답을 막지 않는다: recordAiUsageEvent는 던지지 않고 고정 코드만 로그에 남긴다.
// - Node 시험·Deno 배포 양쪽에서 읽으므로 .mjs로 둔다(ai-prices.mjs·ai-daily-usage.mjs와 같은 방식).

// DB check 제약(app_ai_usage_events_feature_check)과 같은 목록. 바꾸려면 migration을 먼저 한다.
export const AI_FEATURES = Object.freeze([
  'ledger', 'journal', 'ask', 'todo', 'library', 'meeting', 'org', 'telegram', 'call_judge', 'news', 'other',
]);
const FEATURE_SET = new Set(AI_FEATURES);

// ai-assist 쓰임(kind) → 기능 키. ai-assist의 DAILY_LIMITS 키 전부가 여기 있어야 한다(시험이 대조).
export const AI_ASSIST_KIND_FEATURES = Object.freeze({
  link_summary: 'journal',        // 기록 연결 요약
  todo_radar: 'todo',             // 챙길 것 찾기
  todo_recheck: 'todo',
  todo_rules_review: 'todo',
  ledger_candidates: 'ledger',    // 원장 후보·자동 기록·고치기
  ledger_auto: 'ledger',
  ledger_fix: 'ledger',
  library_fill: 'library',        // 자료실 채우기·정리·파일 이름
  library_sort: 'library',
  file_name: 'library',
  schedule_titles: 'journal',     // 주간보고 일정 제목 다듬기
  weekly_draft: 'journal',        // 주간 정리
  weekly_review: 'journal',
  journal_draft: 'journal',       // 업무일지 초안·기억할 일·한 줄 정리·오늘 한 일 가르기
  journal_memorable: 'journal',
  record_one_line: 'journal',
  work_scope: 'journal',
  call_refill: 'call_judge',      // 업무로 옮긴 통화 다시 채우기
  org_people_brief: 'org',        // 조직 사람 요약·사업영역 추천
  area_suggest: 'org',
  ask_web2: 'ask',                // Web2에 묻기
  now_detail: 'news',             // Now 글 상세·관심 주제
  now_interests: 'news',
  overlap_check: 'other',         // 기록 겹침 확인
  hwp_convert: 'other',           // 서식 변환
  note_title: 'other',            // 노트 제목
  share_draft: 'other',           // 공유 페이지 초안
  home_day_picks: 'other',        // 홈 하루 채우기
});

// ai-assist 밖에서 AI를 부르는 곳 → 기능 키. 시험이 각 파일의 실제 호출과 대조한다.
export const FUNCTION_FEATURES = Object.freeze({
  'library-files': 'library',        // 자료실 파일 읽기·제목·한 줄
  'document-ai-index': 'library',    // 자료 색인(요약·핵심어)
  'document-actions': 'library',     // 자료 브리핑
  'meeting-ai-ingest': 'meeting',    // 회의 자료 넣기
  'meeting-ai-draft': 'meeting',     // 회의 요약 초안
  'meeting-transcribe': 'meeting',   // 녹음 뒤 서버 요약(OpenAI). Gemini 전사는 app_ai_external_usage에 따로 남는다.
  'page-ai-draft': 'other',          // (옛) 팀 AI 초안
  'collector-feed': 'telegram',      // 텔레그램 판정·가족 기록 뽑기
  'news-feed': 'news',               // 뉴스 요약·제목·[번역]
  'outside-feed': 'news',            // 사회운동 [번역]·찾는 말 넓히기
});

/** @param {unknown} kind */
export function featureOfKind(kind) {
  const f = typeof kind === 'string' && Object.hasOwn(AI_ASSIST_KIND_FEATURES, kind) ? AI_ASSIST_KIND_FEATURES[kind] : null;
  return f ?? 'other';
}

/** @param {unknown} feature */
export const isAiFeature = feature => typeof feature === 'string' && FEATURE_SET.has(feature);

const MODEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// 모델 이름은 DB 형식 검사와 같은 모양만. 앞의 'models/'는 떼고, 맞지 않으면 'unknown'(행은 남긴다).
/** @param {unknown} v */
export function usageModelName(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/^models\//, '') : '';
  return MODEL.test(s) ? s : 'unknown';
}

/** @param {unknown} v @param {number} max */
const count = (v, max) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? Math.min(v, max) : 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 서울 날짜(ai-daily-usage.mjs seoulDay와 같음). @param {number} nowMs */
export function usageDay(nowMs) {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 넣을 행 하나. 칸은 표의 넣기 grant 칸과 같다(내용 칸 없음). 모양이 틀리면 null(넣지 않음).
/**
 * @param {{ workspaceId?: unknown, day?: unknown, nowMs?: number, feature?: unknown, model?: unknown, calls?: unknown, input?: unknown, output?: unknown }} o
 */
export function aiUsageEventRow({ workspaceId, day, nowMs = Date.now(), feature, model, calls = 1, input = 0, output = 0 } = {}) {
  const ws = typeof workspaceId === 'string' ? workspaceId.toLowerCase() : '';
  if (!UUID.test(ws)) return null;
  const d = typeof day === 'string' && DAY.test(day) ? day : usageDay(nowMs);
  const row = {
    workspace_id: ws,
    day: d,
    feature: isAiFeature(feature) ? feature : 'other',
    provider: 'openai',
    model: usageModelName(model),
    calls: count(calls, 10000),
    input_tokens: count(input, 1000000000),
    output_tokens: count(output, 1000000000),
  };
  if (row.calls < 1 && !row.input_tokens && !row.output_tokens) return null;
  return row;
}

// insert: 행 하나를 넣는 함수(실패면 던지거나 false). 어떤 경우에도 던지지 않는다.
// 돌려주는 값: 'recorded' | 'skipped'(넣을 것 없음) | 'failed'.
/**
 * @param {(row: Record<string, unknown>) => Promise<unknown>} insert
 * @param {Parameters<typeof aiUsageEventRow>[0]} opts
 * @param {(code: string, detail?: Record<string, unknown>) => void} [log]
 * @returns {Promise<'recorded'|'skipped'|'failed'>}
 */
export async function recordAiUsageEvent(insert, opts, log = (code) => console.warn(code)) {
  try {
    if (opts && !isAiFeature(opts.feature)) { try { log('ai_feature_missing'); } catch { /* 알림 실패도 막지 않는다 */ } }
    const row = aiUsageEventRow(opts);
    if (!row) return 'skipped';
    const r = await insert(row);
    if (r === false) throw new Error('insert_failed');
    return 'recorded';
  } catch {
    try { log('ai_usage_event_failed', { feature: isAiFeature(opts?.feature) ? opts.feature : 'other' }); } catch { /* 위와 같음 */ }
    return 'failed';
  }
}

// supabase-js 서버 키 클라이언트(service_role: 넣기 칸 grant만, 읽기 없음)로 넣는 함수. select를 붙이지 않는다(return=minimal).
/** @param {any} admin */
export const insertWithClient = admin => async row => {
  const { error } = await admin.from('app_ai_usage_events').insert(row);
  if (error) throw error;
};
