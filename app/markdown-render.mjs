// MD-표시: 마크다운 글을 안전한 HTML 문자열로 바꾸는 순수 함수. DOM이 없어 Node 단위 검사에서도 그대로 돈다.
// 브라우저 쪽 불러오기·정화·Mermaid·KaTeX 적용은 markdown-view.js가 맡는다(바구니 메모, 이후 일지·노트에서 재사용).
// 안전 원칙: 글 속 HTML은 글자로만 보이고(html:false), 링크는 http·https·mailto만 새 창 + noopener로 열며,
// 이미지는 불러오지 않고 링크로만 보인다(연달아 나오면 칩 하나로 접고, 누를 때만 불러온다). 수식·도식은 자리표시(원문 글자)만 두고 나중에 바꾼다.

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function safeHref(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (!LINK_PROTOCOLS.has(url.protocol)) return null;
  if (url.protocol !== 'mailto:' && !url.hostname) return null;
  return url.href;
}

function mathBlock(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const line = state.src.slice(start, state.eMarks[startLine]).trimEnd();
  const open = line.startsWith('$$') ? '$$' : line.startsWith('\\[') ? '\\[' : null;
  if (!open) return false;
  const close = open === '$$' ? '$$' : '\\]';
  const first = line.slice(open.length);
  let content = null, last = startLine;
  if (first.includes(close)) {
    // One line: $$x$$. Anything after the closing mark belongs to inline math, not to a block.
    if (!first.endsWith(close) || first.indexOf(close) !== first.length - close.length) return false;
    content = first.slice(0, -close.length);
  } else {
    const parts = [first];
    for (let next = startLine + 1; next < endLine; next++) {
      const from = state.bMarks[next] + state.tShift[next], to = state.eMarks[next];
      if (from < to && state.sCount[next] < state.blkIndent) break;
      const text = state.src.slice(from, to).trimEnd();
      if (text.endsWith(close)) { parts.push(text.slice(0, -close.length)); content = parts.join('\n'); last = next; break; }
      parts.push(text);
    }
  }
  if (content === null || !content.trim()) return false;
  if (silent) return true;
  const token = state.push('math_block', 'div', 0);
  token.block = true; token.content = content.trim(); token.markup = open; token.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}

function mathInline(state, silent) {
  const src = state.src, start = state.pos, max = state.posMax;
  let open, close, display = false;
  if (src.startsWith('\\(', start)) { open = '\\('; close = '\\)'; }
  else if (src.startsWith('\\[', start)) { open = '\\['; close = '\\]'; display = true; }
  else if (src.startsWith('$$', start)) { open = '$$'; close = '$$'; display = true; }
  else if (src[start] === '$') { open = '$'; close = '$'; }
  else return false;
  const from = start + open.length;
  if (from >= max) return false;
  let end = src.indexOf(close, from);
  if (open === '$') {
    // Prices such as "$5와 $10" stay text: the next $ must close it, with no space right inside the marks
    // and no digit right after the closing mark.
    if (/\s/.test(src[from])) return false;
    if (end !== -1 && (/\s/.test(src[end - 1]) || src[end - 1] === '\\' || /\d/.test(src[end + 1] || ''))) return false;
  }
  if (end === -1 || end + close.length > max) return false;
  const content = src.slice(from, end);
  if (!content.trim()) return false;
  if (!silent) { const token = state.push('math_inline', 'span', 0); token.content = content; token.markup = open; token.meta = {display}; }
  state.pos = end + close.length;
  return true;
}

function taskLists(state) {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
    const first = inline.children?.[0];
    const match = first?.type === 'text' ? /^\[([ xX])\](?:[ \t ]+|$)/.exec(first.content) : null;
    if (!match) continue;
    first.content = first.content.slice(match[0].length);
    const box = new state.Token('task_checkbox', 'input', 0);
    box.meta = {checked: match[1] !== ' '};
    inline.children.unshift(box);
    tokens[i - 2].attrJoin('class', 'md-task-item');
  }
}

function safeLinks(state) {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const out = [], open = [];
    for (const token of block.children) {
      if (token.type === 'link_open') {
        const href = safeHref(token.attrGet('href'));
        open.push(!!href);
        if (!href) continue; // The link text stays as plain text.
        token.attrSet('href', href); token.attrSet('target', '_blank'); token.attrSet('rel', 'noopener noreferrer');
        out.push(token); continue;
      }
      if (token.type === 'link_close') { if (open.pop()) out.push(token); continue; }
      if (token.type === 'md_image_chip') { out.push(token); continue; }
      if (token.type === 'image') {
        // Images are never fetched: a safe address becomes a link the reader may open, anything else plain text.
        const href = safeHref(token.attrGet('src')), label = `이미지: ${token.content || '설명 없음'}`;
        const text = new state.Token('text', '', 0);
        if (!href || open.at(-1)) { text.content = `[${label}]`; out.push(text); continue; }
        const a = new state.Token('link_open', 'a', 1);
        a.attrs = [['href', href], ['class', 'md-image-link'], ['target', '_blank'], ['rel', 'noopener noreferrer']];
        text.content = label;
        out.push(a, text, new state.Token('link_close', 'a', -1));
        continue;
      }
      out.push(token);
    }
    block.children = out;
  }
}

