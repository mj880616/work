// MD-표시: 공용 마크다운 표시(바구니 메모 읽기 화면, 이후 일지·노트에서 재사용).
// 라이브러리는 scripts/markdown/md-pin.json으로 고정해 app/markdown-lib/에 넣은 같은 주소 파일만 쓴다(CDN 없음).
// markdown-it·DOMPurify는 처음 표시할 때, KaTeX는 수식이 있을 때, Mermaid는 도식이 있을 때만 불러온다.
// 모든 결과는 DOMPurify로 정화한 DOM 조각으로 넣고(문자열 재해석 없음), 외부 주소를 부르는 요소·속성은 남기지 않는다.
import {createMarkdown, renderMarkdown, renderMath, safeHref, MERMAID_CONFIG} from './markdown-render.mjs?v=1';

const LIB = new URL('./markdown-lib/', import.meta.url);
export const MARKDOWN_LIBS = Object.freeze({
  markdownIt: 'markdown-it-15.0.2/markdown-it.esm.min.mjs',
  dompurify: 'dompurify-3.4.16/purify.es.mjs',
  mermaid: 'mermaid-11.17.2/mermaid.min.js',
  katex: 'katex-0.18.10/katex.min.js',
  katexCss: 'katex-0.18.10/katex.min.css',
});
const libUrl = name => new URL(MARKDOWN_LIBS[name], LIB).href;

