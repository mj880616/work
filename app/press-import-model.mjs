// PRESS-자료실편입 2단계(docs/design/press-into-library.md §3.2): 옛 성명·보도자료를 자료실로 1회 복사하는 계획과 원본 변환.
// DOM이 없는 순수 함수라 Node 단위 시험에서도 그대로 돈다. 실행(받기·올리기·잠금)은 press-import.js가 한다.
// 이 파일과 press-import.js는 1회용이다. Contract PR(§5)에서 가져오기 단추와 함께 지운다.

export const PRESS_CATEGORY = '성명·보도자료';
export const RAW_BASE = 'https://raw.githubusercontent.com/mj880616/work/main/';
export const PRESS_CSS_PATH = 'press/press-archive.css';
export const LOGO_PATH = 'assets/kptu-logo.svg';
// AI가 다시 쓰지 않게 'user'로 잠그는 칸(명진 결정 Q4 ①: 프로젝트·담당조직 연결은 열어 둔다).
export const LOCK_FIELDS = Object.freeze(['title', 'category', 'source', 'document_date']);

// 목록(archive.json) 밖 옛 글 2건(결정 Q3 ①). 안내 페이지 statement-checklist는 성명이 아니라 넣지 않는다.
// 값은 각 글 머리(제목·발표일·발행)를 그대로 옮겼다.
export const OFF_LIST = Object.freeze([
  Object.freeze({folder: '2024-09-04-public-rail-policy-conference', path: 'press/2024-09-04-public-rail-policy-conference/', date: '2024-09-04', type_label: '취재요청',
    title: '기후위기, 불평등 해결하는 공공 철도·지하철 정책대회 취재요청', publisher: '공공 철도-지하철 정책대회 준비위원회'}),
  Object.freeze({folder: '2024-09-09-public-rail-policy-conference', path: 'press/2024-09-09-public-rail-policy-conference/', date: '2024-09-09', type_label: '보도자료',
    title: '‘공공 철도 지하철 정책대회’ 성황리 개최', publisher: '공공 철도-지하철 정책대회 준비위원회'}),
]);

// 글 폴더 안 첨부 4개(HWP 2 · PDF 2). 같은 제목·날짜·발행·종류의 자료 행이 되고 파일 이름은 원본 그대로다.
export const ATTACHMENTS = Object.freeze({
  '2026-09-28-private-rail-forum-request': '260928_취재요청_민자철도_20년_공공성과_안전성은_어디에_국회토론회_개최_배포.hwp',
  '2026-09-29-private-rail-forum-followup': '260929_사후보도자료_민자철도_20년_공공성과_안전성은_어디에_국회토론회_배포_.hwp',
  '2026-10-01-two-person-team-forum-request': '261001_취재요청_2인1조_법제화_토론회_.pdf',
  '2026-10-02-two-person-team-forum-followup': '261002_사후보도자료_2인1조법제화토론회_.pdf',
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

export function mimeOf(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return ext === 'pdf' ? 'application/pdf' : ext === 'hwp' ? 'application/x-hwp' : ext === 'html' ? 'text/html' : 'application/octet-stream';
}

// archive.json의 href('./<폴더>/' 또는 '../workforce/…/')를 저장소 경로('press/<폴더>/')로. 저장소 밖·이상한 모양은 null.
export function repoPathOf(href) {
  const value = String(href || '');
  let parts;
  if (value.startsWith('./')) parts = ['press', ...value.slice(2).split('/')];
  else if (value.startsWith('../')) parts = value.slice(3).split('/');
  else return null;
  parts = parts.filter(Boolean);
  if (parts.length < 2 || !parts.every(p => SAFE_SEGMENT.test(p) && p !== '.' && p !== '..')) return null;
  return parts.join('/') + '/';
}

// 겹침 판정 열쇠 file_name. press/ 글은 폴더 이름(이미 날짜로 시작)을, 그 밖은 '<날짜>-<경로를 이은 이름>'을 쓴다.
export function pageFileName(path, date) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts[0] === 'press' && parts.length === 2) return `${parts[1]}.html`;
  return `${date}-${parts.join('-')}.html`;
}

