const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
process.env.NODE_ENV = 'test';
const { createApp } = require('../app');
const sharp = require('sharp');
const { Document, Paragraph, Packer } = require('docx');
const { PDFDocument } = require('pdf-lib');
const { parsePdf: pdfParse } = require('../lib/pdf');
const mammoth = require('mammoth');
const JSZip = require('jszip');

async function setup(t, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitools-test-'));
  const server = createApp({
    useDatabase: false,
    documentConverter: 'text',
    jwtSecret: 'test-secret-with-at-least-32-characters',
    tempDir,
    ...options
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempDir).startsWith('omnitools-test-'));
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const cookies = new Map();
  async function request(url, options = {}) {
    const response = await fetch(base + url, {
      ...options,
      headers: {
        cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join('; '),
        ...options.headers
      }
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      cookies.set(
        pair.slice(0, pair.indexOf('=')),
        pair.slice(pair.indexOf('=') + 1)
      );
    }
    return response;
  }
  const post = (url, body) =>
    request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  async function upload(url, field, buffer, name, extra = {}) {
    const form = new FormData();
    form.append(field, new Blob([buffer]), name);
    for (const [key, value] of Object.entries(extra)) form.append(key, value);
    return request(url, { method: 'POST', body: form });
  }
  async function login() {
    const response = await post('/api/auth/register', {
      name: 'Tester',
      email: 'test+tag@example.technology',
      password: 'correct-password'
    });
    assert.equal(response.status, 201, await response.text());
  }
  return { request, post, upload, login, tempDir };
}

test('offline accounts verify passwords, normalize email, reject duplicates, and log out', async (t) => {
  const { post, request } = await setup(t);
  assert.equal(
    (
      await post('/api/auth/login', {
        email: 'nobody@example.com',
        password: 'anything'
      })
    ).status,
    401
  );
  const account = {
    name: 'Tester',
    email: ' Test+tag@Example.technology ',
    password: 'secret123'
  };
  assert.equal((await post('/api/auth/register', account)).status, 201);
  assert.equal((await post('/api/auth/register', account)).status, 409);
  await post('/api/auth/logout', {});
  assert.equal(
    (await (await request('/api/auth/me')).json()).authenticated,
    false
  );
  assert.equal(
    (await post('/api/auth/login', { ...account, password: 'wrong' })).status,
    401
  );
  assert.equal((await post('/api/auth/login', account)).status, 200);
  assert.equal(
    (await (await request('/api/auth/me')).json()).authenticated,
    true
  );
  assert.equal(
    (
      await post('/api/auth/register', {
        name: 'X',
        email: {},
        password: 'secret123'
      })
    ).status,
    400
  );
});

test('configured but unavailable database fails closed', async (t) => {
  const { post, request } = await setup(t, { useDatabase: true });
  assert.equal(
    (
      await post('/api/auth/login', {
        email: 'test@example.com',
        password: 'password'
      })
    ).status,
    503
  );
  assert.equal(
    (
      await post('/api/auth/register', {
        name: 'Tester',
        email: 'test@example.com',
        password: 'password'
      })
    ).status,
    503
  );
  assert.equal((await request('/api/health')).status, 503);
});

test('failed operations preserve quota; successful operations stop at five', async (t) => {
  const { post, request } = await setup(t);
  await request('/api/auth/me');
  for (let i = 0; i < 6; i++)
    assert.equal((await post('/api/compress/image', {})).status, 400);
  assert.equal(
    (await (await request('/api/auth/me')).json()).quotaRemaining,
    5
  );
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await post('/api/url/shorten', {
          originalUrl: 'https://example.com',
          customAlias: `quota-${i}`
        })
      ).status,
      200
    );
  const blocked = await post('/api/url/shorten', {
    originalUrl: 'https://example.com'
  });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).quotaExceeded, true);
});

test('parallel operations cannot exceed a guest session quota', async (t) => {
  const { post, request } = await setup(t);
  await request('/api/auth/me');
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      post('/api/url/shorten', {
        originalUrl: 'example.com',
        customAlias: `parallel-${i}`
      })
    )
  );
  assert.equal(results.filter((response) => response.status === 200).length, 5);
  assert.equal(results.filter((response) => response.status === 403).length, 3);
});

