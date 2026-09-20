#!/usr/bin/env node
// Compare synthetic INSERT shapes to local schema metadata. No row data or SQL body is emitted.
import {readFileSync} from 'node:fs';
const [catalogPath, seedPath] = process.argv.slice(2);
if (!catalogPath || !seedPath) process.exit(2);
try {
  const rows = readFileSync(catalogPath,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const seed = readFileSync(seedPath,'utf8');
  const inserts = [...seed.matchAll(/^\s*insert\s+into\s+public\.([a-z_]+)\s*\(([^)]*)\)/gim)]
    .map(m => ({table:m[1], columns:m[2].split(',').map(x=>x.trim()), line:seed.slice(0,m.index).split(/\r?\n/).length}));
  const byName = new Map(rows.map(x=>[x.table,x]));
  const safe = x => /^[a-z_][a-z_0-9]*$/i.test(x) && !/(?:secret|token|password|api_?key)/i.test(x);
  for (const item of inserts) {
    const table = byName.get(item.table);
    if (!table || !safe(item.table)) throw Error('Seed target missing from local catalog');
    const known = new Set(table.columns.map(c=>c.name));
    const missing = table.columns.filter(c=>c.required && !c.default && !c.generated && !item.columns.includes(c.name)).map(c=>c.name);
    const unknown = item.columns.filter(c=>!known.has(c));
    const first = inserts.findIndex(x=>x===item);
    const laterRefs = table.foreignKeys.map(f=>f.references).filter(x=>x.startsWith('public.'))
      .map(x=>x.slice(7)).filter(x=>x!==item.table && inserts.findIndex(y=>y.table===x)>first);
    console.log(`SEED_SHAPE table=public.${item.table} line=${item.line} rls=${table.rls} required_missing=${missing.filter(safe).join(',')||'none'} unknown_columns=${unknown.filter(safe).join(',')||'none'} later_fk_targets=${laterRefs.filter(safe).join(',')||'none'} trigger_count=${table.triggers.length}`);
    for (const f of table.foreignKeys) if (safe(f.name) && /^(?:public|auth)\.[a-z_][a-z_0-9]*$/i.test(f.references))
      console.log(`SEED_FK table=public.${item.table} constraint=${f.name} references=${f.references}`);
  }
  const profiles = rows.filter(x=>/profile/i.test(x.table));
  console.log(`SEED_PROFILE_TABLES=${profiles.map(x=>x.table).filter(safe).join(',')||'none'}`);
  console.log('SEED_CATALOG_LIMIT=metadata only; check predicates and trigger side effects against first SQL failure');
} catch {
  console.error('SEED_CATALOG_ANALYSIS_FAILED: metadata/output withheld');
  process.exitCode=1;
}