// MD-표시보완: two or more images in a row (only spaces or line breaks between them, across image-only paragraphs too)
// fold into one "🖼 이미지 N개" chip. Nothing is fetched until the reader presses it (markdown-view.js).
const imageAddress = href => /^https?:$/.test(new URL(href).protocol);
const imageOnly = inline => inline?.children?.length && inline.children.every(t => t.type === 'image' || t.type === 'softbreak' || t.type === 'hardbreak' || (t.type === 'text' && !t.content.trim()));
function mergeImageParagraphs(state) {
  const tokens = state.tokens;
  for (let i = 0; i + 5 < tokens.length; i++) {
    if (tokens[i].type !== 'paragraph_open' || !imageOnly(tokens[i + 1]) || tokens[i + 2].type !== 'paragraph_close') continue;
    while (tokens[i + 3]?.type === 'paragraph_open' && tokens[i + 3].level === tokens[i].level && imageOnly(tokens[i + 4]) && tokens[i + 5]?.type === 'paragraph_close') {
      tokens[i + 1].children.push(new state.Token('softbreak', 'br', 0), ...tokens[i + 4].children);
      tokens.splice(i + 3, 3);
    }
  }
}
const gap = t => t.type === 'softbreak' || t.type === 'hardbreak' || (t.type === 'text' && !t.content.trim());
function imageChips(state) {
  mergeImageParagraphs(state);
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const kids = block.children, out = [];
    let inLink = 0;
    for (let i = 0; i < kids.length;) {
      const t = kids[i];
      if (t.type === 'link_open') inLink++;
      if (t.type === 'link_close') inLink--;
      if (t.type !== 'image' || inLink) { out.push(t); i++; continue; }
      // A run: images separated only by blank text or line breaks.
      const run = [];
      let end = i;
      for (let j = i; j < kids.length && (kids[j].type === 'image' || gap(kids[j])); j++) if (kids[j].type === 'image') { run.push(kids[j]); end = j + 1; }
      const images = run.map(x => ({href: safeHref(x.attrGet('src')), alt: x.content || ''})).filter(x => x.href && imageAddress(x.href));
      if (run.length < 2 || images.length !== run.length) { out.push(...kids.slice(i, end)); i = end; continue; }
      const chip = new state.Token('md_image_chip', 'span', 0);
      chip.meta = {images};
      out.push(chip);
      i = end;
    }
    block.children = out;
  }
}

// GitHub alerts: a quote whose first line is exactly [!NOTE]·[!TIP]·[!IMPORTANT]·[!WARNING]·[!CAUTION].
export const CALLOUTS = Object.freeze({note: '참고', tip: '팁', important: '중요', warning: '경고', caution: '주의'});
function callouts(state) {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].type !== 'blockquote_open' || tokens[i + 1].type !== 'paragraph_open' || tokens[i + 2].type !== 'inline') continue;
    const kids = tokens[i + 2].children || [], first = kids[0];
    const match = first?.type === 'text' ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i.exec(first.content) : null;
    if (!match || (kids[1] && !['softbreak', 'hardbreak'].includes(kids[1].type))) continue;
    const kind = match[1].toLowerCase();
    tokens[i].attrJoin('class', `md-callout md-callout-${kind}`);
    const title = new state.Token('md_callout_title', 'span', 0);
    title.meta = {kind};
    kids.splice(0, kids[1] ? 2 : 1, title);
  }
}