test('short links reject collisions and unsafe input without overwriting targets', async (t) => {
  const { post, request, login } = await setup(t);
  await login();
  assert.equal(
    (
      await post('/api/url/shorten', {
        originalUrl: 'example.com/first',
        customAlias: 'keep-me'
      })
    ).status,
    200
  );
  assert.equal(
    (
      await post('/api/url/shorten', {
        originalUrl: 'https://example.org/second',
        customAlias: 'keep-me'
      })
    ).status,
    409
  );
  const redirect = await request('/s/keep-me', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/first');
  for (const body of [
    { originalUrl: {} },
    { originalUrl: 'javascript:alert(1)' },
    { originalUrl: 'ftp://example.com' },
    { originalUrl: 'https://example.com', customAlias: {} },
    { originalUrl: 'https://example.com', customAlias: 'bad alias' }
  ])
    assert.equal((await post('/api/url/shorten', body)).status, 400);
});

test('all image output formats match downloaded bytes and resized dimensions', async (t) => {
  const { upload, request, login } = await setup(t);
  await login();
  const input = await sharp({
    create: { width: 80, height: 40, channels: 4, background: '#ff000080' }
  })
    .png()
    .toBuffer();
  for (const format of ['jpeg', 'png', 'webp', 'avif']) {
    const response = await upload(
      '/api/compress/image',
      'images',
      input,
      'picture.png',
      { format, width: '40', quality: '80' }
    );
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    const download = await request(data.files[0].downloadUrl);
    assert.match(download.headers.get('content-disposition'), /attachment/);
    const metadata = await sharp(
      Buffer.from(await download.arrayBuffer())
    ).metadata();
    assert.equal(metadata.format, format === 'avif' ? 'heif' : format);
    assert.equal(metadata.width, 40);
    assert.equal(metadata.height, 20);
    assert.equal(data.files[0].filePath, undefined);
  }
});

async function gradientPng() {
  const width = 256;
  const height = 160;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = (x + Math.floor(y / 2)) % 256;
      pixels[offset + 1] = (x * 3 + y) % 256;
      pixels[offset + 2] = Math.round(128 + 64 * Math.sin(x / 11) + 60 * Math.sin(y / 13));
      pixels[offset + 3] = x < 12 || y < 8 ? 0 : 255;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
}

test('PNG presets give different savings, preserve size/transparency, and keep high quality lossless', async (t) => {
  const { upload, request } = await setup(t);
  const input = await gradientPng();
  const originalPixels = await sharp(input).ensureAlpha().raw().toBuffer();
  const sizes = [];
  for (const quality of [35, 80, 92]) {
    const response = await upload('/api/compress/image', 'images', input, 'gradient.png', { quality: String(quality) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    const file = data.files[0];
    const output = Buffer.from(await (await request(file.downloadUrl)).arrayBuffer());
    const meta = await sharp(output).metadata();
    assert.equal(meta.width, 256);
    assert.equal(meta.height, 160);
    assert.equal(meta.hasAlpha, true);
    assert.equal(file.quality, quality);
    assert.equal(file.compressedSize, output.length);
    sizes.push(output.length);
    const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
    assert.equal(pixels[3], 0);
    assert.equal(pixels[(80 * 256 + 128) * 4 + 3], 255);
    if (quality === 92) {
      assert.deepEqual(pixels, originalPixels);
      assert.equal(file.compressionMode, 'Lossless PNG');
    } else {
      assert.equal(meta.isPalette, true);
      assert.equal(file.compressionMode, 'Reduced-colour PNG');
    }
  }
  assert.ok(sizes[0] < sizes[1], `Max Savings must be smaller than Balanced: ${sizes}`);
  assert.ok(sizes[1] < sizes[2], `Balanced must be smaller than High Quality: ${sizes}`);
});

test('high quality never secretly recompresses an already-smaller JPEG at a lower quality', async (t) => {
  const { upload, request } = await setup(t);
  const input = await sharp(await gradientPng())
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  const response = await upload('/api/compress/image', 'images', input, 'optimized.jpg', { quality: '92' });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  const file = data.files[0];
  assert.equal(file.retainedOriginal, true);
  assert.equal(file.quality, 92);
  assert.equal(file.savedPercentage, 0);
  assert.deepEqual(Buffer.from(await (await request(file.downloadUrl)).arrayBuffer()), input);
});

test('original images do not grow and invalid options/uploads return JSON errors', async (t) => {
  const { upload, request } = await setup(t);
  const input = await sharp({
    create: { width: 1, height: 1, channels: 3, background: 'red' }
  })
    .png()
    .toBuffer();
  const response = await upload(
    '/api/compress/image',
    'images',
    input,
    'tiny.png'
  );
  const data = await response.json();
  assert.equal(response.status, 200);
  const output = Buffer.from(
    await (await request(data.files[0].downloadUrl)).arrayBuffer()
  );
  assert.ok(output.length <= input.length);
  for (const extra of [
    { quality: '0' },
    { quality: '101' },
    { width: '-1' },
    { format: 'invalid' }
  ])
    assert.equal(
      (await upload('/api/compress/image', 'images', input, 'tiny.png', extra))
        .status,
      400
    );
  assert.equal(
    (
      await upload(
        '/api/compress/image',
        'images',
        Buffer.from('not an image'),
        'fake.png'
      )
    ).status,
    400
  );
  const unexpected = await upload(
    '/api/compress/image',
    'wrongField',
    input,
    'tiny.png'
  );
  assert.equal(unexpected.status, 400);
  assert.match(unexpected.headers.get('content-type'), /json/);
});

test('DOCX to PDF to DOCX preserves actual document text', async (t) => {
  const { upload, request, login } = await setup(t);
  await login();
  const input = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph('Hello DOCX & café <testing>'),
            new Paragraph('Second paragraph.')
          ]
        }
      ]
    })
  );
  const response = await upload(
    '/api/pdf/word-to-pdf',
    'document',
    input,
    'source.docx'
  );
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  const pdf = Buffer.from(
    await (await request(data.file.downloadUrl)).arrayBuffer()
  );
  const extracted = await pdfParse(pdf);
  assert.match(extracted.text, /Hello DOCX & café <testing>/);
  const back = await upload(
    '/api/pdf/pdf-to-word',
    'pdf',
    pdf,
    'roundtrip.pdf'
  );
  const backData = await back.json();
  assert.equal(back.status, 200, JSON.stringify(backData));
  const word = Buffer.from(
    await (await request(backData.file.downloadUrl)).arrayBuffer()
  );
  assert.match(
    (await mammoth.extractRawText({ buffer: word })).value,
    /Second paragraph\./
  );
});

