import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';

const output = process.argv[2];
const api = process.env.API_URL;
const serviceKey = process.env.SERVICE_ROLE_KEY;
const anonKey = process.env.ANON_KEY;
if (!output || !api || !serviceKey || !anonKey) throw new Error('Local Auth parameters are missing');
const parsed = new URL(api);
if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
  throw new Error('Auth fixture creation is limited to a loopback Supabase API');
}

const password = randomBytes(24).toString('base64url');
const definitions = [
  ['owner', '90000000-0000-4000-8000-000000000001'],
  ['viewer', '90000000-0000-4000-8000-000000000002'],
  ['outsider', '90000000-0000-4000-8000-000000000003'],
  ['admin', '90000000-0000-4000-8000-000000000004'],
];
const users = {};
for (const [name, id] of definitions) {
  const email = `web2-local-${name}@example.invalid`;
  const created = await fetch(new URL('/auth/v1/admin/users', api), {
    method: 'POST',
    headers: {apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({id, email, password, email_confirm: true}),
  });
  if (!created.ok) throw new Error(`Local Auth user creation failed for ${name}: HTTP ${created.status}`);
  const createdPayload = await created.json();
  const user = createdPayload.user ?? createdPayload;
  if (user.id !== id) throw new Error(`Local Auth returned an unexpected ID for ${name}`);

  const signedIn = await fetch(new URL('/auth/v1/token?grant_type=password', api), {
    method: 'POST',
    headers: {apikey: anonKey, 'Content-Type': 'application/json'},
    body: JSON.stringify({email, password}),
  });
  if (!signedIn.ok) throw new Error(`Local Auth sign-in failed for ${name}: HTTP ${signedIn.status}`);
  const session = await signedIn.json();
  if (!session.access_token) throw new Error(`Local Auth did not issue a token for ${name}`);
  users[name] = {id, accessToken: session.access_token};
}
writeFileSync(output, JSON.stringify(users), {mode: 0o600, flag: 'wx'});
console.log('Created four local-only Auth accounts');
