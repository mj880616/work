import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Reads the release chain from the build-pages.mjs output folder given as the only argument (what
// GitHub Pages serves). The checkout has no ?v= since CI-버전자동화 3단계, so it is refused.
// `--host bokdoong.com` gives the same URLs on bokdoong.com, where Web2 also opens since DOMAIN-주소이전 ①-E5.
const WEB2_HOSTS = ['desk.bokdoong.com', 'bokdoong.com'];
const [root, ...extra] = process.argv.slice(2);
const host = extra.length === 2 && extra[0] === '--host' ? extra[1] : (extra.length ? null : WEB2_HOSTS[0]);

// Keep the order in sync with Verify production routes' read command.
const references = [
  ['app/index.html', 'app.js', String.raw`<script\b[^>]*\bsrc\s*=\s*`],
  ['app/app.js', 'loader-v2.js', String.raw`\bimport\s*\(\s*`],
  ['app/loader-v2.js', 'pwa.js', String.raw`\bimport\s*\(\s*`],
  ['app/pwa.js', 'sw.js', String.raw`\bserviceWorker\s*\.\s*register\s*\(\s*`],
  ['app/index.html', 'app-icon.svg', String.raw`\b(?:href|src)\s*=\s*`],
];

try {
  if (!root || root.startsWith('--') || !WEB2_HOSTS.includes(host)) {
    throw new Error(`usage: node scripts/cloudflare-check-urls.mjs <pages-build-output> [--host ${WEB2_HOSTS.join('|')}]`);
  }
  const urls = references.map(([file, asset, prefix]) => {
    const source = readFileSync(resolve(root, file), 'utf8');
    const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${prefix}(['"])\\./${escapedAsset}\\?v=([^'"\\s]*)\\1`, 'g');
    const versions = [...source.matchAll(pattern)].map(match => match[2]);
    if (versions.length === 0 || versions.some(version => !/^[A-Za-z0-9._-]+$/.test(version))) {
      throw new Error(`${file}: missing, empty or invalid ${asset}?v= reference`);
    }
    if (new Set(versions).size !== 1) {
      throw new Error(`${file}: conflicting ${asset}?v= references`);
    }
    return `https://${host}/work/app/${asset}?v=${versions[0]}`;
  });
  // Emit nothing unless every reference has passed validation.
  console.log(urls.join('\t'));
} catch (error) {
  console.error(`FAIL  production route URL extraction: ${error.message}`);
  process.exitCode = 1;
}
