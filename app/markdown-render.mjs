// MD-표시: 마크다운 글을 안전한 HTML 문자열로 바꾸는 순수 함수. DOM이 없어 Node 단위 검사에서도 그대로 돈다.
// 브라우저 쪽 불러오기·정화·Mermaid·KaTeX 적용은 markdown-view.js가 맡는다(바구니 메모, 이후 일지·노트에서 재사용).
// 안전 원칙: 글 속 HTML은 글자로만 보이고(html:false), 링크는 http·https·mailto만 새 창 + noopener로 열며,
// 이미지는 불러오지 않고 링크로만 보인다. 수식·도식은 자리표시(원문 글자)만 두고 나중에 바꾼다.

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

export function createMarkdown(MarkdownIt) {
  const md = new MarkdownIt({html: false, linkify: true, breaks: true, typographer: false});
  md.linkify.set({fuzzyEmail: false});
  md.validateLink = url => !!safeHref(url);
  md.block.ruler.before('fence', 'math_block', mathBlock, {alt: ['paragraph', 'reference', 'blockquote', 'list']});
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.core.ruler.push('md_task_lists', taskLists);
  md.core.ruler.push('md_safe_links', safeLinks);
  const esc = md.utils.escapeHtml;
  md.renderer.rules.math_inline = (tokens, idx, options, env) => {
    env.math = true;
    return `<span class="md-math md-math-${tokens[idx].meta.display ? 'display' : 'inline'}">${esc(tokens[idx].content)}</span>`;
  };
  md.renderer.rules.math_block = (tokens, idx, options, env) => { env.math = true; return `<div class="md-math md-math-block">${esc(tokens[idx].content)}</div>\n`; };
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

export function renderMarkdown(md, text) {
  const env = {};
  const html = md.render(String(text ?? ''), env);
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
