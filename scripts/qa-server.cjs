// Isolated manual testing: real app code, disposable accounts, no MongoDB writes.
process.env.NODE_ENV = 'test';
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../app');
const port = Number(process.env.QA_PORT || 3100);
const app = createApp({
  useDatabase: false,
  jwtSecret: crypto.randomBytes(48).toString('hex'),
  tempDir: path.join(__dirname, '../temp_downloads/manual-qa')
});
app
  .listen(port, '127.0.0.1', () =>
    console.log(
      `QA app: http://127.0.0.1:${port} (temporary accounts, no database)`
    )
  )
  .on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
