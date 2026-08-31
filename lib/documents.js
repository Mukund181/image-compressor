const mammoth = require('mammoth');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

function inputError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function extractTextFromDocument(buffer, filename) {
  const extension = require('path').extname(filename).toLowerCase();
  if (extension === '.docx') {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    } catch {
      throw inputError(
        'This DOCX file is damaged or is not a valid Word document.'
      );
    }
  }
  if (extension !== '.txt') {
    throw inputError(
      'Please upload a .docx or UTF-8 .txt file. Legacy .doc files are not supported.'
    );
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw inputError('Text files must use UTF-8 encoding.');
  }
}

async function textToPdf(text, title = 'Converted Document') {
  if (typeof text !== 'string' || !text.trim())
    throw inputError('Please provide a document containing text.');
  if (text.length > 500000)
    throw inputError('Document text exceeds the 500,000 character limit.', 413);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  text = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  // Standard PDF fonts cannot encode every script. Never silently delete text.
  try {
    font.encodeText(text.replace(/\n/g, ''));
    bold.encodeText(title);
  } catch {
    throw inputError(
      'This document contains characters unsupported by the PDF font. Use Latin text without emoji.',
      422
    );
  }
  const width = 595.28;
  const height = 841.89;
  const margin = 50;
  const contentWidth = width - margin * 2;
  let page = pdf.addPage([width, height]);
  let y = height - margin;

  function drawLine(line, selectedFont, size, lineHeight) {
    if (y < margin + lineHeight) {
      page = pdf.addPage([width, height]);
      y = height - margin;
    }
    if (line)
      page.drawText(line, {
        x: margin,
        y,
        size,
        font: selectedFont,
        color: rgb(0.15, 0.15, 0.15)
      });
    y -= lineHeight;
  }

  function drawParagraph(paragraph, selectedFont, size, lineHeight) {
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (selectedFont.widthOfTextAtSize(candidate, size) <= contentWidth) {
        line = candidate;
        continue;
      }
      if (line) drawLine(line, selectedFont, size, lineHeight);
      line = '';
      // Long URLs/words must wrap too, otherwise content is clipped off the page.
      for (const character of word) {
        if (
          selectedFont.widthOfTextAtSize(line + character, size) > contentWidth
        ) {
          drawLine(line, selectedFont, size, lineHeight);
          line = '';
        }
        line += character;
      }
    }
    drawLine(line, selectedFont, size, lineHeight);
  }

  drawParagraph(title, bold, 18, 24);
  y -= 8;
  for (const paragraph of text.split('\n')) {
    drawParagraph(paragraph, font, 11, 16);
    y -= 8;
  }
  return {
    buffer: Buffer.from(await pdf.save()),
    pageCount: pdf.getPageCount()
  };
}

module.exports = { extractTextFromDocument, textToPdf, inputError };
