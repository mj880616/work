import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
// HWP-편집기: the rhwp version is pinned once (scripts/hwp-lab/rhwp-pin.json). The lab, the vendored folder and its
// provenance must all name that version, and vendored files must be exactly what the build script produced.
const pin=JSON.parse(readFileSync('scripts/hwp-lab/rhwp-pin.json','utf8'));
const dir=`app/hwp-lab/rhwp-${pin.version}`;

test('one pinned rhwp version is used by the lab and the vendored folder',()=>{
  assert.match(pin.version,/^\d+\.\d+\.\d+$/);
  assert.equal(pin.tag,`v${pin.version}`);
  assert.match(pin.commit,/^[0-9a-f]{40}$/);
  assert.deepEqual(readdirSync('app/hwp-lab').filter(name=>name.startsWith('rhwp-')),[`rhwp-${pin.version}`]);
  // The sandboxed editor frame (hwp-frame.js) is the only place that names the vendored editor path.
  const frame=readFileSync('app/hwp-frame.js','utf8');
  const paths=[...frame.matchAll(/hwp-lab\/rhwp-([\d.]+)\//g)].map(match=>match[1]);
  assert.ok(paths.length>=1);
  assert.deepEqual([...new Set(paths)],[pin.version]);
  assert.doesNotMatch(readFileSync('app/hwp-lab.js','utf8'),/rhwp-[\d.]+\//);
  const source=readFileSync(`${dir}/SOURCE.md`,'utf8');
  for(const value of [pin.tag,pin.commit,pin.editorIntegrity,pin.coreIntegrity])assert.ok(source.includes(value),value);
});

test('vendored editor files match the recorded build output',()=>{
  const rows=readFileSync(`${dir}/SHA256SUMS`,'utf8').trim().split('\n').map(line=>line.split(/  /));
  assert.ok(rows.length>40);
  for(const [hash,path] of rows)assert.equal(createHash('sha256').update(readFileSync(`${dir}/${path}`)).digest('hex'),hash,path);
});

test('the editor frame is sandboxed without same-origin access to Web2',()=>{
  const frame=readFileSync('app/hwp-frame.js','utf8').replace(/^\s*\/\/.*$/gm,'');
  assert.match(frame,/setAttribute\('sandbox','allow-scripts'\)/);
  assert.doesNotMatch(frame,/allow-same-origin|allow-top-navigation|allow-popups|allow-downloads/);
  // The lab never builds its own unsandboxed frame.
  const lab=readFileSync('app/hwp-lab.js','utf8');
  assert.doesNotMatch(lab,/createEditor|createElement\('iframe'\)/);
});

test('the editor page blocks external origins and runs the storage guard before any editor script',()=>{
  const html=readFileSync(`${dir}/studio/index.html`,'utf8');
  assert.match(html,/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval';[^"]*connect-src 'self' data: blob:;/);
  const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(scripts[0],'../../studio-guard.js');
  assert.ok(!/https?:\/\//.test(scripts.join(' ')));
  assert.ok(!/rel="manifest"|registerSW/.test(html));
});
