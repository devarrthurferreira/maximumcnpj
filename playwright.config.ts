import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 45000,
  reporter: [['list'], ['html', {open:'never'}]],
  use: {baseURL:'http://127.0.0.1:3100',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer: {command:'node dist/server.js',url:'http://127.0.0.1:3100/api/health',reuseExistingServer:false,env:{PORT:'3100',APP_ORIGIN:'http://127.0.0.1:3100'}}
});
