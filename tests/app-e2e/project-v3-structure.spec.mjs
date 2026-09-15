import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const read=path=>readFileSync(resolve(here,'../..',path),'utf8');

test('project view has one active renderer and no legacy overlay chain', async () => {
  const loader=read('app/loader-v2.js');
  expect(loader).toContain("project-system-v3.js");
  for(const legacy of [
    'project-system-v2.js','project-hide-legacy.js','project-files.js','project-delete.js',
    'project-modal-polish.js','project-modal-scroll-lock.js','project-access.js',
    'project-update-actions.js','project-task-link.js','project-v2.js','project-operating-model.js',
    'project-templates.js','project-deeplink.js','project-archive.js','project-suborganization-links.js'
  ]) expect(loader).not.toContain(legacy);
});

test('project V3 includes required management actions', async () => {
  const src=read('app/project-system-v3.js');
  expect(src).toContain('data-ps3-delete-project');
  expect(src).toContain('data-ps3-edit-milestone');
  expect(src).toContain('ps3MilestoneDelete');
  expect(src).toContain('data-ps3-library');
  expect(src).toContain('ps3-parent-link');
  expect(src).toContain('data-ps3-doc-filter');
});

test('startup CSS prevents old project cards and old brand mark from painting', async () => {
  const styles=read('app/styles.css');
  const projectCss=read('app/project-system-v3.css');
  expect(styles).toContain('project-system-v3.css');
  expect(projectCss).toContain("app-icon.svg");
  expect(projectCss).toContain('#projectGrid>[data-project]{display:none!important}');
});
