import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {containsParam,jsonbContains} from './helpers/postgrest-jsonb.mjs';

// basket-files photo-prune / note-delete: app_notes.attachments is jsonb. supabase-js .contains() turns a JS array into a
// Postgres ARRAY literal, which PostgREST cannot read as json, so the reference check always failed in production (503).
// The fake DB harnesses use this model so they see the same query text the real server sees.

test('model: a JS array becomes an array literal, JSON text passes through unchanged',()=>{
  assert.equal(containsParam([{drive_file_id:'p1'}]),'cs.{[object Object]}');
  assert.equal(containsParam(JSON.stringify([{drive_file_id:'p1'}])),'cs.[{"drive_file_id":"p1"}]');
  assert.equal(containsParam({a:1}),'cs.{"a":1}');
});

test('model: jsonb @> finds a row by one attachment and rejects the array literal like PostgREST',()=>{
  const rows=[{id:'n1',attachments:[{drive_file_id:'p1',file_name:'a.jpg'},{drive_file_id:'p2'}]},{id:'n2',attachments:[]},{id:'n3',attachments:null}];
  assert.deepEqual(jsonbContains(rows,'attachments','cs.[{"drive_file_id":"p2"}]').rows.map(r=>r.id),['n1']);
  assert.deepEqual(jsonbContains(rows,'attachments','cs.[{"drive_file_id":"zz"}]').rows,[]);
  assert.equal(jsonbContains(rows,'attachments','cs.{[object Object]}').error.code,'22P02');
});

test('no Edge Function passes a JS array or object to .contains() on attachments (jsonb needs JSON text)',()=>{
  const files=[];
  const walk=d=>{for(const n of readdirSync(d)){const p=join(d,n);if(statSync(p).isDirectory())walk(p);else if(p.endsWith('.ts'))files.push(p);}};
  walk('supabase/functions');
  const found=[];
  for(const f of files){
    const src=readFileSync(f,'utf8');
    for(const m of src.matchAll(/\.contains\(\s*"attachments",\s*([^\n]*)/g))found.push([f,m[1].trim()]);
  }
  assert.ok(found.length>=2,'expected the photo-prune and note-delete reference checks');
  for(const [f,arg] of found)assert.match(arg,/^JSON\.stringify\(/,f+' must pass JSON text to .contains("attachments", ...)');
});
