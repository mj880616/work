import {defineConfig} from '@playwright/test';

export default defineConfig({
  use:{baseURL:'http://127.0.0.1:8123'},
  workers:1,
  retries:0
});
