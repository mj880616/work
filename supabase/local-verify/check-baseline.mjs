import {readFileSync} from 'node:fs';
import {canonicalSchemaHash} from './schema-hash.mjs';

const [file, expectedHash] = process.argv.slice(2);
if (!file || !/^[a-f0-9]{64}$/.test(expectedHash || '')) {
  throw new Error('A reviewed baseline file and SHA-256 are required');
}
const sql = readFileSync(file, 'utf8');
const actualHash = canonicalSchemaHash(sql);
if (actualHash !== expectedHash) throw new Error('Canonical baseline SHA-256 differs from the reviewed value');
if (!sql.trim()) throw new Error('Baseline is empty');

const required = [
  /create\s+table\s+public\.app_workspaces\b/i,
  /create\s+table\s+public\.app_pages\b/i,
  /create\s+table\s+public\.app_spaces\b/i,
  /create\s+table\s+public\.app_documents\b/i,
  /create\s+table\s+public\.app_meetings\b/i,
  /create\s+table\s+public\.app_tasks\b/i,
  /create\s+table\s+public\.app_project_updates\b/i,
  /create\s+table\s+public\.app_project_publications\b/i,
  /create\s+table\s+public\.app_ai_workspace_settings\b/i,
  /create\s+table\s+public\.public_policy_drive_config\b/i,
  /create\s+(?:or\s+replace\s+)?function\s+public\.app_public_post\b/i,
  /create\s+(?:or\s+replace\s+)?function\s+private\.app_can_edit_space\b/i,
];
if (required.some(pattern => !pattern.test(sql))) {
  throw new Error('Baseline lacks a required Web2 schema object');
}

// This guard catches obvious data/credential inclusion. Human review of the
// schema-only dump remains required because function bodies may contain literals.
const forbidden = [
  /^COPY\s+\S+\s*\([^\n]+\)\s+FROM\s+stdin;/mi,
  /^INSERT\s+INTO\s+(?:public|private|auth|storage)\.[^\n]+\s+VALUES\s*\(/mi,
  /^\\\.$/m,
  /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/i,
  /\b(?:sb_secret_|ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,})[A-Za-z0-9_-]*/i,
];
if (forbidden.some(pattern => pattern.test(sql))) {
  throw new Error('Baseline contains a possible row-data or credential pattern');
}
console.log('Reviewed canonical schema-only baseline hash and basic guards passed');
