const { test } = require('node:test');
const assert = require('node:assert/strict');
const { textToPdf } = require('../lib/documents');
const { parsePdf } = require('../lib/pdf');

test('PDF extraction respects a buffer slice surrounded by unrelated bytes', async () => {
  const { buffer } = await textToPdf('Small PDF inside a larger buffer');
  const backing = Buffer.alloc(buffer.length + 256, 0x78);
  buffer.copy(backing, 128);
  const sliced = backing.subarray(128, 128 + buffer.length);
  assert.ok(sliced.byteOffset > 0);
  const result = await parsePdf(sliced);
  assert.equal(result.numpages, 1);
  assert.match(result.text, /Small PDF inside a larger buffer/);
});
