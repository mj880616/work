import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(resolve(import.meta.dirname, '../../app/pwa.js'), 'utf8');

function runPwa(readyState) {
  const registrations = [];
  const loadHandlers = [];
  const document = {
    readyState,
    head: { appendChild() {} },
    querySelector() { return null; },
    createElement() { return {}; }
  };
  const window = {
    addEventListener(type, handler) {
      if (type === 'load') loadHandlers.push(handler);
    }
  };
  const navigator = {
    serviceWorker: {
      register(script, options) {
        registrations.push({ script, scope: options.scope });
        return Promise.resolve();
      }
    }
  };
  vm.runInNewContext(source, { document, window, navigator });
  return { registrations, loadHandlers };
}

test('Web2 registers its scoped service worker when the deferred module loads after window load', () => {
  const { registrations, loadHandlers } = runPwa('complete');
  assert.deepEqual(registrations, [{ script: './sw.js?v=3', scope: './' }]);
  assert.equal(loadHandlers.length, 0);
});

test('Web2 waits for window load when the PWA module runs earlier', () => {
  const { registrations, loadHandlers } = runPwa('loading');
  assert.equal(registrations.length, 0);
  assert.equal(loadHandlers.length, 1);
  loadHandlers[0]();
  assert.deepEqual(registrations, [{ script: './sw.js?v=3', scope: './' }]);
});
