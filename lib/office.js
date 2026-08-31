const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { Document, Packer, Paragraph } = require('docx');
const { PDFDocument } = require('pdf-lib');
const { inputError, textToPdf } = require('./documents');

const runFile = promisify(execFile);

function findOfficeExecutable() {
  if (process.env.LIBREOFFICE_PATH) {
    if (!fs.existsSync(process.env.LIBREOFFICE_PATH)) {
      throw inputError(
        'LIBREOFFICE_PATH does not point to an installed LibreOffice executable.',
        503
      );
    }
    return process.env.LIBREOFFICE_PATH;
  }
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(
            process.env.ProgramFiles || 'C:/Program Files',
            'LibreOffice/program/soffice.com'
          ),
          path.join(
            process.env.ProgramFiles || 'C:/Program Files',
            'LibreOffice/program/soffice.exe'
          ),
          path.join(
            process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
            'LibreOffice/program/soffice.exe'
          )
        ]
      : [
          '/usr/bin/libreoffice',
          '/usr/bin/soffice',
          '/Applications/LibreOffice.app/Contents/MacOS/soffice'
        ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function convertToPdf({ text, title, docxBuffer, preferOffice = true }) {
  if (typeof text !== 'string' || (!text.trim() && !docxBuffer)) {
    throw inputError('Please provide a document containing text.');
  }
  if (text.length > 500000)
    throw inputError('Document text exceeds the 500,000 character limit.', 413);
  const executable = preferOffice ? findOfficeExecutable() : null;
  if (!executable) {
    const result = await textToPdf(text, title);
    return {
      ...result,
      conversionEngine: 'text',
      notice:
        'Basic text conversion used. Install LibreOffice to preserve Word formatting and support Unicode.'
    };
  }

  // Each conversion gets its own profile, so it cannot reuse or disturb an open
  // desktop LibreOffice session or another user's conversion.
  const tempRoot = path.resolve(os.tmpdir());
  const directory = await fs.promises.mkdtemp(
    path.join(tempRoot, 'omnitools-office-')
  );
  try {
    const source =
      docxBuffer ||
      (await Packer.toBuffer(
        new Document({
          sections: [
            {
              children: text
                .replace(/\r\n?/g, '\n')
                .split('\n')
                .map((line) => new Paragraph(line))
            }
          ]
        })
      ));
    const inputPath = path.join(directory, 'document.docx');
    await fs.promises.writeFile(inputPath, source);
    const profile = pathToFileURL(path.join(directory, 'profile')).href;
    try {
      await runFile(
        executable,
        [
          `-env:UserInstallation=${profile}`,
          '--headless',
          '--nologo',
          '--nodefault',
          '--nolockcheck',
          '--norestore',
          '--convert-to',
          'pdf:writer_pdf_Export',
          '--outdir',
          directory,
          inputPath
        ],
        { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 }
      );
    } catch (error) {
      throw inputError(
        error.killed
          ? 'Document conversion timed out. Try a smaller document.'
          : 'LibreOffice could not convert this document.',
        422
      );
    }
    let buffer;
    try {
      buffer = await fs.promises.readFile(path.join(directory, 'document.pdf'));
    } catch {
      throw inputError(
        'No PDF was produced. The document may be damaged or password protected.',
        422
      );
    }
    const pdf = await PDFDocument.load(buffer);
    return {
      buffer,
      pageCount: pdf.getPageCount(),
      conversionEngine: 'libreoffice'
    };
  } finally {
    if (
      path.dirname(directory) === tempRoot &&
      path.basename(directory).startsWith('omnitools-office-')
    ) {
      await fs.promises
        .rm(directory, { recursive: true, force: true, maxRetries: 3 })
        .catch(() => {});
    }
  }
}

module.exports = { findOfficeExecutable, convertToPdf };
