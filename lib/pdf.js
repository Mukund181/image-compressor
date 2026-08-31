const pdfParse = require('pdf-parse');

function parsePdf(buffer) {
  // pdf-parse's bundled PDF.js can interpret Buffer slices against the entire
  // pooled ArrayBuffer. An owned, zero-offset byte array prevents corruption.
  return pdfParse(Uint8Array.from(buffer));
}

module.exports = { parsePdf };
