import { parse } from 'acorn';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceFiles = ['app/index.html', 'app/app.js', 'app/loader-v2.js', 'app/view-loader.js', 'app/calendar-view.js', 'app/styles.css'];
const startupImports = ['action-labels.js', 'team.js', 'view-loader.js', 'capabilities.js', 'pwa.js', 'topbar-actions.js'];
const routeModules = {
  calendar: {
    'calendar-month-view.js': '__KPTU_CALENDAR_MONTH_VIEW_READY__',
    'calendar-view.js': null,
    'calendar-plus.js': '__KPTU_CALENDAR_PLUS_READY__',
    'calendar-persistence.js': '__KPTU_CALENDAR_PERSISTENCE_READY__',
    'calendar-interactions-v2.js': '__KPTU_CALENDAR_INTERACTIONS_READY__',
    'calendar-mobile-ui.js': '__KPTU_CALENDAR_MOBILE_UI_READY__',
    'calendar-day-overflow.js': '__KPTU_CALENDAR_DAY_OVERFLOW_READY__',
  },
  meetings: {
    'task-workflow.js': '__KPTU_TASK_WORKFLOW_READY__',
    'meeting-round-detail.js': '__KPTU_MEETING_ROUND_DETAIL_READY__',
  },
  projects: { 'project-system-v3.js': '__KPTU_PROJECT_V3_READY__' },
  library: { 'library-upload.js': '__KPTU_LIBRARY_UPLOAD_READY__' },
  pages: { 'web1-board.js': null },
  tasks: { 'google-tasks.js': null },
  projectCatalog: { 'project-catalog.js': null },
};
const routeStyles = {
  calendar: 'calendar-ui.css', tasks: 'task-layout.css', projects: 'project-system-v3.css',
  library: 'library-upload.css', meetings: 'meeting-ui.css', media: 'web1-press.css',
  pages: 'web1-board.css', team: 'suborganizations.css',
};
const requiredCss = ['topbar-actions.css', 'team.css', 'task-layout.css', 'google-tasks.css',
  'library-upload.css', 'meeting-ui.css', 'calendar-ui.css', 'project-system-v3.css', 'web1-board.css'];
