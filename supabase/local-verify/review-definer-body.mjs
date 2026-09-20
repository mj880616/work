#!/usr/bin/env node
// Render only selected SECURITY DEFINER bodies with comments, literals and
// numbers removed. Raw schema and unsanitized function bodies stay on runner.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const reviewed = new Set([
  'app_can_view_event', 'app_event_in_workspace', 'app_is_workspace_member',
  'app_user_in_workspace', 'app_workspace_role', 'app_can_edit_suborganization',
]);
const roleLiterals = new Set(['owner','admin','editor','author','viewer','edit','manage']);

export function redactBody(input) {
  let output = '';
  for (let i = 0; i < input.length;) {
    const char = input[i], next = input[i + 1];
    if (char === '-' && next === '-') {
      i += 2;
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unclosed SQL comment');
      i = end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let value = '';
      i++;
      let closed = false;
      while (i < input.length) {
        if (input[i] === quote) {
          if (input[i + 1] === quote) { value += quote; i += 2; continue; }
          i++; closed = true; break;
        }
        value += input[i++];
      }
      if (!closed) throw new Error('Unclosed SQL literal');
      output += quote === "'" && roleLiterals.has(value) ? `'${value}'` : '[REDACTED]';
      continue;
    }
    if (char === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(input.slice(i))?.[0];
      if (tag) {
        const end = input.indexOf(tag, i + tag.length);
        if (end < 0) throw new Error('Unclosed dollar literal');
        output += '[REDACTED]';
        i = end + tag.length;
        continue;
      }
    }
    if (/[0-9]/.test(char)) {
      while (i < input.length && /[0-9a-fA-F.:-]/.test(input[i])) i++;
      output += '#';
      continue;
    }
    output += char;
    i++;
  }
  return output;
}

export function summarizeDefiners(dump) {
  const sections = dump.split(/(?=^-- Name: .*?; Type: FUNCTION; Schema: private; Owner: )/m);
  const records = [];
  for (const section of sections) {
    const header = /^-- Name: (app_[a-z_]+)\([^\n]*; Type: FUNCTION; Schema: private; Owner: /m.exec(section);
    if (!header || !reviewed.has(header[1])) continue;
    if (!/SECURITY\s+DEFINER/i.test(section)) throw new Error('Reviewed helper is not SECURITY DEFINER');
    const marker = /\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(section);
    if (!marker) throw new Error('Function body marker missing');
    const start = marker.index + marker[0].length;
    const end = section.indexOf(marker[1], start);
    if (end < 0) throw new Error('Function body terminator missing');
    const body = section.slice(start, end);
    const safe = redactBody(body).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (safe.join('').length > 6500) throw new Error('Function review output too large');
    records.push({name: header[1], lines: safe,
      authUid: /\bauth\.uid\s*\(/i.test(body),
      calledHelpers: [...new Set([...body.matchAll(/\bprivate\.(app_[a-z_]+)\s*\(/gi)]
        .map(x => x[1]).filter(x => reviewed.has(x)))].sort()});
  }
  if (!records.some(x => x.name === 'app_can_view_event') ||
      !records.some(x => x.name === 'app_can_edit_suborganization')) {
    throw new Error('Target SECURITY DEFINER function missing');
  }
  return records;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const item of summarizeDefiners(readFileSync(process.argv[2], 'utf8'))) {
      console.log(`SAFE_DEFINER name=private.${item.name} auth_uid=${item.authUid} helpers=${item.calledHelpers.join(',') || 'none'}`);
      for (const line of item.lines) console.log(`SAFE_DEFINER_BODY ${item.name}: ${line}`);
    }
  } catch {
    console.error('SAFE_DEFINER_REVIEW_FAILED: raw source withheld');
    process.exitCode = 1;
  }
}
