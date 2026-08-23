const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Directory for temporary compressed files
const TEMP_DIR = path.join(__dirname, 'temp_downloads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// In-memory store for compressed file metadata
const processedFilesStore = new Map();

// Cleanup files older than 30 minutes every 15 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [fileId, item] of processedFilesStore.entries()) {
    if (now - item.createdAt > maxAge) {
      if (fs.existsSync(item.filePath)) {
        try {
          fs.unlinkSync(item.filePath);
        } catch (err) {
          console.error(`Failed to delete temp file ${item.filePath}:`, err);
        }
      }
      processedFilesStore.delete(fileId);
    }
  }
}, 15 * 60 * 1000);

// Express Middlewares
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB per file limit
    files: 20 // max 20 files at a time
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

/**
 * Format bytes into human readable string (KB, MB)
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Endpoint to compress images
 */
app.post('/api/compress', upload.array('images', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No image files uploaded.' });
    }

    const quality = parseInt(req.body.quality) || 80;
    const targetFormat = req.body.format || 'original'; // 'original', 'jpeg', 'png', 'webp', 'avif'
    const reqWidth = parseInt(req.body.width) || null;
    const reqHeight = parseInt(req.body.height) || null;
    const maintainAspectRatio = req.body.maintainAspectRatio !== 'false';

    const results = [];

    for (const file of req.files) {
      const originalSize = file.size;
      const fileExt = path.extname(file.originalname).toLowerCase().replace('.', '');
      
      let pipeline = sharp(file.buffer);
      const metadata = await pipeline.metadata();

      // Determine output format
      let outFormat = targetFormat;
      if (outFormat === 'original') {
        outFormat = (metadata.format === 'heic' || metadata.format === 'heif') ? 'jpeg' : metadata.format;
      }
      if (!['jpeg', 'png', 'webp', 'avif', 'jpg'].includes(outFormat)) {
        outFormat = 'jpeg';
      }

      // Handle resizing if requested
      if (reqWidth || reqHeight) {
        pipeline = pipeline.resize({
          width: reqWidth || null,
          height: reqHeight || null,
          fit: maintainAspectRatio ? sharp.fit.inside : sharp.fit.fill,
          withoutEnlargement: true
        });
      }

      // Apply format specific compression settings
      switch (outFormat) {
        case 'jpeg':
        case 'jpg':
          pipeline = pipeline.jpeg({ quality, mozjpeg: true });
          break;
        case 'png':
          pipeline = pipeline.png({ quality, compressionLevel: 9, palette: quality < 90 });
          break;
        case 'webp':
          pipeline = pipeline.webp({ quality, effort: 6 });
          break;
        case 'avif':
          pipeline = pipeline.avif({ quality, effort: 6 });
          break;
      }

      const compressedBuffer = await pipeline.toBuffer();
      const compressedSize = compressedBuffer.length;

      // Construct unique filename for download
      const fileId = crypto.randomBytes(12).toString('hex');
      const baseName = path.basename(file.originalname, path.extname(file.originalname));
      const outputExt = outFormat === 'jpg' ? 'jpeg' : outFormat;
      const outputFilename = `${baseName}-compressed.${outputExt}`;
      const tempFilePath = path.join(TEMP_DIR, `${fileId}_${outputFilename}`);

      // Write to temp storage
      await fs.promises.writeFile(tempFilePath, compressedBuffer);

      // Create base64 preview thumbnail for frontend display
      const previewBuffer = await sharp(compressedBuffer)
        .resize(300, 300, { fit: 'inside' })
        .toBuffer();
      const base64Preview = `data:image/${outFormat};base64,${previewBuffer.toString('base64')}`;

      // Save metadata in store
      const fileData = {
        fileId,
        originalName: file.originalname,
        outputFilename,
        filePath: tempFilePath,
        originalSize,
        originalSizeFormatted: formatBytes(originalSize),
        compressedSize,
        compressedSizeFormatted: formatBytes(compressedSize),
        savedBytes: Math.max(0, originalSize - compressedSize),
        savedPercentage: originalSize > 0 
          ? Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100))
          : 0,
        originalDimensions: `${metadata.width || '?'}x${metadata.height || '?'}`,
        format: outputExt.toUpperCase(),
        mimeType: `image/${outputExt}`,
        preview: base64Preview,
        createdAt: Date.now()
      };

      processedFilesStore.set(fileId, fileData);
      results.push(fileData);
    }

    res.json({
      success: true,
      files: results
    });
  } catch (error) {
    console.error('Compression error:', error);
    res.status(500).json({ error: error.message || 'Failed to compress images.' });
  }
});

/**
 * Download single compressed image
 */
app.get('/api/download/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const item = processedFilesStore.get(fileId);

  if (!item || !fs.existsSync(item.filePath)) {
    return res.status(404).send('File not found or link has expired.');
  }

  res.setHeader('Content-Type', item.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${item.outputFilename}"`);
  
  const filestream = fs.createReadStream(item.filePath);
  filestream.pipe(res);
});

/**
 * Batch ZIP download endpoint
 */
app.post('/api/download-zip', (req, res) => {
  const { fileIds } = req.body;
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: 'No file IDs provided for ZIP archive.' });
  }

  const validItems = fileIds
    .map(id => processedFilesStore.get(id))
    .filter(item => item && fs.existsSync(item.filePath));

  if (validItems.length === 0) {
    return res.status(404).json({ error: 'Requested files were not found.' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="compressed-images-bundle.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('Archiver error:', err);
    if (!res.headersSent) {
      res.status(500).send({ error: err.message });
    }
  });

  archive.pipe(res);

  validItems.forEach(item => {
    archive.file(item.filePath, { name: item.outputFilename });
  });

  archive.finalize();
});

// Fallback HTML route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`⚡ Image Compressor App is live on http://localhost:${PORT}`);
  console.log(`==================================================`);
});
