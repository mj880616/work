import test from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.API_URL;
const key = process.env.ANON_KEY;
const stage = process.env.WEB2_TRANSITION_STAGE;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base ?? '') || !key || !['A','B','C'].includes(stage)) {
  throw new Error('Transition HTTP tests require a loopback local stack and a known stage');
}
const headers = {apikey:key,Authorization:`Bearer ${key}`};
const slugs = [
  'bus-strike-publicness-internal-archive-202609',
  'gimpo-publicization','gimpo-publicization-audit',
  'gimpo-publicization-press-1008','line9-publicization',
  'line9-publicization-audit','private-rail-forum-0929-prep',
];
async function read(path, options = {}) {
  const {headers: extraHeaders, ...requestOptions} = options;
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...requestOptions,headers:{...headers,...extraHeaders},
  });
  assert.equal(response.status, 200, `${stage}: unexpected HTTP status ${response.status}`);
  return response.json();
}

test(`transition ${stage}: current static anonymous page route retains seven URLs`, async () => {
  for (const slug of slugs) {
    const rows = await read(`app_pages?slug=eq.${encodeURIComponent(slug)}&select=slug&limit=1`);
    assert.equal(rows.length, 1, `${stage}: old static route lost a public URL`);
  }
  const privateRows = await read('app_pages?slug=eq.local-private-post&select=slug&limit=1');
  assert.equal(privateRows.length, 0);
});

if (stage !== 'A') test(`transition ${stage}: new client public RPC and project API work`, async () => {
  for (const slug of slugs) {
    const rows = await read('rpc/app_public_post', {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_slug:slug}),
    });
    assert.equal(rows.length, 1, `${stage}: new public RPC lost a public URL`);
  }
  const privateRows = await read('rpc/app_public_post', {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_slug:'local-private-post'}),
  });
  assert.equal(privateRows.length, 0);
  const project = await read('rpc/app_public_project', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({p_slug:'project-90000000000040008000000000000020'}),
  });
  assert.equal(project, null, 'private project became public before explicit publication');
});
