import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';

test('Web2 app has no team-ai caller or generation controls', () => {
  const files=readdirSync('app').filter(name=>name.endsWith('.js'));
  const callers=files.filter(name=>readFileSync(`app/${name}`,'utf8').includes('/functions/v1/team-ai'));
  assert.deepEqual(callers,[]);
  assert.equal(existsSync('app/workplace-ai-report.js'),false);
  assert.equal(existsSync('app/workplace-report.js'),true);
  const detail=readFileSync('app/workplace-detail.js','utf8');
  assert.doesNotMatch(detail,/wdAiSlot|AI 초안/);
  const loader=readFileSync('app/view-loader.js','utf8');
  assert.doesNotMatch(loader,/workplace-ai-report\.js/);
  assert.match(loader,/workplace-report\.js/);
});
