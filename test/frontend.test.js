const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(
  path.join(__dirname, '../public/index.html'),
  'utf8'
);
const source = fs.readFileSync(
  path.join(__dirname, '../public/js/app.js'),
  'utf8'
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data
});
const guest = { authenticated: false, guestUsage: 0, quotaRemaining: 5 };

async function setup(t, fetcher = async () => response(guest)) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    virtualConsole
  });
  t.after(() => dom.window.close());
  await new Promise((resolve) =>
    dom.window.document.addEventListener('DOMContentLoaded', resolve, {
      once: true
    })
  );
  dom.window.fetch = fetcher;
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await tick();
  assert.deepEqual(errors, []);
  return dom.window;
}

test('sign-in remains usable when the initial session request fails', async (t) => {
  const window = await setup(t, async () => {
    throw new Error('Offline');
  });
  window.document.getElementById('openAuthBtn').click();
  assert.equal(
    window.document.getElementById('authModal').classList.contains('hidden'),
    false
  );
});

test('account names are rendered as text rather than executable markup', async (t) => {
  const name = '<img id="injected" src=x onerror="alert(1)">';
  const window = await setup(t, async () =>
    response({ authenticated: true, user: { name } })
  );
  assert.equal(window.document.getElementById('injected'), null);
  assert.ok(
    window.document.getElementById('userAuthSection').textContent.includes(name)
  );
});

test('invalid server responses restore upload controls and show a useful error', async (t) => {
  const window = await setup(t, async (url) =>
    url === '/api/auth/me'
      ? response(guest)
      : {
          ok: false,
          status: 502,
          json: async () => {
            throw new Error('Unexpected token <');
          }
        }
  );
  const input = window.document.getElementById('imgInput');
  Object.defineProperty(input, 'files', {
    value: [new window.File(['image'], 'sample.png', { type: 'image/png' })]
  });
  input.dispatchEvent(new window.Event('change'));
  assert.equal(input.disabled, true);
  await tick();
  assert.equal(input.disabled, false);
  assert.match(
    window.document.getElementById('toastContainer').textContent,
    /invalid response/
  );
});

test('result filenames are escaped and the same image can be selected again', async (t) => {
  let uploads = 0;
  const window = await setup(t, async (url) => {
    if (url === '/api/auth/me') return response(guest);
    uploads++;
    return response({
      files: [
        {
          outputFilename: '<img id="file-injected">.png',
          originalSizeFormatted: '5 KB',
          compressedSizeFormatted: '2 KB',
          savedPercentage: 60,
          downloadUrl: '/api/download/example'
        }
      ]
    });
  });
  const input = window.document.getElementById('imgInput');
  Object.defineProperty(input, 'files', {
    value: [new window.File(['image'], 'sample.png', { type: 'image/png' })]
  });
  input.dispatchEvent(new window.Event('change'));
  await tick();
  input.dispatchEvent(new window.Event('change'));
  await tick();
  assert.equal(uploads, 2);
  assert.equal(window.document.getElementById('file-injected'), null);
  assert.equal(window.document.querySelectorAll('.file-row').length, 2);
});

test('image presets send different quality settings and label each result with its own setting', async (t) => {
  const qualities = [];
  const window = await setup(t, async (url, options) => {
    if (url === '/api/auth/me') return response(guest);
    const quality = Number(options.body.get('quality'));
    qualities.push(quality);
    return response({ files: [{
      outputFilename: 'sample-compressed.png',
      originalSizeFormatted: '1 MB',
      compressedSizeFormatted: '200 KB',
      savedPercentage: 80,
      quality,
      compressionMode: quality >= 90 ? 'Lossless PNG' : 'Reduced-colour PNG',
      downloadUrl: '/api/download/example'
    }] });
  });
  const input = window.document.getElementById('imgInput');
  Object.defineProperty(input, 'files', {
    value: [new window.File(['image'], 'sample.png', { type: 'image/png' })]
  });
  for (const quality of [35, 80, 92]) {
    window.document.querySelector(`[data-val="${quality}"]`).click();
    assert.equal(window.document.getElementById('imgQualityValue').textContent, `${quality} / 100`);
    input.dispatchEvent(new window.Event('change'));
    await tick();
  }
  assert.deepEqual(qualities, [35, 80, 92]);
  const results = window.document.getElementById('imgList').textContent;
  for (const quality of qualities) assert.ok(results.includes(`Quality ${quality}/100`));
});

test('copying on HTTP reports clipboard failure instead of claiming success', async (t) => {
  const window = await setup(t);
  window.document.getElementById('shortUrlOutput').value =
    'http://localhost/s/example';
  window.document.execCommand = () => false;
  window.document.getElementById('copyUrlBtn').click();
  await tick();
  assert.match(
    window.document.getElementById('toastContainer').textContent,
    /Copy the selected link manually/
  );
});

test('document processing prevents duplicate submissions and keeps errors visible', async (t) => {
  let finish;
  let operations = 0;
  const window = await setup(t, async (url) => {
    if (url === '/api/auth/me') return response(guest);
    operations++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const document = window.document;
  document.getElementById('pdfTextInput').value = 'Example document';
  const button = document.getElementById('generatePdfBtn');
  button.click();
  button.click();
  assert.equal(operations, 1);
  assert.equal(document.getElementById('tabPdfToWord').disabled, true);
  assert.match(
    document.querySelector('#panel-pdf .operation-status').textContent,
    /Generating PDF/
  );
  finish(response({ error: 'Could not convert this document.' }, 422));
  await tick();
  assert.equal(button.disabled, false);
  assert.equal(document.getElementById('tabPdfToWord').disabled, false);
  assert.match(
    document.querySelector('#panel-pdf .operation-status.error').textContent,
    /Could not convert/
  );
});

test('switching PDF modes clears results from the previous converter', async (t) => {
  const window = await setup(t, async (url) =>
    url === '/api/auth/me'
      ? response(guest)
      : response({
          file: {
            outputFilename: 'document.pdf',
            downloadUrl: '/api/download/example',
            fileSizeFormatted: '1 KB'
          }
        })
  );
  const document = window.document;
  document.getElementById('tabWordToPdf').click();
  document.getElementById('pdfTextInput').value = 'Example document';
  document.getElementById('generatePdfBtn').click();
  await tick();
  assert.equal(
    document.getElementById('pdfResultsCard').classList.contains('hidden'),
    false
  );
  document.getElementById('tabPdfToWord').click();
  assert.equal(
    document.getElementById('pdfResultsCard').classList.contains('hidden'),
    true
  );
});

test('a pending short-link request cannot be submitted twice', async (t) => {
  let operations = 0;
  let finish;
  const window = await setup(t, async (url) => {
    if (url === '/api/auth/me') return response(guest);
    operations++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const form = window.document.getElementById('urlForm');
  window.document.getElementById('longUrlInput').value = 'https://example.com';
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(operations, 1);
  finish(response({ error: 'Alias already taken.' }, 409));
  await tick();
  assert.equal(form.querySelector('button[type="submit"]').disabled, false);
  assert.match(
    window.document.querySelector('#panel-shortener .operation-status.error')
      .textContent,
    /Alias already taken/
  );
});
