import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildPages, rewriteVersions, versionOf } from './build-pages.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
// The repository writes plain paths (CI-버전자동화 3단계); a leftover number is overwritten too.
const tree = () => ({
  'app/index.html': '<link rel="stylesheet" href="./a.css"><script src="./app.js" defer></script><img src="./icon.svg">',
  'app/app.js': "import('./loader.js?v=5');const plain='./loader.js';",
  'app/loader.js': "import('./view.js');import('./view.js?v=1');",
  'app/view.js': 'export const view = 1;',
  'app/a.css': '.a{background:url(./bg.svg?v=2)}',
  'app/bg.svg': Buffer.from('<svg/>'),
  'app/icon.svg': Buffer.from('<svg id="i"/>')
});

test('every reference gets the first 10 hex chars of the final bytes, children first', () => {
  const out = buildPages(tree());
  const view = versionOf(Buffer.from(out['app/view.js']));
  assert.equal(out['app/loader.js'], `import('./view.js?v=${view}');import('./view.js?v=${view}');`);
  const loader = versionOf(Buffer.from(out['app/loader.js']));
  assert.equal(out['app/app.js'], `import('./loader.js?v=${loader}');const plain='./loader.js?v=${loader}';`);
  assert.ok(out['app/a.css'].includes(`url(./bg.svg?v=${versionOf(out['app/bg.svg'])})`));
  assert.ok(out['app/index.html'].includes(`./app.js?v=${versionOf(Buffer.from(out['app/app.js']))}`));
  assert.ok(out['app/index.html'].includes(`src="./icon.svg?v=${versionOf(out['app/icon.svg'])}"`));
  assert.equal(out['app/view.js'], 'export const view = 1;');
});

test('the same input gives the same output; numbers already in the repository do not matter', () => {
  const first = buildPages(tree());
  assert.deepEqual(buildPages(tree()), first);
  const renumbered = tree();
  renumbered['app/index.html'] = renumbered['app/index.html'].replace('./app.js', './app.js?v=400');
  renumbered['app/app.js'] = renumbered['app/app.js'].replace('loader.js?v=5', 'loader.js');
  assert.deepEqual(buildPages(renumbered), first);
});

test('a leaf change reaches index.html; an unrelated branch keeps its version', () => {
  const before = buildPages(tree());
  const changed = tree();
  changed['app/view.js'] = 'export const view = 2;';
  const after = buildPages(changed);
  for (const file of ['app/view.js', 'app/loader.js', 'app/app.js', 'app/index.html']) assert.notEqual(after[file], before[file], file);
  assert.equal(after['app/a.css'], before['app/a.css']);
});

test('the manifest lists the rewritten versions with the SHA-256 of the output bytes', () => {
  const out = buildPages(tree());
  const { assets } = JSON.parse(out['app/asset-manifest.json']);
  assert.deepEqual(Object.keys(assets), ['app/a.css', 'app/app.js', 'app/bg.svg', 'app/icon.svg', 'app/loader.js', 'app/view.js']);
  for (const [file, entry] of Object.entries(assets)) {
    const bytes = typeof out[file] === 'string' ? Buffer.from(out[file]) : out[file];
    assert.deepEqual(entry, { v: [versionOf(bytes)], sha256: sha(bytes) }, file);
  }
});

test('template strings with ${ and external URLs are left alone', () => {
  const out = buildPages({
    'app/index.html': '<script src="./app.js?v=1"></script><script src="https://cdn.example/x.js?v=2"></script>',
    'app/app.js': 'const n=2;import(`./view-${n}.js?v=4`);import("./view-2.js?v=4");',
    'app/view-2.js': 'export {}'
  });
  assert.ok(out['app/app.js'].includes('`./view-${n}.js?v=4`'));
  assert.ok(out['app/app.js'].includes(`"./view-2.js?v=${versionOf(Buffer.from('export {}'))}"`));
  assert.ok(out['app/index.html'].includes('https://cdn.example/x.js?v=2'));
});

test('Web1 pages that load /work/app/ assets get the same hash as Web2', () => {
  const files = {
    'app/index.html': '<script src="./shared.js?v=1"></script>',
    'p/index.html': '<script src="/work/app/shared.js?v=3"></script><link href="/assets/site.css?v=8" rel="stylesheet">',
    'app/shared.js': 'export {}',
    'assets/site.css': 'body{}'
  };
  const out = buildPages(files);
  const version = versionOf(Buffer.from('export {}'));
  assert.ok(out['p/index.html'].includes(`/work/app/shared.js?v=${version}`));
  assert.ok(out['app/index.html'].includes(`./shared.js?v=${version}`));
  assert.ok(out['p/index.html'].includes(`/assets/site.css?v=${versionOf(Buffer.from('body{}'))}`));
  assert.deepEqual(JSON.parse(out['app/asset-manifest.json']).assets['app/shared.js'].v, [version]);
});

test('other query parameters and &amp; spelling are kept', () => {
  const out = buildPages({
    'app/index.html': '<link rel="manifest" href="./m.webmanifest"><script src="./a.js?x=1&amp;v=2"></script>',
    'app/a.js': 'export {}'
  });
  assert.ok(out['app/index.html'].includes(`./a.js?x=1&amp;v=${versionOf(Buffer.from('export {}'))}`));
});