const PAGE_TAGS = ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input', 'span', 'div'];
const PAGE_ATTRS = ['href', 'target', 'rel', 'class', 'start', 'type', 'checked', 'disabled', 'style'];
const CELL_ALIGN = /^text-align:(left|right|center)$/;
// Anything that could name another address inside SVG or KaTeX output.
const URL_IN_CSS = /url\s*\(|@import|expression\s*\(/i;
const cleanCss = css => css.replace(/@import[^;]*;?/gi, '').replace(/url\s*\(\s*(?!['"]?#)[^)]*\)/gi, 'none');

let core = null, coreLib = null, katexFlight = null, mermaidFlight = null, mermaidQueue = Promise.resolve(), diagramSeq = 0;
const jobs = new WeakMap();

function purifiers(DOMPurify) {
  const page = DOMPurify(window), svg = DOMPurify(window), math = DOMPurify(window);
  page.addHook('afterSanitizeAttributes', node => {
    if (node.nodeName === 'A') {
      const href = safeHref(node.getAttribute('href'));
      if (href) { node.setAttribute('href', href); node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
      else { node.removeAttribute('href'); node.removeAttribute('target'); node.removeAttribute('rel'); }
    }
    if (node.nodeName === 'INPUT') { node.setAttribute('type', 'checkbox'); node.setAttribute('disabled', ''); }
    if (node.hasAttribute?.('style') && !(/^T[HD]$/.test(node.nodeName) && CELL_ALIGN.test(node.getAttribute('style')))) node.removeAttribute('style');
  });
  const offsite = node => {
    for (const attr of [...(node.attributes || [])]) {
      const name = attr.name.toLowerCase();
      if ((name === 'href' || name === 'xlink:href' || name === 'src') && !attr.value.trim().startsWith('#')) node.removeAttribute(attr.name);
      else if (name === 'style' ? URL_IN_CSS.test(attr.value) : /url\s*\(\s*(?!['"]?#)/i.test(attr.value)) node.removeAttribute(attr.name);
    }
    if (node.nodeName?.toLowerCase() === 'style') node.textContent = cleanCss(node.textContent);
  };
  svg.addHook('afterSanitizeAttributes', offsite);
  math.addHook('afterSanitizeAttributes', offsite);
  const fragment = {RETURN_DOM_FRAGMENT: true, ALLOW_DATA_ATTR: false};
  return {
    page: html => page.sanitize(html, {...fragment, ALLOWED_TAGS: PAGE_TAGS, ALLOWED_ATTR: PAGE_ATTRS}),
    svg: html => svg.sanitize(html, {...fragment, USE_PROFILES: {svg: true, svgFilters: true}, ADD_TAGS: ['style'], FORBID_TAGS: ['a', 'image', 'foreignObject', 'script', 'iframe', 'object', 'embed', 'feImage']}),
    math: html => math.sanitize(html, {...fragment, USE_PROFILES: {html: true, svg: true, mathMl: true}, FORBID_TAGS: ['a', 'img', 'image', 'style', 'foreignObject', 'use', 'form', 'input', 'button']}),
  };
}

function loadCore() {
  core ||= Promise.all([import(libUrl('markdownIt')), import(libUrl('dompurify'))]).then(([markdownIt, dompurify]) => {
    const md = createMarkdown(markdownIt.default);
    coreLib = {md, purify: purifiers(dompurify.default)};
    return coreLib;
  }).catch(error => { core = null; throw error; });
  return core;
}

function loadScript(name, global) {
  return new Promise((resolve, reject) => {
    if (window[global]) return resolve(window[global]);
    const script = document.createElement('script');
    script.src = libUrl(name); script.async = true; script.dataset.markdownLib = name;
    script.onload = () => window[global] ? resolve(window[global]) : reject(new Error(name + ' did not load'));
    script.onerror = () => { script.remove(); reject(new Error(name + ' did not load')); };
    document.head.append(script);
  });
}
function loadCss(name) {
  return new Promise((resolve, reject) => {
    const href = libUrl(name);
    if (document.querySelector(`link[data-markdown-lib="${name}"]`)) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href; link.dataset.markdownLib = name;
    link.onload = () => resolve(); link.onerror = () => { link.remove(); reject(new Error(name + ' did not load')); };
    document.head.append(link);
  });
}
function loadKatex() {
  katexFlight ||= Promise.all([loadScript('katex', 'katex'), loadCss('katexCss')]).then(([katex]) => katex).catch(error => { katexFlight = null; throw error; });
  return katexFlight;
}
function loadMermaid() {
  mermaidFlight ||= loadScript('mermaid', 'mermaid').then(mermaid => { mermaid.initialize(structuredClone(MERMAID_CONFIG)); return mermaid; }).catch(error => { mermaidFlight = null; throw error; });
  return mermaidFlight;
}

async function enhanceMath(el, live, purify) {
  let katex;
  try { katex = await loadKatex(); } catch { return; } // The TeX source stays readable.
  if (!live()) return;
  for (const node of el.querySelectorAll('.md-math:not(.md-math-done)')) {
    const display = !node.classList.contains('md-math-inline');
    try { node.replaceChildren(purify.math(renderMath(katex, node.textContent, display))); node.classList.add('md-math-done'); } catch {}
  }
}

function diagramFailed(node) {
  if (node.querySelector('.md-mermaid-error')) return;
  const note = document.createElement('p');
  note.className = 'md-mermaid-error'; note.textContent = '도식을 그리지 못해 원문을 그대로 보여 줍니다.';
  node.prepend(note);
}
async function enhanceMermaid(el, live, purify) {
  let mermaid;
  try { mermaid = await loadMermaid(); } catch { el.querySelectorAll('.md-mermaid').forEach(diagramFailed); return; }
  for (const node of el.querySelectorAll('.md-mermaid:not(.md-mermaid-done)')) {
    if (!live()) return;
    const source = node.querySelector('code')?.textContent || '', id = `md-mermaid-${++diagramSeq}`;
    // Mermaid keeps shared state while it draws, so diagrams render one at a time.
    const run = mermaidQueue.then(() => mermaid.render(id, source));
    mermaidQueue = run.catch(() => {});
    try {
      const {svg} = await run;
      if (!live()) return;
      const picture = purify.svg(svg);
      if (!picture.querySelector('svg')) throw new Error('empty diagram');
      const figure = document.createElement('div');
      figure.className = 'md-mermaid-figure'; figure.setAttribute('role', 'img'); figure.setAttribute('aria-label', '도식');
      figure.append(picture);
      node.replaceChildren(figure); node.classList.add('md-mermaid-done');
    } catch {
      if (live()) diagramFailed(node);
    } finally {
      // Mermaid's own scratch copy (outside this note) is removed; the sanitized copy shown above stays.
      for (const stray of [document.getElementById('d' + id), document.getElementById(id)]) if (stray && !node.contains(stray)) stray.remove();
    }
  }
}

// Show text exactly as written. Cancels any markdown render still in flight for this element.
export function showPlainText(el, text) {
  jobs.set(el, (jobs.get(el) || 0) + 1);
  el.classList.remove('md-body');
  el.textContent = text;
}

// Render markdown into el. Once the core libraries are loaded the text is replaced in the same task (no flash
// of plain text, no layout jump); before that the caller's plain text stays until they arrive, and stays for good
// if they fail to load. isCurrent lets the caller drop a result that arrives after the note or account changed.
export async function renderMarkdownInto(el, text, {isCurrent = () => true} = {}) {
  const job = (jobs.get(el) || 0) + 1;
  jobs.set(el, job);
  const live = () => jobs.get(el) === job && el.isConnected && isCurrent();
  let lib = coreLib;
  if (!lib) {
    try { lib = await loadCore(); } catch { return {ok: false}; }
    if (!live()) return {ok: false, stale: true};
  }
  const {html, math, mermaid} = renderMarkdown(lib.md, text);
  el.replaceChildren(lib.purify.page(html));
  el.classList.add('md-body');
  const tasks = [];
  if (math && el.querySelector('.md-math')) tasks.push(enhanceMath(el, live, lib.purify));
  if (mermaid && el.querySelector('.md-mermaid')) tasks.push(enhanceMermaid(el, live, lib.purify));
  await Promise.all(tasks);
  return {ok: live()};
}

// Warm the two small core libraries (no Mermaid/KaTeX) when a reading screen is about to be used.
export function preloadMarkdown() { return loadCore().then(() => true, () => false); }
