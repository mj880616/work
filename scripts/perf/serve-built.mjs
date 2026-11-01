// PERF-첫로딩 측정용 정적 서버(docs/design/first-load.md 2장). 운영(Cloudflare 라우터)과 같은 캐시 머리말을 흉내 낸다:
// ?v=가 붙은 주소는 "1년·immutable", 나머지(HTML 등)는 "no-cache"(매번 확인). 로컬 측정에서만 쓴다.
// 사용법: node scripts/perf/serve-built.mjs <빌드 폴더> [포트=8126]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';

const [root = '.', port = '8126'] = process.argv.slice(2);
const base = resolve(root);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  let path = normalize(join(base, decodeURIComponent(url.pathname)));
  if (!path.startsWith(base)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Cache-Control': url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
    });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(Number(port), '127.0.0.1', () => console.log(`serve-built: http://127.0.0.1:${port}/ ← ${base}`));
