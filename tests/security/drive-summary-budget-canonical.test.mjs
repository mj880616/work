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
