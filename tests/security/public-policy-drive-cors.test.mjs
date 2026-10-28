import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../../supabase/functions/public-policy-drive/index.ts', import.meta.url),'utf8');

test('Drive reconnect CORS explicitly allows every production Web2 origin',()=>{
  for(const origin of [
    'https://mj880616.github.io',
    'https://work.bokdoong.com',
    'https://desk.bokdoong.com',
    'https://bokdoong.com'
  ]) assert.equal(source.includes(`'${origin}'`),true,origin);
  assert.equal(source.includes("ALLOWED_ORIGINS.has(origin) ? origin : 'https://mj880616.github.io'"),true);
  assert.match(source,/const ALLOWED_ORIGINS = new Set\(\[/);
});

test('Drive CORS allowlist is an exact set of four origins (no prefix or suffix match)',()=>{
  const block=source.match(/const ALLOWED_ORIGINS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block);
  const origins=[...block[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).sort();
  assert.deepEqual(origins,[
    'https://bokdoong.com',
    'https://desk.bokdoong.com',
    'https://mj880616.github.io',
    'https://work.bokdoong.com'
  ].sort());
  const uses=[...source.matchAll(/\borigin\b[^\n]*/g)].map(m=>m[0]);
  assert.equal(uses.some(line=>/origin\.(startsWith|endsWith|includes|indexOf|match)\(|\.(includes|indexOf)\(origin\)/.test(line)),false);
});


test('Drive OAuth returns to the canonical Web2 library',()=>{
  assert.equal(source.includes("const DRIVE_APP_URL = 'https://desk.bokdoong.com/work/app/?view=library';"),true);
  assert.equal(source.includes("const DRIVE_APP_URL = 'https://work.bokdoong.com/?view=library';"),false);
});
