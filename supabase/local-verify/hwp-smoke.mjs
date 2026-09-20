// Run with Deno in disposable CI. Input is a pinned public MIT test fixture.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extractHwp} from '../functions/meeting-ai-ingest/hwp-parser.mjs';

const expected = 'bab4561ceb02cdfa184a1689be9619c08e18d6021cdbc423486b848bc14d267e';
const path = Deno.args[0];
if (!path) throw new Error('Fixture path required');
const bytes = new Uint8Array(await readFile(path));
if (bytes.length !== 18944 || createHash('sha256').update(bytes).digest('hex') !== expected) {
  throw new Error('Pinned HWP fixture checksum mismatch');
}
if (!bytes.subarray(0, 8).every((value, index) => value === [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1][index])) {
  throw new Error('Fixture is not an HWP/OLE document');
}
const result = await extractHwp(bytes, 'public-test-fixture.hwp');
if (typeof result !== 'string' || result.trim().length < 5) {
  throw new Error('HWP parser returned no document text');
}
console.log('HWP_LAZY_IMPORT_AND_PARSE_PASSED');
