# OmniTools

Express application for image/video compression, text-based PDF/Word conversion, and URL shortening.

## Run locally

Use Node.js 22 or newer (Node 24 is used in CI and Docker).

```sh
npm ci --include=optional
```

Copy `.env.example` to `.env` if you do not already have one, then run `npm start` and open http://127.0.0.1:3000. Do not copy `node_modules` between Windows, WSL, and Linux; install dependencies in each environment so Sharp gets the correct native binary.

On Windows with WSL, `localhost` may resolve to the IPv6 address `::1`, where WSL can forward the same port to a different server. If the terminal says the app is running but `localhost` hangs, use the printed `127.0.0.1` URL to reach this Windows server directly.

Leaving `MONGODB_URI` empty enables local, in-memory accounts and short links. Passwords are still hashed and verified, but accounts, links, and guest usage disappear on restart. Set a real MongoDB URI for persistent accounts/links. A configured but unavailable database returns an error; it never grants a demo login. Guest quota is per browser session on one server process, not a durable billing or abuse-prevention mechanism.

Images support still JPEG, PNG, WebP, and AVIF (20 per request, 50 MB each, at most 40 million input pixels). The slider is image quality, not a promised percentage saving: Max Savings uses 35, Balanced 80, and High Quality 92. PNG quality below 90 reduces the colour palette (lossy, retaining transparency); 90–100 uses lossless PNG encoding. JPEG, WebP and AVIF use their encoder quality settings. Presets do not resize images or silently change the selected format. Already-smaller images are kept when no format/size change is requested; quality is never silently lowered to force savings. Each result records the quality and compression mode used. Savings depend on the image; 90% reduction cannot be guaranteed. Try WebP or AVIF for greater savings. Videos accept up to 500 MB and use FFmpeg to produce H.264/AAC MP4. Output sizes are not guaranteed to shrink when converting formats. FFmpeg uses the bundled executable or `FFMPEG_PATH` when configured.

Documents accept DOCX and UTF-8 TXT up to 20 MB. When LibreOffice is installed, Word-to-PDF preserves document formatting, tables, images, and Unicode text. Standard Windows/Linux/macOS installation paths are detected, or set `LIBREOFFICE_PATH` to the executable. Each conversion uses an isolated temporary LibreOffice profile and a two-minute timeout. Docker includes LibreOffice and Unicode fonts. Without LibreOffice, a clearly labeled basic text-only conversion is used; that fallback supports Latin text without emoji. Text is limited to 500,000 characters. PDF-to-Word extracts text, not the original layout; legacy DOC and scanned PDFs/OCR remain unsupported.

Generated files and metadata live in `temp_downloads/`, including across app restarts. Downloads are accessible to anyone possessing their unguessable link. There is no automatic retention policy; configure storage monitoring and remove unneeded files before using this for sustained production workloads.

## Verify

```sh
npm run check
npm test
npm audit
```

Tests use isolated temporary directories and local HTTP servers. They generate real images, video, PDF and DOCX fixtures; no MongoDB or cloud credentials are needed. LibreOffice integration tests run when it is installed. Frontend tests use jsdom and do not replace visual testing in a real browser. For manual browser testing with disposable in-memory accounts, run `node scripts/qa-server.cjs` and open `http://127.0.0.1:3100`; it does not write to MongoDB.

## Docker and deployment

Generate a strong `JWT_SECRET` and set it in `.env` before starting production:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
docker compose up --build -d
```

The image excludes `.env` files. Compose passes runtime configuration explicitly and persists downloads in a named volume. `/api/health` checks image processing and the configured database. Set `PUBLIC_BASE_URL` to the public origin; enable `TRUST_PROXY=1` only behind one trusted reverse proxy. Set `COOKIE_SECURE=true` for HTTPS; leave it false for local HTTP.

The Ansible playbook reads the root `.env` (override `app_env_source` if needed) and installs it at `/opt/omnitools/app.env` with restricted permissions. Configure real production values before running it. The GitHub workflow tests first, publishes only when Docker credentials exist, and deploys the exact commit image only when EC2 credentials exist. CI deployment expects `/opt/omnitools/app.env` to already exist on the host. Terraform/Ansible commands create or modify real AWS resources and can incur charges. Restrict SSH ingress to your trusted IP before deploying; the existing Terraform security group permits public SSH.
