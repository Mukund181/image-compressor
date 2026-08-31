require('dotenv').config();
const { createApp } = require('./app');
const connectDB = require('./config/db');

async function start() {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer between 1 and 65535.');
  await connectDB();
  const server = app.listen(port, () =>
    console.log(`OmniTools is running at http://127.0.0.1:${port}`)
  );
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Stop the other process or set PORT explicitly.`
        : error.message
    );
    process.exitCode = 1;
    require('mongoose')
      .disconnect()
      .catch(() => {});
  });
  return server;
}

if (require.main === module)
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
    require('mongoose')
      .disconnect()
      .catch(() => {});
  });
module.exports = { createApp, start };
