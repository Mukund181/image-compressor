const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  WidthType
} = require('docx');
const { PDFDocument } = require('pdf-lib');
const { parsePdf: pdfParse } = require('../lib/pdf');
const { findOfficeExecutable, convertToPdf } = require('../lib/office');

test('LibreOffice converts formatted DOCX tables to a readable PDF', async (t) => {
  if (!findOfficeExecutable()) return t.skip('LibreOffice is not installed');
  const text = 'Deployment checklist';
  const docxBuffer = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ text, heading: 'Heading1' }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph('Build')] }),
                    new TableCell({ children: [new Paragraph('Deploy')] })
                  ]
                })
              ]
            })
          ]
        }
      ]
    })
  );
  const result = await convertToPdf({ text, title: 'Example', docxBuffer });
  assert.equal(result.conversionEngine, 'libreoffice');
  assert.equal((await PDFDocument.load(result.buffer)).getPageCount(), 1);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /Deployment checklist/);
  assert.match(parsed.text, /Build/);
  assert.match(parsed.text, /Deploy/);
});

test('Unicode text converts without rejecting arrows, checkmarks, emoji or Hindi', async (t) => {
  if (!findOfficeExecutable()) return t.skip('LibreOffice is not installed');
  const text =
    'DevOps \u2192 CI/CD \u2713 Docker \u{1F433}\n\u0928\u092e\u0938\u094d\u0924\u0947';
  const result = await convertToPdf({ text, title: 'Unicode example' });
  assert.equal(result.conversionEngine, 'libreoffice');
  assert.equal((await PDFDocument.load(result.buffer)).getPageCount(), 1);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /DevOps/);
  assert.ok(parsed.text.includes('\u2192'));
  assert.ok(parsed.text.includes('\u2713'));
});
