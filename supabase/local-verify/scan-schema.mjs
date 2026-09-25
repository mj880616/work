import {readFileSync} from 'node:fs';
import {canonicalSchemaHash} from './schema-hash.mjs';

const file = process.argv[2];
if (!file) throw new Error('A temporary schema-only dump path is required');
const sql = readFileSync(file, 'utf8');
const findings = [];
const patterns = [
  ['row-data COPY', /^COPY\s+\S+\s*(?:\([^\n]*\))?\s+FROM\s+stdin\s*;/i],
  ['row-data INSERT', /^INSERT\s+INTO\s+(?:public|private|auth|storage)\./i],
  ['private key', /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/i],
  ['token or API key', /(?:sb_secret_|ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,})[A-Za-z0-9_-]*/i],
  ['JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\b/],
  ['database connection string', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/\S+/i],
  ['credential assignment', /\b(?:api[_-]?key|service[_-]?role[_-]?key|jwt[_-]?secret|oauth[_-]?(?:secret|token)|client[_-]?secret|refresh[_-]?token|password)\b\s*(?:=|:|DEFAULT)\s*['"]?\S{8,}/i],
];
let object = 'unknown';
for (const [i, line] of sql.split(/\r?\n/).entries()) {
  const declaration = line.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|TRIGGER|POLICY)\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(;]+)/i);
  if (declaration) object = declaration[1];
  for (const [category, pattern] of patterns) {
    if (pattern.test(line)) findings.push({line: i + 1, category, object});
  }
}
if (!/CREATE\s+TABLE\s+public\.app_spaces\b/i.test(sql)
    || !/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+private\.app_can_edit_space\b/i.test(sql)) {
  findings.push({line: 0, category: 'missing required schema definitions', object: 'baseline'});
}
if (findings.length) {
  for (const finding of findings) {
    console.error(`schema review required: line ${finding.line}, ${finding.category}, ${finding.object}`);
  }
  process.exitCode = 1;
} else {
  const digest = canonicalSchemaHash(sql);
  console.log(`Schema-only scan found no recognized row or credential patterns; SHA-256 ${digest}`);
  console.log('Manual review of function bodies, defaults, owners, grants, and dependencies remains required.');
}

