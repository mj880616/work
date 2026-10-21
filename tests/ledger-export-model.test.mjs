// AI-서버연동 S7-d: 원장 매주 Drive 내보내기 앱 판단(순수 함수).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ledgerFromStatus, exportDue, exportResult, failureText, WEEK_MS, RETRY_AFTER_FAILURE_MS } from '../app/ledger-export-model.mjs';

const NOW = Date.parse('2026-10-26T00:00:00Z');
const status = over => ({ ok: true, ledger: { state: 'found', last_success_at: null, last_failure_at: null, last_failure_code: null, ...over } });

test('status answer: malformed or old function hides; codes and times are checked', () => {
  assert.equal(ledgerFromStatus(null), null);
  assert.equal(ledgerFromStatus({ ok: true, copy: {} }), null); // old status shape
  assert.equal(ledgerFromStatus({ ok: false, error: 'METHOD_NOT_ALLOWED' }), null);
  assert.deepEqual(ledgerFromStatus(status({ last_success_at: '<x>', last_failure_at: '2026-10-20T00:00:00.000Z', last_failure_code: 'bad!' })),
    { state: 'found', successAt: null, failedAt: Date.parse('2026-10-20T00:00:00Z'), code: null });
});

test('weekly due: never, 7 days, recent success, recent failure waits a day', () => {
  const s = over => ledgerFromStatus(status(over));
  assert.equal(exportDue(null, NOW), false);
  assert.equal(exportDue(s({}), NOW), true);
  assert.equal(exportDue(ledgerFromStatus({ ok: true, ledger: { state: 'none' } }), NOW), true);
  assert.equal(exportDue(s({ last_success_at: new Date(NOW - WEEK_MS + 60000).toISOString() }), NOW), false);
  assert.equal(exportDue(s({ last_success_at: new Date(NOW - WEEK_MS).toISOString() }), NOW), true);
  const old = new Date(NOW - 2 * WEEK_MS).toISOString();
  assert.equal(exportDue(s({ last_success_at: old, last_failure_at: new Date(NOW - 3600000).toISOString() }), NOW), false);
  assert.equal(exportDue(s({ last_success_at: old, last_failure_at: new Date(NOW - RETRY_AFTER_FAILURE_MS).toISOString() }), NOW), true);
  // An older failure than the last success does not delay.
  assert.equal(exportDue(s({ last_success_at: old, last_failure_at: new Date(NOW - 3 * WEEK_MS).toISOString() }), NOW), true);
});

test('export answer: new function, old function (copy refresh answer), failure code', () => {
  assert.deepEqual(exportResult({ ok: true, exported_at: '2026-10-26T00:00:00.000Z', counts: { app_ledger_records: 12 } }), { ok: true, at: NOW, records: 12 });
  assert.deepEqual(exportResult({ ok: true, updated_at: '2026-10-26T00:00:00.000Z', documents: {} }), { ok: false, code: 'NOT_DEPLOYED' });
  assert.deepEqual(exportResult({ ok: false, error: 'DRIVE_PUBLIC_SHARING_FOUND' }), { ok: false, code: 'DRIVE_PUBLIC_SHARING_FOUND' });
  assert.deepEqual(exportResult({ ok: false, error: 'raw <text>' }), { ok: false, code: 'LEDGER_EXPORT_FAILED' });
  assert.match(failureText('NOT_DEPLOYED'), /서버 준비 전/);
  assert.match(failureText('X_Y'), /단계 X_Y/);
});

test('module: owner-only, no request body, fixed paths, one renderer region, no secret or service key', () => {
  const src = readFileSync(new URL('../app/ledger-export.js', import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.match(src, /'\/functions\/v1\/drive-summary\?action=ledger_status'/);
  assert.match(src, /'\/functions\/v1\/drive-summary\?action=ledger_export'/);
  assert.doesNotMatch(src, /body:/);
  assert.doesNotMatch(src, /service_role|cron-secret/i);
  assert.match(src, /membership\?\.role === 'owner'/);
  assert.equal((src.match(/#ledgerExportRoot/g) || []).length >= 1, true);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
  const importer = readFileSync(new URL('../app/ledger-import.js', import.meta.url), 'utf8');
  assert.match(importer, /<div id="ledgerExportRoot" class="lg-root" hidden><\/div>/);
});
