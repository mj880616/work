import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {renderDocuments} from '../../supabase/functions/drive-summary/core.mjs';
import {profiles,at} from '../fixtures/drive-summary-budget-profiles.mjs';
// Captured by executing exact7ea59 main, not calculated from the candidate.
const {golden}=JSON.parse(readFileSync(new URL('../fixtures/drive-summary-budget-golden.json',import.meta.url)));
for(const [name,data] of Object.entries(profiles()))test('canonical whole org/project HTML bytes retain baseline '+name,()=>{
 const result=renderDocuments(data,at);assert.equal(result.basketError,undefined);
 for(const kind of ['org','project'])assert.equal(createHash('sha256').update(result[kind]).digest('hex'),golden[name][kind]);
});
// ORG-담당13기준: the organization copy only loses the section of the organization that is not mine; putting that section
// back where the old order had it gives the hash captured before the change.
test('canonical context org copy differs from the baseline only by the dropped organization that is not mine',()=>{
 const org=renderDocuments(profiles().context,at).org;
 assert.ok(org.includes('<h2>담당조직</h2>'));assert.ok(!org.includes('다른조직'));assert.ok(!org.includes('<h2>그 외</h2>'));
 const old=org.replace('<h2>담당조직</h2>','<h2>다른조직</h2>\n<p>현재 요약: 없음</p>\n<p>최근 4주 기록 없음</p>\n<h2>담당조직</h2>');
 assert.equal(createHash('sha256').update(old).digest('hex'),'df77a2ca07829cd7ed55189e1b2caaa1af561ea130c0997996febdc6bc417d05');
});