// 목록 42건 + 목록 밖 2건 + 첨부 4개 = 48 줄. 한 줄: {key, kind:'page'|'attachment', path, fileName, mime, fields}.
// 모양이 맞지 않는 목록 줄은 errors에 넣고 뺀다(계획을 멈추지 않는다).
export function buildPlan(archive) {
  const items = Array.isArray(archive?.items) ? archive.items : [];
  const posts = [], errors = [];
  for (const item of items) {
    const path = repoPathOf(item?.href), date = String(item?.date || ''), title = clean(item?.title);
    if (!path || !DATE.test(date) || !title) { errors.push(clean(item?.title) || String(item?.href || '?')); continue; }
    posts.push({path, date, title, type_label: clean(item?.type_label), publisher: clean(item?.publisher)});
  }
  for (const extra of OFF_LIST) if (!posts.some(p => p.path === extra.path)) posts.push({...extra});
  const plan = [];
  for (const post of posts) {
    const fields = {title: post.title, category: PRESS_CATEGORY, source: post.publisher, document_date: post.date, tags: post.type_label ? [post.type_label] : []};
    const fileName = pageFileName(post.path, post.date);
    plan.push({key: fileName, kind: 'page', path: post.path + 'index.html', fileName, mime: 'text/html', fields});
    const parts = post.path.split('/').filter(Boolean);
    const attachment = parts[0] === 'press' && parts.length === 2 ? ATTACHMENTS[parts[1]] : null;
    if (attachment) plan.push({key: attachment, kind: 'attachment', path: post.path + attachment, fileName: attachment, mime: mimeOf(attachment), fields: {...fields, tags: [...fields.tags]}});
  }
  return {plan, errors};
}

// GitHub raw 주소. 한글 파일 이름은 조각마다 인코딩한다.
export const rawUrl = path => RAW_BASE + String(path).split('/').map(encodeURIComponent).join('/');

// 이미 자료실에 있는 file_name(어느 종류든)은 건너뛴다. 다시 눌러도 빠진 것만 올린다.
export function splitByExisting(plan, documents) {
  const have = new Set((documents || []).map(d => String(d?.file_name || '')).filter(Boolean));
  return {todo: plan.filter(row => !have.has(row.fileName)), skipped: plan.filter(row => have.has(row.fileName))};
}

// 잠금이 덜 된 가져온 자료(올린 뒤 잠금 저장만 실패한 경우). field_origin 칸이 없는 DB(적용 전)이면 잠그지 않는다.
export function needsLock(doc) {
  if (!doc || !Object.hasOwn(doc, 'field_origin')) return false;
  const origin = doc.field_origin && typeof doc.field_origin === 'object' && !Array.isArray(doc.field_origin) ? doc.field_origin : {};
  return LOCK_FIELDS.some(field => origin[field] !== 'user');
}

export const svgDataUrl = svg => 'data:image/svg+xml,' + encodeURIComponent(String(svg ?? ''));

// 원본 변환은 셋뿐(§3.2-4).
// 1) press-archive.css 링크 → 같은 내용의 <style>(칸막이 CSP가 외부 요청을 막기 때문).
// 2) 로고 assets/kptu-logo.svg → data: 이미지(CSP가 data: 이미지는 허용).
// 3) rich-copy.js 복사 단추 스크립트는 그대로 둔다(칸막이에서 돌지 않음을 받아들임).
// 그 밖의 글자는 한 글자도 바꾸지 않는다. 바뀐 개수는 changes로 돌려준다(시험·진행 기록용).
const CSS_LINK = /<link\b[^>]*\bhref\s*=\s*["'][^"']*press-archive\.css["'][^>]*>/gi;
const LOGO_SRC = /(\bsrc\s*=\s*)(["'])[^"']*assets\/kptu-logo\.svg\2/gi;
export function transformPressHtml(html, {css = '', logoSvg = ''} = {}) {
  let cssLinks = 0, logos = 0;
  const safeCss = String(css).replace(/<\/style/gi, '<\\/style');
  let out = String(html ?? '').replace(CSS_LINK, () => { cssLinks++; return `<style>${safeCss}</style>`; });
  out = out.replace(LOGO_SRC, (_m, attr, quote) => { logos++; return `${attr}${quote}${svgDataUrl(logoSvg)}${quote}`; });
  return {html: out, changes: {cssLinks, logos}};
}
