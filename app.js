require('dotenv').config();
const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const { parsePdf: pdfParse } = require('./lib/pdf');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { customAlphabet } = require('nanoid');
const User = require('./models/User');
const ShortUrl = require('./models/ShortUrl');
const { extractTextFromDocument, inputError } = require('./lib/documents');
const { convertToPdf } = require('./lib/office');
const {
  createFileStorage,
  safeBaseName,
  formatBytes,
  validFileId
} = require('./lib/files');

const execFileAsync = promisify(execFile);
const nanoid = customAlphabet(
  '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  7
);
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function createApp(options = {}) {
  const app = express();
  const useDatabase = options.useDatabase ?? Boolean(process.env.MONGODB_URI);
  const secret =
    options.jwtSecret ||
    process.env.JWT_SECRET ||
    crypto.randomBytes(48).toString('hex');
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  ) {
    throw new Error(
      'Set JWT_SECRET to a random secret of at least 32 characters before starting in production.'
    );
  }
  const tempDir = options.tempDir || path.join(__dirname, 'temp_downloads');
  const storage = createFileStorage(tempDir);
  const memoryUsers = new Map();
  const memoryUrls = new Map();
  const guests = new Map();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true'
  };
  let sharp;
  try {
    sharp = require('sharp');
  } catch (error) {
    console.error('Image processing unavailable:', error.message);
  }
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser(secret));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.static(path.join(__dirname, 'public')));

  const makeUpload = (fileSize, files) =>
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize, files, fields: 8, parts: files + 8 }
    });
  const imageUpload = makeUpload(50 * 1024 * 1024, 20);
  const videoUpload = makeUpload(500 * 1024 * 1024, 1);
  const documentUpload = makeUpload(20 * 1024 * 1024, 1);

  function requireDatabase() {
    if (useDatabase && User.db.readyState !== 1)
      throw inputError('Database unavailable. Please try again later.', 503);
  }
  app.use(
    asyncRoute(async (req, res, next) => {
      req.user = null;
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
      const token = bearer ? bearer[1] : req.cookies.token;
      if (token) {
        let decoded;
        try {
          decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
        } catch {
          /* Expired/invalid session. */
        }
        if (decoded && typeof decoded.id === 'string') {
          requireDatabase();
          req.user = useDatabase
            ? /^[a-f0-9]{24}$/i.test(decoded.id)
              ? await User.findById(decoded.id)
              : null
            : [...memoryUsers.values()].find(
                (user) => user._id === decoded.id
              ) || null;
        }
      }
      next();
    })
  );

  function guestRecord(req, res) {
    let id = req.signedCookies.guest_id;
    const now = Date.now();
    if (!id || !guests.has(id) || guests.get(id).expiresAt <= now) {
      for (const [key, record] of guests)
        if (record.expiresAt <= now && !record.pending) guests.delete(key);
      id = crypto.randomBytes(24).toString('hex');
      const lifetime = 30 * 24 * 60 * 60 * 1000;
      guests.set(id, { count: 0, pending: 0, expiresAt: now + lifetime });
      res.cookie('guest_id', id, {
        ...cookieOptions,
        signed: true,
        maxAge: lifetime
      });
      req.signedCookies.guest_id = id;
    }
    return guests.get(id);
  }
  function quota(req, res, next) {
    if (req.user) return next();
    const record = guestRecord(req, res);
    if (record.count + record.pending >= 5)
      return res.status(403).json({
        error: 'Free guest limit reached. Please sign in to continue.',
        quotaExceeded: true
      });
    record.pending++;
    req.guestRecord = record;
    let settled = false;
    function settle(success) {
      if (settled) return;
      settled = true;
      record.pending--;
      if (success) record.count++;
    }
    res.once('finish', () =>
      settle(res.statusCode >= 200 && res.statusCode < 300)
    );
    res.once('close', () => settle(false));
    next();
  }
  function success(req, res, data) {
    res.json({
      success: true,
      ...data,
      quotaRemaining: req.user
        ? 'Unlimited'
        : Math.max(0, 4 - req.guestRecord.count)
    });
  }
  function authResponse(res, user, status = 200) {
    const token = jwt.sign({ id: String(user._id) }, secret, {
      expiresIn: '7d',
      algorithm: 'HS256'
    });
    res.cookie('token', token, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.status(status).json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email },
      token
    });
  }
  function credentials(body, registering = false) {
    if (
      typeof body.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
    )
      throw inputError('Please provide a valid email address.');
    if (
      typeof body.password !== 'string' ||
      !body.password ||
      Buffer.byteLength(body.password) > 72
    )
      throw inputError('Password must contain between 1 and 72 UTF-8 bytes.');
    if (
      registering &&
      (body.password.length < 6 ||
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.trim().length > 50)
    )
      throw inputError(
        'Provide a name of 1–50 characters and a password of at least 6 characters.'
      );
    return {
      email: body.email.trim().toLowerCase(),
      password: body.password,
      name: registering ? body.name.trim() : undefined
    };
  }
  app.post(
    '/api/auth/register',
    asyncRoute(async (req, res) => {
      const { name, email, password } = credentials(req.body, true);
      requireDatabase();
      let user;
      if (useDatabase) {
        if (await User.exists({ email }))
          throw inputError('An account with this email already exists.', 409);
        user = await User.create({ name, email, password });
      } else {
        if (memoryUsers.has(email))
          throw inputError('An account with this email already exists.', 409);
        const hash = await bcrypt.hash(password, 10);
        if (memoryUsers.has(email))
          throw inputError('An account with this email already exists.', 409);
        user = {
          _id: crypto.randomBytes(12).toString('hex'),
          name,
          email,
          password: hash
        };
        memoryUsers.set(email, user);
      }
      authResponse(res, user, 201);
    })
  );
  app.post(
    '/api/auth/login',
    asyncRoute(async (req, res) => {
      const { email, password } = credentials(req.body);
      requireDatabase();
      const user = useDatabase
        ? await User.findOne({ email }).select('+password')
        : memoryUsers.get(email);
      if (!user || !(await bcrypt.compare(password, user.password)))
        throw inputError('Invalid email or password.', 401);
      authResponse(res, user);
    })
  );
  app.get('/api/auth/me', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const count = guestRecord(req, res).count;
    res.json({
      authenticated: Boolean(req.user),
      user: req.user
        ? { id: req.user._id, name: req.user.name, email: req.user.email }
        : null,
      guestUsage: count,
      quotaRemaining: req.user ? 'Unlimited' : Math.max(0, 5 - count)
    });
  });
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token', cookieOptions);
    res.json({ success: true });
  });
  app.get('/api/health', (req, res) => {
    const healthy =
      Boolean(sharp) && (!useDatabase || User.db.readyState === 1);
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      imageProcessing: Boolean(sharp),
      database: useDatabase
        ? User.db.readyState === 1
          ? 'connected'
          : 'unavailable'
        : 'memory'
    });
  });

  function integerOption(value, fallback, min, max, label) {
    if (value === undefined || value === '') return fallback;
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw inputError(
        `${label} must be an integer between ${min} and ${max}.`
      );
    return Number(value);
  }
  app.post(
    '/api/compress/image',
    quota,
    imageUpload.array('images', 20),
    asyncRoute(async (req, res) => {
      if (!sharp)
        throw inputError(
          'Image processing unavailable. Run npm install --include=optional on the server.',
          503
        );
      if (!req.files?.length) throw inputError('No image files uploaded.');
      const quality = integerOption(req.body.quality, 80, 1, 100, 'Quality');
      const width = integerOption(req.body.width, undefined, 1, 10000, 'Width');
      const height = integerOption(
        req.body.height,
        undefined,
        1,
        10000,
        'Height'
      );
      const target = req.body.format || 'original';
      if (!['original', 'jpeg', 'jpg', 'png', 'webp', 'avif'].includes(target))
        throw inputError('Unsupported output image format.');
      const inputOptions = { limitInputPixels: 40000000 };
      const images = [];
      for (const file of req.files) {
        let metadata;
        try {
          metadata = await sharp(file.buffer, inputOptions).metadata();
        } catch {
          throw inputError(`Cannot read image: ${file.originalname}`);
        }
        if (!['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format))
          throw inputError(
            'Supported image inputs are JPEG, PNG, WebP and AVIF.',
            415
          );
        if (metadata.pages > 1)
          throw inputError(
            'Animated images are not supported; upload a still image.',
            415
          );
        const format =
          target === 'original'
            ? metadata.format === 'heif'
              ? 'avif'
              : metadata.format
            : target === 'jpg'
              ? 'jpeg'
              : target;
        images.push({ file, metadata, format });
      }
      const results = [];
      for (const { file, metadata, format } of images) {
        async function compress(q) {
          let pipeline = sharp(file.buffer, inputOptions).rotate();
          if (width || height)
            pipeline = pipeline.resize({
              width,
              height,
              fit: req.body.maintainAspectRatio === 'false' ? 'fill' : 'inside',
              withoutEnlargement: true
            });
          if (format === 'jpeg')
            return pipeline
              .flatten({ background: '#ffffff' })
              .jpeg({ quality: q, mozjpeg: true })
              .toBuffer();
          if (format === 'png') {
            // Deflate alone is lossless and ignores image quality. Lower
            // settings must quantize colours to deliver smaller PNGs.
            const pngOptions = {
              compressionLevel: 9,
              adaptiveFiltering: true
            };
            if (q < 90)
              Object.assign(pngOptions, {
                palette: true,
                quality: q,
                dither: q <= 35 ? 0 : 0.25,
                effort: 7
              });
            return pipeline
              .png(pngOptions)
              .toBuffer();
          }
          if (format === 'webp')
            return pipeline.webp({ quality: q, effort: 4 }).toBuffer();
          return pipeline.avif({ quality: q, effort: 4 }).toBuffer();
        }
        let buffer;
        let retainedOriginal = false;
        try {
          buffer = await compress(quality);
          if (
            (metadata.format === format ||
              (metadata.format === 'heif' &&
                metadata.compression === 'av1' &&
                format === 'avif')) &&
            !width &&
            !height &&
            buffer.length >= file.size
          ) {
            // Never silently lower quality to force a saving. Already-small
            // images may legitimately have nothing left to save at this level.
            buffer = file.buffer;
            retainedOriginal = true;
          }
        } catch {
          throw inputError(`Could not process image: ${file.originalname}`);
        }
        const preview = await sharp(buffer, inputOptions)
          .resize(120, 120, { fit: 'inside' })
          .jpeg({ quality: 40 })
          .toBuffer();
        const savedBytes = Math.max(0, file.size - buffer.length);
        results.push(
          await storage.save(
            buffer,
            `${safeBaseName(file.originalname)}-compressed.${format}`,
            {
              originalName: file.originalname,
              originalSize: file.size,
              originalSizeFormatted: formatBytes(file.size),
              compressedSize: buffer.length,
              compressedSizeFormatted: formatBytes(buffer.length),
              savedBytes,
              savedPercentage: Math.round((savedBytes / file.size) * 100),
              quality,
              retainedOriginal,
              compressionMode: retainedOriginal
                ? 'Original retained (already smaller)'
                : format === 'png'
                  ? quality >= 90
                    ? 'Lossless PNG'
                    : 'Reduced-colour PNG'
                  : 'Lossy compression',
              originalDimensions: `${metadata.width}x${metadata.height}`,
              format: format.toUpperCase(),
              mimeType: `image/${format}`,
              preview: `data:image/jpeg;base64,${preview.toString('base64')}`
            }
          )
        );
      }
      success(req, res, { files: results });
    })
  );

  async function ffmpegBinary() {
    let candidates;
    if (options.ffmpegPath || process.env.FFMPEG_PATH)
      candidates = [options.ffmpegPath || process.env.FFMPEG_PATH];
    else {
      let bundled;
      try {
        bundled = require('ffmpeg-static');
      } catch {
        /* Use system installation. */
      }
      candidates = [bundled, 'ffmpeg'].filter(Boolean);
    }
    for (const binary of candidates) {
      try {
        await execFileAsync(binary, ['-version'], {
          timeout: 10000,
          windowsHide: true
        });
        return binary;
      } catch {
        /* Try next binary. */
      }
    }
    throw inputError(
      'Video processing unavailable. Install FFmpeg or set FFMPEG_PATH.',
      503
    );
  }
  app.post(
    '/api/compress/video',
    quota,
    videoUpload.single('video'),
    asyncRoute(async (req, res) => {
      if (!req.file?.size) throw inputError('No video file uploaded.');
      const binary = await ffmpegBinary();
      const id = crypto.randomBytes(12).toString('hex');
      const rawPath = path.join(tempDir, `${id}_raw.input`);
      const outputPath = path.join(tempDir, `${id}_output.mp4`);
      try {
        await fs.promises.writeFile(rawPath, req.file.buffer);
        try {
          await execFileAsync(
            binary,
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-nostdin',
              '-y',
              '-protocol_whitelist',
              'file,pipe',
              '-i',
              rawPath,
              '-map',
              '0:v:0',
              '-map',
              '0:a:0?',
              '-vf',
              'scale=trunc(iw/2)*2:trunc(ih/2)*2',
              '-c:v',
              'libx264',
              '-pix_fmt',
              'yuv420p',
              '-crf',
              '26',
              '-preset',
              'fast',
              '-threads',
              '2',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-movflags',
              '+faststart',
              outputPath
            ],
            { timeout: 300000, maxBuffer: 1024 * 1024, windowsHide: true }
          );
        } catch (error) {
          throw inputError(
            error.killed
              ? 'Video processing timed out. Try a smaller file.'
              : 'This video could not be decoded or converted.',
            422
          );
        }
        const buffer = await fs.promises.readFile(outputPath);
        if (!buffer.length)
          throw inputError('Video conversion produced an empty file.', 422);
        const savedBytes = Math.max(0, req.file.size - buffer.length);
        const file = await storage.save(
          buffer,
          `${safeBaseName(req.file.originalname)}-optimized.mp4`,
          {
            originalName: req.file.originalname,
            originalSize: req.file.size,
            originalSizeFormatted: formatBytes(req.file.size),
            compressedSize: buffer.length,
            compressedSizeFormatted: formatBytes(buffer.length),
            savedBytes,
            savedPercentage: Math.round((savedBytes / req.file.size) * 100),
            format: 'MP4',
            mimeType: 'video/mp4'
          }
        );
        success(req, res, { file });
      } finally {
        await Promise.all(
          [rawPath, outputPath].map((filename) =>
            fs.promises.unlink(filename).catch(() => {})
          )
        );
      }
    })
  );
  app.post(
    '/api/pdf/pdf-to-word',
    quota,
    documentUpload.single('pdf'),
    asyncRoute(async (req, res) => {
      if (!req.file?.size) throw inputError('No PDF file uploaded.');
      let data;
      try {
        data = await pdfParse(req.file.buffer);
      } catch {
        throw inputError(
          'Cannot read this PDF. It may be damaged or password protected.'
        );
      }
      if (!data.text?.trim())
        throw inputError(
          'This PDF has no extractable text. Scanned PDFs require OCR, which is not supported.',
          422
        );
      const doc = new Document({
        sections: [
          {
            children: data.text
              .split('\n')
              .map((text) => new Paragraph({ children: [new TextRun(text)] }))
          }
        ]
      });
      const buffer = await Packer.toBuffer(doc);
      const file = await storage.save(
        buffer,
        `${safeBaseName(req.file.originalname)}-converted.docx`,
        {
          originalName: req.file.originalname,
          fileSizeFormatted: formatBytes(buffer.length),
          pageCount: data.numpages,
          format: 'DOCX',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      );
      success(req, res, { file });
    })
  );
  app.post(
    '/api/pdf/word-to-pdf',
    quota,
    documentUpload.single('document'),
    asyncRoute(async (req, res) => {
      const text = req.file
        ? await extractTextFromDocument(req.file.buffer, req.file.originalname)
        : req.body.text;
      const name = req.file ? safeBaseName(req.file.originalname) : 'document';
      const { buffer, pageCount, conversionEngine, notice } =
        await convertToPdf({
          text,
          title: req.file ? name : 'Converted Document',
          docxBuffer: req.file?.originalname.toLowerCase().endsWith('.docx')
            ? req.file.buffer
            : undefined,
          preferOffice: options.documentConverter !== 'text'
        });
      const file = await storage.save(buffer, `${name}-converted.pdf`, {
        originalName: req.file?.originalname || 'Document.txt',
        conversionEngine,
        notice,
        fileSizeFormatted: formatBytes(buffer.length),
        pageCount,
        format: 'PDF',
        mimeType: 'application/pdf'
      });
      success(req, res, { file });
    })
  );

  app.post(
    '/api/url/shorten',
    quota,
    asyncRoute(async (req, res) => {
      requireDatabase();
      const { originalUrl, customAlias } = req.body;
      if (
        typeof originalUrl !== 'string' ||
        !originalUrl.trim() ||
        originalUrl.length > 8192
      )
        throw inputError('Please provide a valid web URL.');
      let target = originalUrl.trim();
      if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^https?:\/\//i.test(target))
        throw inputError('Only HTTP and HTTPS URLs are allowed.');
      if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
      try {
        const parsed = new URL(target);
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          !parsed.hostname ||
          parsed.username ||
          parsed.password
        )
          throw new Error();
        target = parsed.href;
      } catch {
        throw inputError(
          'Please provide a valid HTTP or HTTPS URL without embedded credentials.'
        );
      }
      if (
        customAlias !== undefined &&
        (typeof customAlias !== 'string' ||
          (customAlias.trim() &&
            !/^[a-zA-Z0-9_-]{1,64}$/.test(customAlias.trim())))
      )
        throw inputError(
          'Aliases may contain 1–64 letters, numbers, underscores or hyphens.'
        );
      const alias = customAlias?.trim();
      let shortId;
      for (let attempt = 0; attempt < 5; attempt++) {
        shortId = alias || nanoid();
        if (useDatabase) {
          try {
            await ShortUrl.create({
              originalUrl: target,
              shortId,
              createdBy: req.user?._id || null
            });
            break;
          } catch (error) {
            if (error.code !== 11000) throw error;
          }
        } else if (!memoryUrls.has(shortId)) {
          memoryUrls.set(shortId, { originalUrl: target, clicks: 0 });
          break;
        }
        if (alias)
          throw inputError(
            'Custom alias is already taken. Please try another.',
            409
          );
        shortId = null;
      }
      if (!shortId)
        throw inputError('Could not allocate a short link. Please retry.', 503);
      const baseUrl = process.env.PUBLIC_BASE_URL
        ? process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
        : `${req.protocol}://${req.get('host')}`;
      success(req, res, {
        shortId,
        shortUrl: `${baseUrl}/s/${shortId}`,
        originalUrl: target
      });
    })
  );
  app.get(
    '/s/:shortId',
    asyncRoute(async (req, res) => {
      requireDatabase();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(req.params.shortId))
        throw inputError('Link not found.', 404);
      const record = useDatabase
        ? await ShortUrl.findOneAndUpdate(
            { shortId: req.params.shortId },
            { $inc: { clicks: 1 } }
          )
        : memoryUrls.get(req.params.shortId);
      if (!record) throw inputError('Link not found.', 404);
      if (!useDatabase) record.clicks++;
      res.redirect(302, record.originalUrl);
    })
  );
  app.get(
    '/api/download/:fileId',
    asyncRoute(async (req, res, next) => {
      const item = await storage.get(req.params.fileId);
      if (!item) throw inputError('File not found or link has expired.', 404);
      res.type(item.mimeType || 'application/octet-stream');
      res.download(item.filePath, item.outputFilename, (error) => {
        if (error) next(error);
      });
    })
  );
  app.post(
    '/api/download-zip',
    asyncRoute(async (req, res, next) => {
      const { fileIds } = req.body;
      if (
        !Array.isArray(fileIds) ||
        !fileIds.length ||
        fileIds.length > 100 ||
        !fileIds.every(validFileId)
      )
        throw inputError('Provide between 1 and 100 valid file IDs.');
      const items = await Promise.all(
        [...new Set(fileIds)].map((id) => storage.get(id))
      );
      if (items.some((item) => !item))
        throw inputError('One or more requested files no longer exist.', 404);
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', next);
      archive.on('warning', next);
      res.once('close', () => archive.abort());
      res.attachment('omnitools-archive.zip');
      archive.pipe(res);
      const names = new Set();
      for (const item of items) {
        const parsed = path.parse(item.outputFilename);
        let name = item.outputFilename;
        let suffix = 2;
        while (names.has(name.toLowerCase()))
          name = `${parsed.name} (${suffix++})${parsed.ext}`;
        names.add(name.toLowerCase());
        archive.file(item.filePath, { name });
      }
      await archive.finalize();
    })
  );
  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError)
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error:
          error.code === 'LIMIT_FILE_SIZE'
            ? 'File exceeds the upload limit (images 50 MB, video 500 MB, documents 20 MB).'
            : 'Too many files, fields, or an unexpected upload field.'
      });
    if (error.code === 11000)
      return res
        .status(409)
        .json({ error: 'This email or alias is already in use.' });
    const status =
      error.status ||
      (error.name === 'ValidationError' || error instanceof SyntaxError
        ? 400
        : 500);
    if (status >= 500) console.error(error.message);
    res.status(status).json({
      error:
        status === 500 ? 'An unexpected server error occurred.' : error.message
    });
  });
  return app;
}

module.exports = { createApp };
