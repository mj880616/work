import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildManifest } from './asset-manifest.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');

test('lists every ?v= asset under app/ with its versions and content hash, one line each', () => {
  const files = {
    'app/index.html': '<link rel="stylesheet" href="./a.css?v=3"><script src="./app.js?v=9"></script><img src="./icon.svg">',
    'app/login/index.html': '<link rel="stylesheet" href="../a.css?v=2">',
    'app/app.js': "import('./loader.js?v=5')",
    'app/loader.js': 'export {}',
    'app/a.css': '.a{}',
    'app/icon.svg': '<svg/>'
  };
  const text = buildManifest(files, file => Buffer.from(files[file]));
  const { assets } = JSON.parse(text);
  assert.deepEqual(Object.keys(assets), ['app/a.css', 'app/app.js', 'app/loader.js']);
  assert.deepEqual(assets['app/a.css'], { v: ['2', '3'], sha256: sha('.a{}') });
  assert.equal(assets['app/loader.js'].sha256, sha('export {}'));
  assert.equal(text.split('\n').filter(line => line.startsWith('"app/')).length, 3);
});

test('a referenced file that does not exist is left out', () => {
  const files = { 'app/index.html': '<script src="./gone.js?v=1"></script>' };
  assert.deepEqual(JSON.parse(buildManifest(files, () => null)).assets, {});
});
