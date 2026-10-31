// 주소 개편 ② E1(docs/design/domain-move.md 2절): Web2 '아스날' 화면(?view=arsenal)의 순수 규칙. DOM·네트워크 없음.
// 자료는 app/arsenal/matches.js(window.ARSENAL_MATCHES, 새 경기는 PR로 추가하고 arsenal-archive-check가 형식을 본다).

export const ALL = 'all';
// 대회 이름은 자료 원문(영문) 그대로 거르고, 화면에는 짧은 한국어로 보인다. 모르는 대회는 원문.
const COMPETITION_TEXT = Object.freeze({
  'Premier League': '프리미어리그',
  'UEFA Champions League': '챔피언스리그',
  'Carabao Cup': '카라바오컵',
  'FA Cup': 'FA컵'
});
export const competitionText = name => COMPETITION_TEXT[name] || String(name ?? '');
export const RESULT_KIND = Object.freeze({'승': 'win', '무': 'draw', '패': 'loss'});

const text = value => typeof value === 'string' ? value : '';
const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];

// S46-26: 예정 경기 줄("upcoming":true, 점수·득점·통계 없음, date·kickoff는 한국 시간). 기록·통계·목록 개수에서는 빼고
// 목록 위에 작은 '예정' 줄로만 보인다(형식: docs/superpowers/specs/2026-09-20-arsenal-2025-26-archive-design.md '예정 경기 줄').
export const isUpcoming = m => !!m && typeof m === 'object' && m.upcoming === true;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// 한국 날짜(YYYY-MM-DD). 지난 날짜 예정 줄은 화면에서 뺀다(자료 검사는 실패로 막는다).
export const kstToday = (now = new Date()) => new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

// 자료 → 화면이 쓰는 경기 목록(최신 날짜가 위). 형식이 틀린 줄과 예정 줄은 버린다(검사가 막지만 화면이 깨지지 않게).
export function normalizeMatches(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m => m && typeof m === 'object' && !isUpcoming(m) && typeof m.id === 'string' && DAY_RE.test(m.date || ''))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

// 예정 줄: 오늘(한국) 이후만, 가까운 경기가 위.
export function upcomingOf(raw, today = kstToday()) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m => isUpcoming(m) && typeof m.id === 'string' && DAY_RE.test(m.date || '') && m.date >= today)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.kickoff || '').localeCompare(String(b.kickoff || '')) || a.id.localeCompare(b.id));
}
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
// '예정 · 11.2.(월) 01:30 원정 리버풀'. 시각이 확정되지 않았으면 날짜만.
export function upcomingText(m) {
  const [y, mo, d] = String(m?.date || '').split('-').map(Number);
  const day = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const time = HHMM_RE.test(m?.kickoff || '') ? ` ${m.kickoff}` : '';
  const home = m?.home === '아스날';
  return `예정 · ${mo}.${d}.(${day})${time} ${home ? '홈' : '원정'} ${text(home ? m.away : m.home)}`;
}

export const seasonsOf = matches => [...new Set(matches.map(m => text(m.season)).filter(Boolean))].sort().reverse();
export const competitionsOf = matches => [...new Set(matches.map(m => text(m.competition)).filter(Boolean))].sort();

// 시즌·대회·검색어(상대·제목·부제·라운드, 대소문자 무시)로 거른다.
export function filterMatches(matches, {season = ALL, competition = ALL, query = ''} = {}) {
  const q = String(query || '').trim().toLowerCase();
  return matches.filter(m => (season === ALL || m.season === season)
    && (competition === ALL || m.competition === competition)
    && (!q || [m.home, m.away, m.title, m.subtitle, m.round].map(text).join(' ').toLowerCase().includes(q)));
}

// 거른 목록에서 보일 경기: 고른 경기가 남아 있으면 그것, 아니면 맨 위(없으면 null).
export function pickMatch(filtered, id) {
  return filtered.find(m => m.id === id) || filtered[0] || null;
}

export const dateText = iso => String(iso || '').replaceAll('-', '.');
export const scoreText = m => `${Number(m.homeScore) || 0}–${Number(m.awayScore) || 0}`;

// 한쪽 득점 줄: 분·득점자·종류(자책골·페널티킥)·도움('—'은 공식 기록상 도움 없음).
export function goalsOf(match, side) {
  return (Array.isArray(match?.goals) ? match.goals : []).filter(g => g && g.side === side).map(g => ({
    minute: text(g.minute),
    scorer: text(g.scorer),
    kind: g.type === 'own-goal' ? '자책골' : g.type === 'penalty' ? '페널티킥' : '',
    type: g.type === 'own-goal' || g.type === 'penalty' ? g.type : 'goal',
    assist: text(g.assist) || '—'
  }));
}

// 리뷰 묶음 넷. 첫 묶음만 펼쳐 두고 나머지는 접는다(한 문장 요약 = 판정은 늘 보임).
export function reviewSections(match) {
  return [
    {key: 'summary', title: '경기 한눈에 보기', items: list(match?.summary)},
    {key: 'decisive', title: '승패를 가른 핵심', items: list(match?.decisive || match?.whyLost)},
    {key: 'arteta', title: '아르테타의 선택', items: list(match?.arteta)},
    {key: 'nextWatch', title: '다음 경기에서 볼 것', items: list(match?.nextWatch)}
  ].filter(section => section.items.length);
}

export const STAT_ROWS = Object.freeze([
  ['possession', '점유율'], ['shots', '슈팅'], ['xg', 'xG'], ['bigChances', '빅찬스']
]);
export const statsOf = match => STAT_ROWS.map(([key, label]) => ({label, value: text(String(match?.stats?.[key] ?? '')) || '—'}));

// 바깥 링크는 https 주소만(그 밖은 버림).
export function safeUrl(value) {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}
export const linksOf = items => (Array.isArray(items) ? items : [])
  .map(item => ({label: text(item?.label), url: safeUrl(item?.url)}))
  .filter(item => item.url);
