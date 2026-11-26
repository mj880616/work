// S69 NEWS-제목늘읽기(사용자 11/24 "제목은 읽어놔야 누르든 말든하지"): 서버가 제목을 못 읽은 줄의 마지막 대신 제목.
// 주소 경로에서 사람이 읽을 만한 조각 하나(예: /2026/11/24/minimum-wage-talks-stall → 'minimum wage talks stall', /뉴스/임금-협상 → '임금 협상').
// 숫자·기사 번호·흔한 경로 이름(article·view·news 등)뿐이면 ''. 순수 계산(DOM·네트워크 없음) — 뉴스 줄(news-clipping-model.mjs)과 읽을 거리 줄(reading-model.mjs)이 함께 쓴다.
const PLAIN = /^(news|article|articles|articleview|view|read|story|stories|post|posts|amp|m|www|ko|kr|en|html|index|detail|newsview|board|bbs|p|a|v|c|s|section|category|opinion|politics|economy|society|national|world|culture|all)$/i;
const EXT = /\.(html?|php|aspx?|jsp|do|cms)$/i;
const MAX = 80;

function piece(seg) {
  let t;
  try { t = decodeURIComponent(seg); } catch { t = seg; }
  t = t.replace(EXT, '').replace(/[-_+.~]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || PLAIN.test(t.replace(/\s+/g, ''))) return '';
  const hangul = (t.match(/[가-힣]/g) || []).length;
  const words = t.split(' ').filter(w => /[A-Za-z]{2,}/.test(w) && !/\d/.test(w));
  // 한글 두 자 이상, 또는 숫자 없는 영어 낱말 세 개 이상일 때만(기사 번호·해시·날짜 조각은 제목이 아니다).
  if (hangul >= 2 || words.length >= 3) return [...t].slice(0, MAX).join('').trim();
  return '';
}

export function urlTitle(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol)) return '';
  const segs = u.pathname.split('/').filter(Boolean).reverse();
  for (const s of segs) { const t = piece(s); if (t) return t; }
  return '';
}
