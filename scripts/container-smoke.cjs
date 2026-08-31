// Feed this script to `node` inside the built image; no external services are used.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { once } = require('node:events');

(async () => {
  assert.equal(
    require('node:fs').existsSync('.env'),
    false,
    'Secrets must not be baked into the image'
  );
  assert.equal(
    require('node:fs').existsSync('node_modules/jsdom'),
    false,
    'Development dependencies must not be packaged'
  );
  const { createApp } = require('./app');
  const sharp = require('sharp');
  const server = createApp({ useDatabase: false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const input = await sharp({
      create: { width: 40, height: 20, channels: 3, background: 'red' }
    })
      .png()
      .toBuffer();
    const images = new FormData();
    images.append('images', new Blob([input]), 'image.png');
    images.append('format', 'webp');
    const result = await fetch(`${base}/api/compress/image`, {
      method: 'POST',
      body: images
    });
    const data = await result.json();
    assert.equal(result.status, 200, JSON.stringify(data));
    const output = Buffer.from(
      await (await fetch(base + data.files[0].downloadUrl)).arrayBuffer()
    );
    assert.equal((await sharp(output).metadata()).format, 'webp');

    const inputPath = '/tmp/omnitools-smoke.webm';
    await promisify(execFile)(process.env.FFMPEG_PATH, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=64x48:rate=2',
      '-t',
      '1',
      '-c:v',
      'libvpx-vp9',
      '-threads',
      '1',
      inputPath
    ]);
    const videos = new FormData();
    videos.append(
      'video',
      new Blob([await fs.readFile(inputPath)]),
      'video.webm'
    );
    const videoResult = await fetch(`${base}/api/compress/video`, {
      method: 'POST',
      body: videos
    });
    const videoData = await videoResult.json();
    assert.equal(videoResult.status, 200, JSON.stringify(videoData));
    const videoOutput = Buffer.from(
      await (await fetch(base + videoData.file.downloadUrl)).arrayBuffer()
    );
    assert.equal(videoOutput.subarray(4, 8).toString(), 'ftyp');
    const documentResult = await fetch(`${base}/api/pdf/word-to-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'DevOps \u2192 CI/CD \u2713' })
    });
    const documentData = await documentResult.json();
    assert.equal(documentResult.status, 200, JSON.stringify(documentData));
    assert.equal(documentData.file.conversionEngine, 'libreoffice');
    const documentOutput = Buffer.from(
      await (await fetch(base + documentData.file.downloadUrl)).arrayBuffer()
    );
    const { parsePdf } = require('./lib/pdf');
    assert.match((await parsePdf(documentOutput)).text, /DevOps/);
    console.log(
      'Container smoke passed: health, native Sharp, WebP download, FFmpeg/MP4, LibreOffice/Unicode PDF, no .env, no dev dependencies.'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
