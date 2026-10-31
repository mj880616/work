// FCM HTTP v1 보내기(APP-폰알림, 설계 docs/design/phone-notifications.md 4절). phone-push가 쓰고, 회의 요약 완료(N6)도 이 모듈을 쓴다.
//
// - 서비스 계정 비밀값 FCM_SERVICE_ACCOUNT_JSON(명진이 Supabase 대시보드에 직접 넣음)에서 project_id·client_email·private_key만 읽는다.
//   비밀값 안의 token_uri 같은 주소는 쓰지 않는다(보내는 곳은 아래 두 고정 주소뿐).
// - 서비스 계정으로 RS256 JWT를 만들어 구글 OAuth 토큰(firebase.messaging 범위)을 받고, 데이터 메시지만 보낸다(알림 모양은 앱이 그림).
// - 싣는 것: 종류·짧은 제목(40자)·누르면 열 앱 안 경로. 본문·첨부·연락처는 싣지 않는다.
// - 오류·로그에는 단계 코드만. 토큰·키·제목은 남기지 않는다.
import { readBoundedJson } from "./bounded-json.mjs";

export const FCM_SECRET_NAME = "FCM_SERVICE_ACCOUNT_JSON";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const FCM_SEND_BASE = "https://fcm.googleapis.com/v1/projects/";
export const TITLE_MAX = 40;
const TIMEOUT_MS = 10000;

export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string };
export type FcmMessage = { kind: string; title: string; open: string; urgent: boolean };
export type FcmResult = "sent" | "unregistered" | "failed";

const PROJECT = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.iam\.gserviceaccount\.com$/;
export const KIND = /^[a-z_]{2,20}$/;
// 앱 안 경로만(앱의 ShellRules가 다시 판정한다). 바깥 주소·스킴·역슬래시 없음.
export const OPEN_PATH = /^\/work\/app\/(\?[A-Za-z0-9_=&%.-]{0,200})?$/;

// 비밀값이 없거나 모양이 틀리면 null(보내기 기능 꺼짐).
export function readFcmConfig(raw: string | undefined): FcmConfig | null {
  if (!raw || raw.length > 16384) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.type !== "service_account") return null;
  const projectId = o.project_id, clientEmail = o.client_email, privateKey = o.private_key;
  if (typeof projectId !== "string" || !PROJECT.test(projectId)) return null;
  if (typeof clientEmail !== "string" || !EMAIL.test(clientEmail)) return null;
  if (typeof privateKey !== "string" || !/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\s*$/.test(privateKey)) return null;
  return { projectId, clientEmail, privateKey };
}

export function cutTitle(title: string) {
  const one = title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const chars = [...one];
  return chars.length <= TITLE_MAX ? one : chars.slice(0, TITLE_MAX - 1).join("") + "…";
}

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const textB64url = (s: string) => b64url(new TextEncoder().encode(s));

async function signedAssertion(cfg: FcmConfig, nowMs: number) {
  const pem = cfg.privateKey.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  let der: ArrayBuffer;
  try { der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)).buffer as ArrayBuffer; } catch { return null; }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch { return null; }
  const iat = Math.floor(nowMs / 1000);
  const head = textB64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = textB64url(JSON.stringify({ iss: cfg.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }));
  const input = `${head}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

export type FcmSender = { send: (token: string, msg: FcmMessage) => Promise<FcmResult> };

// 한 번 실행 안에서 OAuth 토큰을 한 번만 받는다. 토큰을 못 받으면 모든 보내기가 failed.
export function makeFcmSender(cfg: FcmConfig, doFetch: typeof fetch, now: () => number): FcmSender {
  let access: Promise<string | null> | null = null;
  async function token(): Promise<string | null> {
    const assertion = await signedAssertion(cfg, now());
    if (!assertion) return null;
    let r: Response;
    try {
      r = await doFetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch { return null; }
    let v: Record<string, unknown> | null = null;
    try { v = await readBoundedJson(r, { maxBytes: 64 * 1024 }) as Record<string, unknown>; } catch { v = null; }
    if (!r.ok || typeof v?.access_token !== "string" || !/^[A-Za-z0-9._~+/=-]{10,4096}$/.test(v.access_token)) return null;
    return v.access_token;
  }
  return {
    async send(deviceToken, msg) {
      if (!KIND.test(msg.kind) || !OPEN_PATH.test(msg.open)) return "failed";
      access ??= token();
      const bearer = await access;
      if (!bearer) return "failed";
      const body = {
        message: {
          token: deviceToken,
          data: { kind: msg.kind, title: cutTitle(msg.title), open: msg.open },
          android: { priority: msg.urgent ? "high" : "normal", ttl: "86400s" },
        },
      };
      let r: Response;
      try {
        r = await doFetch(`${FCM_SEND_BASE}${cfg.projectId}/messages:send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch { return "failed"; }
      if (r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } return "sent"; }
      // 등록이 풀린 기기: 404 또는 errorCode UNREGISTERED.
      let v: unknown = null;
      try { v = await readBoundedJson(r, { maxBytes: 64 * 1024 }); } catch { v = null; }
      const text = JSON.stringify(v ?? "");
      if (r.status === 404 || /"errorCode":"UNREGISTERED"/.test(text)) return "unregistered";
      return "failed";
    },
  };
}
