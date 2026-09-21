import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../../supabase/functions/public-policy-drive/index.ts', import.meta.url),'utf8');

test('Drive reconnect CORS explicitly allows every production Web2 origin',()=>{
  for(const origin of [
    'https://mj880616.github.io',
    'https://work.bokdoong.com',
    'https://desk.bokdoong.com'
  ]) assert.equal(source.includes(`'${origin}'`),true,origin);
  assert.equal(source.includes("ALLOWED_ORIGINS.has(origin) ? origin : 'https://mj880616.github.io'"),true);
});
