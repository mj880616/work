import { readFileSync } from 'node:fs';

// Keep the order in sync with Verify production routes' read command.
const references = [
  ['app/index.html', 'app.js', String.raw`<script\b[^>]*\bsrc\s*=\s*`],
  ['app/app.js', 'loader-v2.js', String.raw`\bimport\s*\(\s*`],
  ['app/loader-v2.js', 'pwa.js', String.raw`\bimport\s*\(\s*`],
  ['app/pwa.js', 'sw.js', String.raw`\bserviceWorker\s*\.\s*register\s*\(\s*`],
  ['app/index.html', 'app-icon.svg', String.raw`\b(?:href|src)\s*=\s*`],
];

try {
  const urls = references.map(([file, asset, prefix]) => {
    const source = readFileSync(file, 'utf8');
    const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${prefix}(['"])\\./${escapedAsset}\\?v=([^'"\\s]*)\\1`, 'g');
    const versions = [...source.matchAll(pattern)].map(match => match[2]);
    if (versions.length === 0 || versions.some(version => !/^[A-Za-z0-9._-]+$/.test(version))) {
      throw new Error(`${file}: missing, empty or invalid ${asset}?v= reference`);
    }
    if (new Set(versions).size !== 1) {
      throw new Error(`${file}: conflicting ${asset}?v= references`);
    }
    return `https://desk.bokdoong.com/work/app/${asset}?v=${versions[0]}`;
  });
  // Emit nothing unless every reference has passed validation.
  console.log(urls.join('\t'));
} catch (error) {
  console.error(`FAIL  production route URL extraction: ${error.message}`);
  process.exitCode = 1;
}