test('a missing target keeps its reference and stays out of the manifest', () => {
  const out = buildPages({ 'app/index.html': '<script src="./gone.js?v=1"></script>' });
  assert.ok(out['app/index.html'].includes('./gone.js?v=1'));
  assert.deepEqual(JSON.parse(out['app/asset-manifest.json']).assets, {});
});

test('circular versioned references are refused', () => {
  assert.throws(() => rewriteVersions({
    'app/index.html': '<script src="./a.js?v=1"></script>',
    'app/a.js': "import('./b.js?v=1')",
    'app/b.js': "import('./a.js?v=1')"
  }), /순환 참조: .*app\/a\.js → app\/b\.js → app\/a\.js/);
});

test('a plain path keeps its other query parameters and fragment', () => {
  const out = buildPages({
    'app/index.html': '<script src="./a.js?x=1"></script><link rel="icon" href="./i.svg#mark">',
    'app/a.js': 'export {}',
    'app/i.svg': Buffer.from('<svg/>')
  });
  assert.ok(out['app/index.html'].includes(`./a.js?x=1&v=${versionOf(Buffer.from('export {}'))}`));
  assert.ok(out['app/index.html'].includes(`./i.svg?v=${versionOf(Buffer.from('<svg/>'))}#mark`));
});

test('references into vendored release folders are left as written', () => {
  const out = buildPages({
    'app/index.html': '<script src="./frame.js"></script><script src="./lib/rhwp-0.8.7/studio.js"></script>',
    'app/frame.js': "import('./lib/rhwp-0.8.7/sdk/index.js');",
    'app/lib/rhwp-0.8.7/sdk/index.js': "import('./transport.js');import('../studio.js');",
    'app/lib/rhwp-0.8.7/sdk/transport.js': 'export {}',
    'app/lib/rhwp-0.8.7/studio.js': "import('./sdk/index.js');import('../../guard.js');",
    'app/guard.js': 'guard()'
  });
  assert.ok(out['app/frame.js'].includes("'./lib/rhwp-0.8.7/sdk/index.js'"));
  assert.ok(out['app/index.html'].includes('"./lib/rhwp-0.8.7/studio.js"'));
  assert.equal(out['app/lib/rhwp-0.8.7/sdk/index.js'], "import('./transport.js');import('../studio.js');");
  // Our own file loaded from a vendored page is still versioned.
  assert.ok(out['app/lib/rhwp-0.8.7/studio.js'].includes(`'../../guard.js?v=${versionOf(Buffer.from('guard()'))}'`));
});

test('JSON linked from HTML is versioned; JSON named in a script is run-time data and is not', () => {
  const out = buildPages({
    'app/index.html': '<link rel="manifest" href="./m.json"><script src="./press.js"></script>',
    'app/m.json': Buffer.from('{}'),
    'app/press.js': "fetch(new URL('../press/archive.json',location.href));",
    'press/archive.json': Buffer.from('[]')
  });
  assert.ok(out['app/index.html'].includes(`./m.json?v=${versionOf(Buffer.from('{}'))}`));
  assert.equal(out['app/press.js'], "fetch(new URL('../press/archive.json',location.href));");
});

// PERF-첫로딩 P4: /*static-chain*/ 목록은 빌드가 정적 import 사슬(가까운 것부터, 중복 없이)로 채우고, 채운 글자도 같은 ?v=를 받는다.
test('a marked preload list gets the static import chain of its entries, versioned like import()', async () => {
  const { fillStaticChains, staticChain } = await import('./build-pages.mjs');
  const input = {
    'app/index.html': '<script src="./loader.js" defer></script>',
    'app/loader.js': "preload(/*static-chain*/['./view.js']);import('./view.js');import('./lazy.js');",
    'app/view.js': "import {a} from './a.js';export * from './sub/b.js';const later=()=>import('./lazy.js');export const view=a;",
    'app/a.js': "import './sub/b.js';import './rhwp-0.8.7/x.js';export const a=1;",
    'app/sub/b.js': "export {c} from '../c.mjs';",
    'app/c.mjs': 'export const c=1;',
    'app/lazy.js': "import './a.js';export const lazy=1;",
    'app/rhwp-0.8.7/x.js': 'export const x=1;'
  };
  // 동적 import(lazy.js)와 외부 라이브러리 폴더(rhwp-0.8.7/)는 넣지 않는다.
  assert.deepEqual(staticChain(input, ['app/view.js']), ['app/a.js', 'app/sub/b.js', 'app/c.mjs']);
  const filled = fillStaticChains(input);
  assert.equal(filled['app/loader.js'], "preload(/*static-chain*/['./view.js','./a.js','./sub/b.js','./c.mjs']);import('./view.js');import('./lazy.js');");
  assert.equal(filled['app/view.js'], input['app/view.js'], '표시 없는 파일은 그대로');
  const out = buildPages(input);
  for (const file of ['view.js', 'a.js', 'sub/b.js', 'c.mjs']) {
    const version = versionOf(Buffer.from(out[`app/${file}`]));
    assert.ok(out['app/loader.js'].includes(`'./${file}?v=${version}'`), file);
  }
  assert.throws(() => fillStaticChains({ 'app/l.js': "p(/*static-chain*/['./none.js'])" }), /none\.js 파일이 없습니다/);
  assert.deepEqual(fillStaticChains({ 'scripts/s.mjs': "/*static-chain*/['./none.js']" })['scripts/s.mjs'], "/*static-chain*/['./none.js']", 'app/ 밖은 손대지 않는다');
});
