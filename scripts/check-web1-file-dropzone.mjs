import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const excluded = /^(?:\.github|app|android-app|windows-app|tests)\//;
const fileInput = /\btype\s*=\s*\\?["']file\\?["']/i;
const helper = '/work/assets/file-dropzone.js';

export function missingDropzones(files) {
  return files
    .filter(([path, html]) => !excluded.test(path) && fileInput.test(html) && !html.includes(helper))
    .map(([path]) => path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const listed = spawnSync('git', ['ls-files', '-z', '--', '*.html'], { encoding: 'utf8' });
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr || 'Could not list tracked HTML files.\n');
    process.exitCode = 1;
  } else {
    const paths = listed.stdout.split('\0').filter(Boolean);
    const missing = missingDropzones(paths.map(path => [path, readFileSync(path, 'utf8')]));
    if (missing.length) {
      console.error('Web1 upload pages missing the shared dropzone helper:');
      for (const path of missing) console.error(`- ${path}`);
      console.error('Add <script src="/work/assets/file-dropzone.js?v=20260913"></script> before </body> in each listed HTML file, then update the PR.');
      process.exitCode = 1;
    } else {
      console.log(`Checked ${paths.length} tracked HTML files; all Web1 upload pages have the dropzone helper.`);
    }
  }
}
