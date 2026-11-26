// NEWS-운영자만(S63-03, 사용자 11/16 "사용자 외 나머지 가입자에게는 메뉴 숨기고. 어느정도 완성도 높아지면 그 때 열자").
// News(언론 기사·사회운동 글)를 채우는 서버 일(예약 수집·키워드 표시·제목 번역·화면 입구의 바로 읽기·본문 열기·번역·비슷한 말·공유 보관)은
// 운영자 기능 키 'outside'가 있는 작업공간 몫만 한다. 화면 메뉴 숨김(app/menu-model.mjs)만으로 끝내지 않는다(AGENTS.md 3·5절).
// 판정은 서버 허용 표(app_operator_features, SQL로만 씀)를 service role 함수 app_operator_feature_workspace('outside')로 읽는다 —
// 그 키를 가진 작업공간이 정확히 한 곳일 때만 그 id, 아니면(없음·여러 곳·읽기 실패) null = 아무 작업공간도 안 함(닫힌 쪽으로 실패).
// 다시 모두에게 열 때는 이 파일과 부르는 곳(news-feed·outside-feed·phone-push 저녁 알림)을 함께 고친다. 이미 모인 글·보관·밑줄은 지우지 않는다.
import { readBoundedJson } from "./bounded-json.mjs";

export const NEWS_FEATURE = "outside";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function newsWorkspace(sb: string, key: string, doFetch: typeof fetch): Promise<string | null> {
  try {
    const r = await doFetch(`${sb}/rest/v1/rpc/app_operator_feature_workspace`, {
      method: "POST", signal: AbortSignal.timeout(10000), body: JSON.stringify({ p_feature: NEWS_FEATURE }),
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    });
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    const v = await readBoundedJson(r, { maxBytes: 4096 });
    return typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;
  } catch { return null; }
}
export const newsAllowed = (workspaceId: unknown, newsWs: string | null): boolean =>
  !!newsWs && typeof workspaceId === "string" && workspaceId.toLowerCase() === newsWs;
// rpc 답(app_operator_feature_workspace)을 작업공간 id로(없거나 모양이 다르면 null).
export const newsWorkspaceOf = (v: unknown): string | null => typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;
