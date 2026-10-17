import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildPages, rewriteVersions, versionOf } from './build-pages.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const tree = () => ({
  'app/index.html': '<link rel="stylesheet" href="./a.css?v=3"><script src="./app.js?v=9" defer></script><img src="./icon.svg">',
  'app/app.js': "import('./loader.js?v=5');const plain='./loader.js';",
  'app/loader.js': "import('./view.js?v=12');import('./view.js?v=1');",
  'app/view.js': 'export const view = 1;',
  'app/a.css': '.a{background:url(./bg.svg?v=2)}',
  'app/bg.svg': Buffer.from('<svg/>'),
  'app/icon.svg': Buffer.from('<svg id="i"/>')
});

test('every ?v= becomes the first 10 hex chars of the final bytes, children first', () => {
  const out = buildPages(tree());
  assert.match(out['app/loader.js'], new RegExp(`'./view.js\\?v=${versionOf(Buffer.from(out['app/view.js']))}'`));
  assert.ok(!out['app/loader.js'].includes('v=12') && !out['app/loader.js'].includes('v=1\''));
  assert.ok(out['app/app.js'].includes(`./loader.js?v=${versionOf(Buffer.from(out['app/loader.js']))}`));
  assert.ok(out['app/app.js'].includes("const plain='./loader.js'"), 'unversioned references stay as they are');
  assert.ok(out['app/a.css'].includes(`url(./bg.svg?v=${versionOf(out['app/bg.svg'])})`));
  assert.ok(out['app/index.html'].includes(`./app.js?v=${versionOf(Buffer.from(out['app/app.js']))}`));
  assert.ok(out['app/index.html'].includes('src="./icon.svg"'));
  assert.equal(out['app/view.js'], 'export const view = 1;');
});

test('the same input gives the same output; numbers already in the repository do not matter', () => {
  const first = buildPages(tree());
  assert.deepEqual(buildPages(tree()), first);
  const renumbered = tree();
  renumbered['app/index.html'] = renumbered['app/index.html'].replace('app.js?v=9', 'app.js?v=400');
  renumbered['app/app.js'] = renumbered['app/app.js'].replace('loader.js?v=5', 'loader.js?v=77');
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
  assert.deepEqual(Object.keys(assets), ['app/a.css', 'app/app.js', 'app/bg.svg', 'app/loader.js', 'app/view.js']);
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