export function createMarkdown(MarkdownIt) {
  const md = new MarkdownIt({html: false, linkify: true, breaks: true, typographer: false});
  md.linkify.set({fuzzyEmail: false});
  md.validateLink = url => !!safeHref(url);
  md.block.ruler.before('fence', 'math_block', mathBlock, {alt: ['paragraph', 'reference', 'blockquote', 'list']});
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.core.ruler.push('md_task_lists', taskLists);
  md.core.ruler.push('md_image_chips', imageChips);
  md.core.ruler.push('md_safe_links', safeLinks);
  md.core.ruler.push('md_callouts', callouts);
  const esc = md.utils.escapeHtml;
  md.renderer.rules.math_inline = (tokens, idx, options, env) => {
    env.math = true;
    return `<span class="md-math md-math-${tokens[idx].meta.display ? 'display' : 'inline'}">${esc(tokens[idx].content)}</span>`;
  };
  md.renderer.rules.math_block = (tokens, idx, options, env) => { env.math = true; return `<div class="md-math md-math-block">${esc(tokens[idx].content)}</div>\n`; };
  md.renderer.rules.md_image_chip = (tokens, idx) => {
    const images = tokens[idx].meta.images;
    const links = images.map(x => `<a class="md-image-link" href="${esc(x.href)}" target="_blank" rel="noopener noreferrer">이미지: ${esc(x.alt || '설명 없음')}</a>`).join('');
    return `<span class="md-image-group"><button type="button" class="md-image-chip" aria-expanded="false">🖼 이미지 ${images.length}개</button><span class="md-image-list" hidden>${links}</span></span>`;
  };
  md.renderer.rules.md_callout_title = (tokens, idx) => {
    const kind = tokens[idx].meta.kind;
    return `<span class="md-callout-title">${esc(CALLOUTS[kind])}</span>`;
  };
  md.renderer.rules.task_checkbox = (tokens, idx) => `<input class="md-task" type="checkbox" disabled${tokens[idx].meta.checked ? ' checked' : ''}> `;
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx], lang = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (lang === 'mermaid') { env.mermaid = true; return `<div class="md-mermaid"><pre class="md-mermaid-source"><code>${esc(token.content)}</code></pre></div>\n`; }
    if (lang === 'math') { env.math = true; return `<div class="md-math md-math-block">${esc(token.content.trim())}</div>\n`; }
    return fence(tokens, idx, options, env, self);
  };
  return md;
}

// NOTE-마크다운선택: "2026. 10. 21. 회의"·"10. 21.(화) 통화"처럼 날짜로 시작하는 줄은 마크다운이 번호 목록(2026번·10번)으로
// 읽는다. 그런 줄은 첫 숫자 뒤 점을 \. 로 바꿔 글자 그대로 보이게 한다(목록·인용 기호 뒤에 와도 같다). 코드 상자 안은 그대로.
// 날짜로 보는 것: 4자리 해(19xx·20xx). 월(1~12). 또는 월(1~12). 일(1~31). 로 시작하는 줄. "1. 2. 항목" 같은 목록은 건드리지 않는다.
const DATE_LINE = /^(\s*(?:(?:[-*+]|>)[ \t]+)*)(\d{1,4})\.([ \t]+)(\d{1,2})\.(?=[ \t(]|$)/;
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;
function dateLike(first, second) {
  const a = Number(first), b = Number(second);
  if (first.length === 4) return /^(19|20)\d\d$/.test(first) && b >= 1 && b <= 12;
  return first.length <= 2 && a >= 1 && a <= 12 && b >= 1 && b <= 31;
}
export function guardDateLines(text) {
  let fence = null;
  return String(text ?? '').split('\n').map(line => {
    const open = FENCE_LINE.exec(line);
    if (open) { if (!fence) fence = open[1][0]; else if (open[1][0] === fence) fence = null; return line; }
    if (fence) return line;
    const m = DATE_LINE.exec(line);
    if (!m || !dateLike(m[2], m[4]) || /^ {4,}/.test(m[1]) && !/[-*+>]/.test(m[1])) return line;
    return m[1] + m[2] + '\\.' + line.slice(m[1].length + m[2].length + 1);
  }).join('\n');
}

export function renderMarkdown(md, text) {
  const env = {};
  const html = md.render(guardDateLines(text), env);
  return {html, math: !!env.math, mermaid: !!env.mermaid};
}

// KaTeX: \href·\url·\includegraphics 등 외부 연결 명령은 trust:false로 막고, 오류는 원문을 빨간 글자로 보인다.
export const KATEX_OPTIONS = Object.freeze({throwOnError: false, trust: false, strict: 'ignore', maxSize: 50, maxExpand: 1000, output: 'htmlAndMathml'});
export function renderMath(katex, tex, display) {
  return katex.renderToString(String(tex), {...KATEX_OPTIONS, displayMode: !!display});
}

// Mermaid: strict(글 속 HTML은 글자로, 클릭 동작 끔). 글 안의 %%{init}%% 지시문이 아래 값을 바꾸지 못하도록 secure에 넣는다.
// 결과 SVG는 markdown-view.js가 한 번 더 정화한다(외부 주소·스크립트·foreignObject 제거).
export const MERMAID_CONFIG = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  flowchart: {htmlLabels: false},
  suppressErrorRendering: true,
  maxTextSize: 50000,
  maxEdges: 500,
  theme: 'neutral',
  secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'dompurifyConfig', 'look'],
});
