// MCP-Claude읽기 M-2 (L3 Edge 공통 검사, 설계 docs/design/mcp-claude-read.md 4.3절).
//
// Supabase Auth의 OAuth 2.1 서버가 바깥 앱(예: Claude 커넥터)에 내주는 "위임 열쇠"는 일반 로그인 열쇠와 같은
// role·aud(authenticated)를 갖고, 추가로 `client_id` 칸이 붙는다. /auth/v1/user·auth.getUser는 이 열쇠도 사용자 본인으로
// 통과시키므로, 서버 키로 표·Drive·Google을 다루는 Web2 Edge 함수가 위임 열쇠를 본인으로 믿고 쓰기까지 할 수 있다.
// 그래서 사용자 확인을 하는 모든 Web2 Edge 함수는, Auth가 확인한 바로 그 열쇠에 `client_id`가 있으면 401로 거절한다.
//
// 판정 규칙:
// - 이 검사는 Auth가 열쇠를 이미 확인한 "뒤"에만 부른다. 서명 검사는 Auth의 몫이고, 여기서는 같은 열쇠의 내용(payload)만 본다.
// - payload에 비어 있지 않은 `client_id`가 있으면 위임 열쇠 → 거절.
// - `client_id`가 없거나 비어 있으면 일반 로그인 열쇠 → 지금과 똑같이 통과(동작 변화 없음).
// - JWT 모양이 아니어서 payload를 읽을 수 없는 값은 Auth가 이미 사용자로 받아 주지 않으므로(운영에서 생길 수 없음) 통과시키고,
//   판정은 Auth 결과에 맡긴다. 반대로 payload를 읽을 수 있는데 `client_id`가 문자열이 아닌 값(숫자·객체 등)이면 거절한다.
// - 화면·요청이 보낸 다른 값(헤더·본문)은 보지 않는다. 열쇠 하나만 본다.
// 읽생기(rtw_*) 함수는 이 저장소에 없고 이 검사를 쓰지 않는다.

export const DELEGATED_TOKEN_CODE = "DELEGATED_TOKEN";

export class DelegatedTokenError extends Error {
  status = 401;
  code = DELEGATED_TOKEN_CODE;
  constructor() {
    super("이 열쇠로는 쓸 수 없습니다.");
    this.name = "DelegatedTokenError";
  }
}

function bearerless(token) {
  return typeof token === "string" ? token.replace(/^Bearer\s+/i, "").trim() : "";
}

function decodePayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return json && typeof json === "object" && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

// 열쇠(또는 "Bearer <열쇠>" 머리글 값)가 OAuth 위임 열쇠인지. true면 거절해야 한다.
export function isDelegatedToken(token) {
  const payload = decodePayload(bearerless(token));
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, "client_id")) return false;
  const clientId = payload.client_id;
  if (clientId === null || clientId === undefined) return false;
  if (typeof clientId !== "string") return true;
  return clientId.trim() !== "";
}

// 위임 열쇠면 DelegatedTokenError(401)를 던진다. 각 함수가 자기 401 응답 모양을 지켜야 하면 isDelegatedToken을 쓴다.
export function rejectDelegatedToken(token) {
  if (isDelegatedToken(token)) throw new DelegatedTokenError();
}