const literal = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
const resourceName = raw => typeof raw === 'string' ? raw.split(/[?#]/)[0].split('/').at(-1) : null;

function javascript(source) {
  const result = { imports: [], modules: [], styles: {}, strings: [] };
  function walk(node, owner = null) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration') owner = node.id?.name || null;
    if (node.type === 'Literal' && typeof node.value === 'string') result.strings.push(node.value);
    if (node.type === 'ImportDeclaration') result.imports.push({ raw: literal(node.source), owner });
    if (node.type === 'ImportExpression' && literal(node.source) !== null) result.imports.push({ raw: literal(node.source), owner });
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'module') {
      result.modules.push({ raw: literal(node.arguments[0]), ready: literal(node.arguments[1]), owner });
    }
    if (node.type === 'VariableDeclarator' && node.id.name === 'routeStyles' && node.init?.type === 'ObjectExpression') {
      for (const property of node.init.properties) {
        const key = property.key?.name ?? literal(property.key);
        if (property.value?.type === 'ArrayExpression') result.styles[key] = property.value.elements.map(literal);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(child => walk(child, owner));
      else if (value && typeof value === 'object') walk(value, owner);
    }
  }
  walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  return result;
}

function htmlResources(source) {
  const clean = source.replace(/<!--[\s\S]*?-->/g, '').replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>');
  return [...clean.matchAll(/<(script|link)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)].map(match => {
    const attributes = {}, duplicates = [];
    for (const attr of match[2].matchAll(/([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = attr[1].toLowerCase();
      if (Object.hasOwn(attributes, name)) duplicates.push(name);
      else attributes[name] = (attr[2] ?? attr[3] ?? attr[4] ?? '').replaceAll('&amp;', '&');
    }
    return { tag: match[1].toLowerCase(), attributes, duplicates, defer: Object.hasOwn(attributes, 'defer') };
  });
}

export function checkAppSmokeContract(files) {
  const errors = [];
  const js = Object.fromEntries(sourceFiles.filter(name => name.endsWith('.js')).map(name => [name, javascript(files[name])]));
  // The repository writes the exact path; the Pages build adds the content-hash ?v=.
  function url(raw, name, owner) {
    if (raw !== `./${name}`) { errors.push(`${owner}: ${name} requires the exact local path ./${name} without ?v= or other query`); return; }
    if (!Object.hasOwn(files, `app/${name}`)) errors.push(`${owner}: ${name} target missing`);
  }
  function required(refs, name, owner, ready) {
    const matches = refs.filter(ref => resourceName(ref.raw) === name);
    if (matches.length !== 1) errors.push(`${owner}: ${name} requires exactly 1 reference (found ${matches.length})`);
    for (const ref of matches) {
      url(ref.raw, name, owner);
      if (ready && ref.ready !== ready) errors.push(`${owner}: ${name} requires READY ${ready} in the same call`);
    }
  }
  required(js['app/app.js'].imports, 'loader-v2.js', 'app/app.js');
  for (const name of startupImports) required(js['app/loader-v2.js'].imports, name, 'app/loader-v2.js');
  required(js['app/calendar-view.js'].imports, 'calendar-list-view.js', 'app/calendar-view.js');
  const views = js['app/view-loader.js'];
  for (const [route, modules] of Object.entries(routeModules)) {
    for (const [name, ready] of Object.entries(modules)) required(views.modules.filter(ref => ref.owner === route), name, `app/view-loader.js ${route}`, ready);
  }
  for (const [route, name] of Object.entries(routeStyles)) {
    required((views.styles[route] || []).map(raw => ({ raw })), name, `app/view-loader.js routeStyles.${route}`);
  }
  // Check all literal imports/module calls and route styles, including repeated shared integrations.
  for (const [owner, source] of Object.entries(js)) {
    for (const ref of [...source.imports, ...source.modules]) {
      if (ref.raw?.startsWith('./')) url(ref.raw, resourceName(ref.raw), owner);
    }
    for (const refs of Object.values(source.styles)) for (const raw of refs) if (raw?.startsWith('./')) url(raw, resourceName(raw), owner);
  }
  if (js['app/loader-v2.js'].strings.some(raw => resourceName(raw) === 'styles.css')) errors.push('startup must not load global styles.css');

  const css = files['app/styles.css'].replace(/\/\*[\s\S]*?\*\//g, '');
  const cssImports = [...css.matchAll(/@import\s+(?:url\(\s*(["'])(.*?)\1\s*\)|(["'])(.*?)\3)\s*;/g)].map(match => ({ raw: match[2] || match[4] }));
  for (const name of requiredCss) required(cssImports, name, 'app/styles.css');
  for (const ref of cssImports) if (ref.raw.startsWith('./')) url(ref.raw, resourceName(ref.raw), 'app/styles.css');

  const tags = htmlResources(files['app/index.html']);
  for (const item of tags) for (const name of item.duplicates) errors.push(`app/index.html: duplicate ${name} resource attribute`);
  const htmlRequirements = [
    ['app.js', 'script', null], ['critical.css', 'link', 'stylesheet'], ['windows-manifest.json', 'link', 'manifest'],
    ...['loader-v2.js', 'runtime-client.js', 'native-auth-bridge.js', 'calendar-return-bridge.js'].map(name => [name, 'link', 'modulepreload']),
  ];
  for (const [name, tag, rel] of htmlRequirements) {
    const attribute = tag === 'script' ? 'src' : 'href';
    const refs = tags.filter(item => item.tag === tag && (!rel || item.attributes.rel === rel) && resourceName(item.attributes[attribute]) === name);
    required(refs.map(item => ({ raw: item.attributes[attribute] })), name, 'app/index.html');
    if (name === 'app.js' && refs.some(item => !item.defer)) errors.push('app/index.html: app.js script requires defer');
    // Startup uses the default classic script, deferred in document order.
    // A data/module type, async, or nomodule changes that execution contract.
    if (name === 'app.js' && refs.some(item => ['type', 'async', 'nomodule'].some(key => Object.hasOwn(item.attributes, key)))) {
      errors.push('app/index.html: app.js requires the deferred classic startup contract without type, async, or nomodule');
    }
  }
  // The shell's style preloads and actual imports must use one URL for each asset.
  for (const item of tags) {
    const raw = item.attributes.href;
    if (item.tag === 'link' && ['preload', 'stylesheet'].includes(item.attributes.rel) && raw?.startsWith('./') && resourceName(raw).endsWith('.css')) url(raw, resourceName(raw), 'app/index.html');
  }
  return { errors: [...new Set(errors)] };
}

function main() {
  const files = Object.fromEntries(readdirSync('app', { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => [`app/${entry.name}`, '']));
  for (const name of sourceFiles) files[name] = readFileSync(name, 'utf8');
  const result = checkAppSmokeContract(files);
  if (result.errors.length) { result.errors.forEach(error => console.error(error)); process.exitCode = 1; }
  else console.log('App smoke module/cache contracts passed.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`App smoke contract checker failed to read/parse: ${error.message}`); process.exitCode = 2; }
}
