// 공용 글 한 줄 찾기(NEWS-모두에게열기 E3, 설계 docs/design/news-for-all.md 13·14절).
// 화면은 공용 글 id(app_news_articles.id·app_outside_articles.id)를 보낸다. 옮기는 동안 옛 줄 id(app_news_items·app_outside_posts)가 와도 된다:
//   1) 지도 함수(app_news_article_of·app_outside_article_of — 자기 작업공간 옛 id만, 자기가 읽을 수 있는 글만 돌려줌)로 바꾸고,
//   2) 지도에 없으면 받은 id를 공용 글 id로 본다(운영자 옛 줄 id = 공용 id, 옮긴 뒤 새 글은 처음부터 공용 id).
//   3) 공용 글은 그 사람 로그인(사용자 열쇠 = RLS)으로 읽는다 — 공용 표 읽기 정책(private.app_news_reader_ok: 로그인 + owner 행 1개 +
//      가입 차단 명단 아님, 채널 스크랩 줄은 운영자만)을 서버 열쇠로 흉내 내지 않고 그대로 거친다. 못 읽으면(없는 글·막힌 사람) 없는 글과 같다.
// 이 파일은 읽기만 한다(쓰기 없음). 부르는 쪽이 사용자 로그인 읽기(rest·rpc)를 넘긴다. 서버 열쇠·비밀값을 읽지 않는다.
import { readBoundedJson } from "./bounded-json.mjs";

export type SharedKind = "news" | "outside";
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHARED_TABLES = Object.freeze({
  news: { table: "app_news_articles", map: "app_news_article_of" },
  outside: { table: "app_outside_articles", map: "app_outside_article_of" },
} as const);

export type UserReads = {
  get: (path: string) => Promise<Row[]>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

// 사용자 로그인 그대로 읽기(apikey = anon, Authorization = 그 사람 로그인). 실패는 Error("user_read_failed") 하나.
export function makeUserReads(sb: string, anonKey: string, jwt: string, doFetch: typeof fetch): UserReads {
  const call = async (path: string, init: RequestInit): Promise<unknown> => {
    if (!anonKey) throw new Error("user_read_failed");
    let r: Response;
    try {
      r = await doFetch(`${sb}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, Accept: "application/json", "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
    } catch { throw new Error("user_read_failed"); }
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Error("user_read_failed"); }
    try { return await readBoundedJson(r, { maxBytes: 1024 * 1024 }); } catch { throw new Error("user_read_failed"); }
  };
  return {
    get: async (path) => { const v = await call(path, { method: "GET" }); if (!Array.isArray(v)) throw new Error("user_read_failed"); return v as Row[]; },
    rpc: (name, args) => call(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) }),
  };
}

// 받은 id → 공용 글 id. 지도 함수가 자기 작업공간 옛 id만 바꿔 준다(남의 옛 id·없는 id는 그대로 = 공용 id로 봄).
export async function sharedIdOf(kind: SharedKind, rpc: UserReads["rpc"], id: string): Promise<string> {
  const want = id.toLowerCase();
  const rows = await rpc(SHARED_TABLES[kind].map, { p_old: [want] });
  if (!Array.isArray(rows)) throw new Error("user_read_failed");
  const hit = (rows as Row[]).find((r) => typeof r?.old_id === "string" && r.old_id.toLowerCase() === want);
  return hit && typeof hit.article_id === "string" && UUID.test(hit.article_id) ? hit.article_id.toLowerCase() : want;
}

// 받은 id(공용 id 또는 자기 옛 id) → 그 사람이 읽을 수 있는 공용 글 한 줄(select 칸), 없으면 null. id 모양이 틀리면 null.
export async function readSharedArticle(kind: SharedKind, reads: UserReads, id: unknown, select: string): Promise<Row | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const artId = await sharedIdOf(kind, reads.rpc, id);
  const rows = await reads.get(`${SHARED_TABLES[kind].table}?id=eq.${artId}&select=${select}&limit=2`);
  const row = rows.length === 1 ? rows[0] : null;
  return row && typeof row.id === "string" && row.id.toLowerCase() === artId ? row : null;
}
