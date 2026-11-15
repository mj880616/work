#!/usr/bin/env node
// Print only fixed diagnostic labels and numeric resource measurements. Never
// print raw Supabase/Docker output: those commands may contain local keys or URLs.
import {readFileSync, existsSync, statfsSync} from 'node:fs';
import {totalmem, freemem} from 'node:os';
import {spawnSync} from 'node:child_process';

const [mode, logFile] = process.argv.slice(2);
const labels = ['db', 'auth', 'rest', 'realtime', 'storage', 'imgproxy', 'meta',
  'studio', 'kong', 'analytics', 'vector', 'inbucket', 'functions', 'pooler'];
const safeRun = (command, args, timeout = 10000) => {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout, maxBuffer: 1024 * 1024});
  return {ok: result.status === 0, output: result.stdout ?? ''};
};
const gib = bytes => (bytes / 1024 ** 3).toFixed(2);
const availableMemory = () => {
  try {
    const value = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'));
    return value ? Number(value[1]) * 1024 : freemem();
  } catch { return freemem(); }
};
const resources = () => {
  console.log(`RUNNER_RAM_TOTAL_GIB=${gib(totalmem())}`);
  console.log(`RUNNER_RAM_AVAILABLE_GIB=${gib(availableMemory())}`);
  try {
    const stat = statfsSync('/');
    console.log(`RUNNER_DISK_FREE_GIB=${gib(Number(stat.bavail) * Number(stat.bsize))}`);
  } catch { console.log('RUNNER_DISK_FREE_GIB=UNAVAILABLE'); }
};
const serviceFrom = value => labels.find(label => new RegExp(`supabase[_-]${label}(?:[_-]|\\b)`, 'i').test(value));

if (mode === 'classify' || mode === 'failure') {
  let log = '';
  try { log = readFileSync(logFile, 'utf8'); } catch { /* missing startup output */ }
  const categories = [
    ['RUNNER_DISK', /no space left on device|disk quota exceeded|ENOSPC/i],
    ['RUNNER_MEMORY', /out of memory|oomkilled|cannot allocate memory|memory limit exceeded/i],
    ['DOCKER_DAEMON', /cannot connect to the docker daemon|docker daemon is not running/i],
    ['IMAGE_PULL_FAILED', /failed to pull|pull access denied|manifest unknown|failed to resolve reference|error pulling image|failed to register layer/i],
    ['HEALTH_CHECK_FAILED', /unhealthy|not healthy|health check failed|timed out waiting for health/i],
    ['CONTAINER_START_FAILED', /failed to start container|container .* exited|port is already allocated|bind: address already in use|error starting userland proxy/i],
    ['SUPABASE_CONFIG', /invalid config|failed to parse config|config.toml.*(error|invalid)|cannot find project ref/i],
  ];
  let category = categories.find(([, pattern]) => pattern.test(log))?.[0] ?? 'OTHER';
  let service = serviceFrom(log) ?? 'UNIDENTIFIED';
  if (mode === 'failure') {
    resources();
    const docker = safeRun('docker', ['ps', '-a', '--format', '{{json .}}']);
    console.log(`DOCKER_PS_AVAILABLE=${docker.ok}`);
    if (docker.ok) {
      for (const line of docker.output.split('\n')) {
        try {
          const item = JSON.parse(line);
          if (!/^supabase[_-]/i.test(item.Names ?? '')) continue;
          const detected = serviceFrom(item.Names);
          if (!detected) continue;
          const state = /^(running|exited|created|dead|restarting|paused)$/i.test(item.State) ? item.State.toLowerCase() : 'unknown';
          const health = /\(unhealthy\)/i.test(item.Status) ? 'unhealthy' :
            /\(healthy\)/i.test(item.Status) ? 'healthy' :
              /\(health: starting\)/i.test(item.Status) ? 'starting' : 'unknown';
          console.log(`LOCAL_CONTAINER=${detected} STATE=${state} HEALTH=${health}`);
          if (category === 'OTHER' && health === 'unhealthy') category = 'HEALTH_CHECK_FAILED';
          if (category === 'OTHER' && state === 'exited') category = 'CONTAINER_START_FAILED';
          if (category === 'CONTAINER_START_FAILED' && /Exited \(137\)/.test(item.Status)) category = 'RUNNER_MEMORY_SUSPECTED';
          if (service === 'UNIDENTIFIED' && (health === 'unhealthy' || state === 'exited')) service = detected;
        } catch { /* skip malformed lines without exposing them */ }
      }
    }
    // Status can contain keys and connection strings; only report its exit code.
    console.log(`SUPABASE_STATUS_AVAILABLE=${safeRun('supabase', ['status']).ok}`);
  }
  console.log(`LOCAL_START_CATEGORY=${category}`);
  console.log(`LOCAL_START_SERVICE=${service}`);
} else if (mode === 'preflight') {
  resources();
  const dockerCli = safeRun('docker', ['--version']);
  const daemon = dockerCli.ok && safeRun('docker', ['info']).ok;
  console.log(`DOCKER_CLI_AVAILABLE=${dockerCli.ok}`);
  console.log(`DOCKER_DAEMON_AVAILABLE=${daemon}`);
  const cli = safeRun('supabase', ['--version']);
  const version = cli.output.trim().match(/^\d+\.\d+\.\d+$/)?.[0] ?? 'UNAVAILABLE';
  console.log(`SUPABASE_CLI_VERSION=${version}`);
  console.log(`SUPABASE_PROJECT_CONFIG_PRESENT=${existsSync('supabase/config.toml')}`);
  if (!daemon || !cli.ok || !existsSync('supabase/config.toml')) process.exitCode = 1;
} else {
  console.error('Expected preflight, classify or failure mode');
  process.exitCode = 2;
}