test('documents report unsupported inputs and wrap long text over multiple pages', async (t) => {
  const { post, upload, request, login } = await setup(t);
  await login();
  for (const text of ['', {}, 'Hello 😀']) {
    const response = await post('/api/pdf/word-to-pdf', { text });
    assert.ok([400, 422].includes(response.status));
  }
  assert.equal(
    (
      await upload(
        '/api/pdf/word-to-pdf',
        'document',
        Buffer.from('invalid'),
        'fake.docx'
      )
    ).status,
    400
  );
  assert.equal(
    (
      await upload(
        '/api/pdf/word-to-pdf',
        'document',
        Buffer.from('legacy'),
        'legacy.doc'
      )
    ).status,
    400
  );
  const emptyPdf = await PDFDocument.create();
  emptyPdf.addPage();
  assert.equal(
    (
      await upload(
        '/api/pdf/pdf-to-word',
        'pdf',
        await emptyPdf.save(),
        'scan.pdf'
      )
    ).status,
    422
  );
  const response = await post('/api/pdf/word-to-pdf', {
    text: 'LongWord'.repeat(3000)
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.ok(data.file.pageCount > 1);
  assert.ok(
    (
      await PDFDocument.load(
        await (await request(data.file.downloadUrl)).arrayBuffer()
      )
    ).getPageCount() > 1
  );
});

test('video conversion produces an actual MP4 and rejects invalid video', async (t) => {
  const { upload, request, login, tempDir } = await setup(t);
  await login();
  const fixture = path.join(tempDir, 'fixture.webm');
  const binary = require('ffmpeg-static');
  await promisify(execFile)(
    binary,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=65x49:rate=2',
      '-t',
      '1',
      '-c:v',
      'libvpx-vp9',
      fixture
    ],
    { windowsHide: true }
  );
  const response = await upload(
    '/api/compress/video',
    'video',
    await fs.readFile(fixture),
    'a & weird video.webm'
  );
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  const output = Buffer.from(
    await (await request(data.file.downloadUrl)).arrayBuffer()
  );
  assert.equal(output.subarray(4, 8).toString(), 'ftyp');
  assert.equal(
    (
      await upload(
        '/api/compress/video',
        'video',
        Buffer.from('invalid'),
        'fake.webm'
      )
    ).status,
    422
  );
  assert.ok(
    !(await fs.readdir(tempDir)).some(
      (name) => name.endsWith('_raw.input') || name.endsWith('_output.mp4')
    )
  );
});

test('missing FFmpeg reports unavailable instead of returning an unconverted file', async (t) => {
  const { upload } = await setup(t, {
    ffmpegPath: path.join(os.tmpdir(), 'omnitools-no-such-ffmpeg')
  });
  assert.equal(
    (
      await upload(
        '/api/compress/video',
        'video',
        Buffer.from('video'),
        'video.mp4'
      )
    ).status,
    503
  );
});

test('ZIP keeps duplicate filenames, validates IDs, and handles missing files', async (t) => {
  const { post, request, login } = await setup(t);
  await login();
  const files = [];
  for (const text of ['First file', 'Second file'])
    files.push(
      (await (await post('/api/pdf/word-to-pdf', { text })).json()).file
    );
  const response = await post('/api/download-zip', {
    fileIds: files.map((file) => file.fileId)
  });
  assert.equal(response.status, 200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  assert.equal(Object.keys(zip.files).length, 2);
  assert.ok(zip.files['document-converted (2).pdf']);
  assert.equal(
    (await post('/api/download-zip', { fileIds: ['../server.js'] })).status,
    400
  );
  assert.equal(
    (await post('/api/download-zip', { fileIds: ['a'.repeat(24)] })).status,
    404
  );
  assert.equal((await request('/api/download/not-an-id')).status, 404);
  const missing = await request('/api/not-a-route');
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /json/);
});
