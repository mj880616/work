// 저녁 알림 'Now' 한 줄(OUTSIDE-글상세·관심환류 PR ②, 설계 docs/design/outside-statements.md 12.1절·news-clipping.md 13절):
// 사회운동 새 글과 뉴스 새 기사를 한 줄로 합친다 — '새 성명 n · 새 기사 n'(0인 쪽은 빼고, 둘 다 0이면 줄 없음). 뉴스 줄을 따로 두지 않는다.
// '새' 기준 시각: Now 메뉴가 하나로 합쳐졌으므로 사회운동 화면을 마지막에 본 시각(app_outside_seen.seen_at) 하나를 두 쪽에 함께 쓴다.
//   본 기록이 없으면 지난 24시간, 오래 안 봤어도 지난 7일까지만 센다. 관심 없음(hidden_at)으로 뺀 기사는 세지 않는다.
// 읽기는 service role이며 migration 20261031230000_outside_statements·20261101233000_news_clipping이 service_role에 준 select 안에서
//   건수만 센다(id만 읽고 제목·본문은 읽지 않음). 저녁 묶음 보내기(설계 phone-notifications N5)가 이 한 곳을 부른다.
export const NOW_COUNT_CAP = 100;
const DAY_MS = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Get = (path: string) => Promise<Record<string, unknown>[]>;
export type NowCounts = { statements: number; articles: number };

const shown = (n: number) => (n >= NOW_COUNT_CAP ? `${NOW_COUNT_CAP - 1}+` : String(n));

export function nowEveningLine(c: NowCounts): string | null {
  const parts: string[] = [];
  if (c.statements > 0) parts.push(`새 성명 ${shown(c.statements)}`);
  if (c.articles > 0) parts.push(`새 기사 ${shown(c.articles)}`);
  return parts.length ? parts.join(" · ") : null;
}

export function nowSince(seenAt: unknown, nowMs: number): string {
  const floor = nowMs - 7 * DAY_MS;
  const seen = typeof seenAt === "string" ? Date.parse(seenAt) : NaN;
  const base = Number.isFinite(seen) ? Math.max(seen, floor) : nowMs - DAY_MS;
  return new Date(base).toISOString();
}

export async function nowEveningCounts(get: Get, workspaceId: string, nowMs: number): Promise<NowCounts> {
  if (!UUID.test(workspaceId)) return { statements: 0, articles: 0 };
  const seen = await get(`app_outside_seen?workspace_id=eq.${workspaceId}&select=seen_at&limit=1`);
  const since = encodeURIComponent(nowSince(seen[0]?.seen_at, nowMs));
  const posts = await get(`app_outside_posts?workspace_id=eq.${workspaceId}&fetched_at=gt.${since}&select=id&limit=${NOW_COUNT_CAP}`);
  const news = await get(`app_news_items?workspace_id=eq.${workspaceId}&created_at=gt.${since}&hidden_at=is.null&select=id&limit=${NOW_COUNT_CAP}`);
  return { statements: posts.length, articles: news.length };
}
