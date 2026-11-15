// 뉴스 기사 주소 규칙(순수 함수, 바깥 호출 없음) — news-feed(_shared/feed-fetch.ts가 다시 내보냄)와
// collector-feed ?action=scrap(채널 기사 입구)이 같은 규칙을 쓰도록 한 곳에 둔다(복사 금지). 동작은 옮기기 전과 같다.

// 채널 기사 원문 주소 규칙(열린 주소 — 매체가 정해져 있지 않으므로 허용 호스트 대신 막는 규칙).
// https만, 기본 포트만, 사용자 정보 없음, 호스트가 IP 숫자·localhost·단일 이름·내부 이름·Supabase가 아님, 2000자 안쪽.
// DNS가 내부 주소로 풀리는 경우는 코드로 막지 못한다(Edge 런타임의 사설망 차단에 기댐 — PR 남은 위험에 적음).
const BLOCKED_SUFFIX = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".arpa",
  ".supabase.co", ".supabase.in", ".supabase.net", ".supabase.com"];
export function openArticleUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host === "localhost") return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[") || host.includes(":")) return null; // IPv4 숫자·IPv6
  if (/^0x|^\d+$/.test(host.split(".")[0]) && /^[\dx.a-f]+$/i.test(host)) return null;  // 16진·정수 IP 꼴
  if (BLOCKED_SUFFIX.some((s) => host === s.slice(1) || host.endsWith(s))) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null; // 국제 도메인은 URL이 punycode로 바꿔 둠
  return u;
}

// 겹침 판정용 주소: 스킴·www 떼기, 추적 값(utm_*·fbclid·gclid 등) 떼기, 조각(#) 떼기, 끝 '/' 떼기.
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|ref|ref_src|cmpid|from)$/i;
export function cleanArticleUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const out = u.href;
  return /^https?:\/\/\S+$/.test(out) && out.length <= 2000 ? out : null;
}
export function urlKey(cleaned: string): string {
  const u = new URL(cleaned);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}${u.search}`.slice(0, 2000) || host;
}
