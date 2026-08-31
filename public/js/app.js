document.addEventListener('DOMContentLoaded', () => {
  // --- Global State ---
  let currentUser = null;
  let authRequest = 0;
  let imageGeneration = 0;
  let documentBusy = false;
  let imageFilesList = [];

  // --- DOM Elements ---
  const navTabs = document.querySelectorAll('.nav-tab');
  const toolPanels = document.querySelectorAll('.tool-panel');
  const heroTitle = document.getElementById('heroTitle');
  const heroSubtitle = document.getElementById('heroSubtitle');

  const usageText = document.getElementById('usageText');
  const userAuthSection = document.getElementById('userAuthSection');

  // Auth Modal
  const authModal = document.getElementById('authModal');
  const authBackdrop = document.getElementById('authBackdrop');
  const closeAuthModal = document.getElementById('closeAuthModal');
  const openAuthBtn = document.getElementById('openAuthBtn');
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  // Toast Container
  const toastContainer = document.getElementById('toastContainer');

  // Module 1: Image Tool
  const imgQuality = document.getElementById('imgQuality');
  const imgQualityValue = document.getElementById('imgQualityValue');
  const presetChips = document.querySelectorAll('.chip-btn');
  const imgFormat = document.getElementById('imgFormat');
  const imgDropZone = document.getElementById('imgDropZone');
  const imgInput = document.getElementById('imgInput');
  const imgResultsCard = document.getElementById('imgResultsCard');
  const imgCount = document.getElementById('imgCount');
  const imgList = document.getElementById('imgList');
  const imgClearBtn = document.getElementById('imgClearBtn');
  const imgZipBtn = document.getElementById('imgZipBtn');

  // Module 2: Video Tool
  const videoDropZone = document.getElementById('videoDropZone');
  const videoInput = document.getElementById('videoInput');
  const videoResultsCard = document.getElementById('videoResultsCard');
  const videoResultBox = document.getElementById('videoResultBox');

  // Module 4: PDF Converter
  const tabPdfToWord = document.getElementById('tabPdfToWord');
  const tabWordToPdf = document.getElementById('tabWordToPdf');
  const pdfToWordCard = document.getElementById('pdfToWordCard');
  const wordToPdfCard = document.getElementById('wordToPdfCard');
  const pdfDropZone = document.getElementById('pdfDropZone');
  const pdfInput = document.getElementById('pdfInput');
  const wordDropZone = document.getElementById('wordDropZone');
  const wordInput = document.getElementById('wordInput');
  const pdfTextInput = document.getElementById('pdfTextInput');
  const generatePdfBtn = document.getElementById('generatePdfBtn');
  const pdfResultsCard = document.getElementById('pdfResultsCard');
  const pdfResultBox = document.getElementById('pdfResultBox');

  // Module 5: URL Shortener
  const urlForm = document.getElementById('urlForm');
  const longUrlInput = document.getElementById('longUrlInput');
  const customAliasInput = document.getElementById('customAliasInput');
  const urlResultBox = document.getElementById('urlResultBox');
  const shortUrlOutput = document.getElementById('shortUrlOutput');
  const copyUrlBtn = document.getElementById('copyUrlBtn');

  // Escape user names and filenames before inserting them into HTML templates.
  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[character]
    );
  }

  async function readResponse(res) {
    const data = await res.json().catch(() => null);
    if (!data)
      throw new Error(
        'The server returned an invalid response. Please try again.'
      );
    return data;
  }

  function setBusy(input, busy) {
    input.disabled = busy;
    input.closest('.drop-zone').setAttribute('aria-busy', String(busy));
  }

  function panelStatus(panelId, message, state = 'busy') {
    const panel = document.getElementById(panelId);
    let status = panel.querySelector('.operation-status');
    if (!status) {
      status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      panel.prepend(status);
    }
    status.className = 'operation-status ' + state;
    status.textContent = message;
    status.classList.toggle('hidden', !message);
  }

  function documentProcessing(busy) {
    documentBusy = busy;
    [pdfInput, wordInput, generatePdfBtn, tabPdfToWord, tabWordToPdf].forEach(
      (control) => {
        control.disabled = busy;
      }
    );
    [pdfDropZone, wordDropZone].forEach((zone) =>
      zone.setAttribute('aria-busy', String(busy))
    );
  }

  function panelError(panelId, message) {
    panelStatus(panelId, message, 'error');
    showToast(message);
  }

  openAuthBtn.addEventListener('click', () => showAuthModal('login'));

  // --- Initial Auth Check ---
  checkAuthStatus();

  async function checkAuthStatus() {
    const request = ++authRequest;
    try {
      const res = await fetch('/api/auth/me');
      const data = await readResponse(res);
      if (!res.ok)
        throw new Error(data.error || 'Unable to check your session.');
      if (request !== authRequest) return;

      if (data.authenticated) {
        currentUser = data.user;
        usageText.textContent = 'Account: Unlimited';
        userAuthSection.innerHTML = `
          <span style="font-size:0.85rem; font-weight:600; color:#334155;">Hi, ${escapeHtml(currentUser.name)}</span>
          <button class="btn btn-outline btn-sm" id="logoutBtn">Sign Out</button>
        `;
        document
          .getElementById('logoutBtn')
          .addEventListener('click', handleLogout);
      } else {
        currentUser = null;
        usageText.textContent = `Guest Quota: ${data.quotaRemaining}/5 left`;
        userAuthSection.innerHTML = `<button class="btn btn-outline btn-sm" id="openAuthBtn">Sign In</button>`;
        document
          .getElementById('openAuthBtn')
          .addEventListener('click', () => showAuthModal('login'));
      }
    } catch (err) {
      console.error('Auth check error:', err);
    }
  }

  async function handleLogout() {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error('Could not sign out. Please try again.');
      await checkAuthStatus();
      showToast('Signed out successfully.');
    } catch (err) {
      showToast(err.message);
    }
  }

  // --- Toast Notifications ---
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // --- Direct Attachment Downloader ---
  function triggerDirectDownload(url, filename) {
    if (!url) {
      showToast('Error: Download URL is invalid.');
      return;
    }
    showToast(`Downloading ${filename || 'file'}...`);
    window.location.href = url;
  }

  // --- Navigation Tabs ---
  const heroHeadings = {
    image: {
      title: 'Smart Image Compression',
      sub: 'Reduce JPG, PNG, WebP & AVIF image file sizes instantly while preserving quality.'
    },
    video: {
      title: 'High-Efficiency Video Compressor',
      sub: 'Compress MP4 and WebM video files without losing visual clarity.'
    },
    pdf: {
      title: 'Fast PDF & Document Converter',
      sub: 'Convert PDF documents to editable Word (.docx) files or text to PDF.'
    },
    shortener: {
      title: 'Clean & Secure URL Shortener',
      sub: 'Transform long web links into short, trackable links with custom aliases.'
    }
  };

  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      navTabs.forEach((t) => t.classList.remove('active'));
      toolPanels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`panel-${target}`).classList.add('active');

      if (heroHeadings[target]) {
        heroTitle.textContent = heroHeadings[target].title;
        heroSubtitle.textContent = heroHeadings[target].sub;
      }
    });
  });

  // --- Auth Modal & Quota Gateway ---
  function showAuthModal(type = 'login', quotaExceeded = false) {
    authModal.classList.remove('hidden');
    if (quotaExceeded) {
      document.getElementById('authModalTitle').textContent =
        'Free Quota Reached (5/5)';
      document.getElementById('authModalSubtitle').textContent =
        'You have used all 5 free guest operations. Create a free account to unlock unlimited access!';
    } else {
      document.getElementById('authModalTitle').textContent =
        type === 'login' ? 'Sign In to OmniTools' : 'Create Free Account';
      document.getElementById('authModalSubtitle').textContent =
        'Access your digital tools with unlimited cloud processing.';
    }

    if (type === 'login') {
      tabLoginBtn.classList.add('active');
      tabRegisterBtn.classList.remove('active');
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
    } else {
      tabRegisterBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      registerForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
    }
  }

  closeAuthModal.addEventListener('click', () =>
    authModal.classList.add('hidden')
  );
  authBackdrop.addEventListener('click', () =>
    authModal.classList.add('hidden')
  );
  tabLoginBtn.addEventListener('click', () => showAuthModal('login'));
  tabRegisterBtn.addEventListener('click', () => showAuthModal('register'));

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await readResponse(res);
      if (!res.ok) throw new Error(data.error);

      authModal.classList.add('hidden');
      showToast('Successfully signed in!');
      checkAuthStatus();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const data = await readResponse(res);
      if (!res.ok) throw new Error(data.error);

      authModal.classList.add('hidden');
      showToast('Account created successfully!');
      checkAuthStatus();
    } catch (err) {
      showToast('Error: ' + err.message);
    }
  });

  // --- Helper: Response Handling with Quota Interception ---
  async function handleApiResponse(res) {
    const data = await readResponse(res);
    if (res.status === 403 && data.quotaExceeded) {
      showAuthModal('register', true);
      throw new Error(data.error);
    }
    if (!res.ok) throw new Error(data.error || 'Operation failed.');
    checkAuthStatus();
    return data;
  }

  // ====================================================================
  // MODULE 1: IMAGE COMPRESSOR CLIENT LOGIC
  // ====================================================================
  imgQuality.addEventListener('input', (e) => {
    imgQualityValue.textContent = e.target.value + ' / 100';
    presetChips.forEach((chip) =>
      chip.classList.toggle('active', chip.dataset.val === e.target.value)
    );
  });

  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const val = chip.dataset.val;
      imgQuality.value = val;
      imgQualityValue.textContent = val + ' / 100';
      presetChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  ['dragenter', 'dragover'].forEach((name) => {
    imgDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      imgDropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    imgDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      imgDropZone.classList.remove('dragover');
    });
  });

  imgDropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) processImageUpload(e.dataTransfer.files);
  });
  imgInput.addEventListener('change', (e) => {
    if (e.target.files.length) processImageUpload(e.target.files);
  });

  async function processImageUpload(fileList) {
    if (imgInput.disabled) return;
    const files = Array.from(fileList);
    imgInput.value = '';
    if (
      !files.length ||
      files.some((file) => !/\.(png|jpe?g|webp|avif)$/i.test(file.name))
    )
      return panelError(
        'panel-image',
        'Please select PNG, JPG, WebP or AVIF images.'
      );
    if (files.length > 20 || files.some((file) => file.size > 50 * 1024 * 1024))
      return panelError(
        'panel-image',
        'Choose up to 20 images, each no larger than 50 MB.'
      );
    const generation = imageGeneration;
    setBusy(imgInput, true);
    panelStatus('panel-image', 'Compressing images. Please wait...');

    const formData = new FormData();
    files.forEach((f) => formData.append('images', f));
    formData.append('quality', imgQuality.value);
    formData.append('format', imgFormat.value);

    try {
      showToast('Compressing images...');
      const res = await fetch('/api/compress/image', {
        method: 'POST',
        body: formData
      });
      const data = await handleApiResponse(res);

      if (data.files && generation === imageGeneration) {
        imageFilesList = [...imageFilesList, ...data.files];
        renderImageResults();
        panelStatus(
          'panel-image',
          data.files.length + ' image(s) ready to download.',
          'success'
        );
      }
    } catch (err) {
      panelStatus('panel-image', err.message, 'error');
      showToast(err.message);
    } finally {
      setBusy(imgInput, false);
    }
  }

  function renderImageResults() {
    if (!imageFilesList.length) return imgResultsCard.classList.add('hidden');
    imgResultsCard.classList.remove('hidden');
    imgCount.textContent = imageFilesList.length;
    imgList.innerHTML = '';

    imageFilesList.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'file-row';
      const thumbHtml = item.preview
        ? `<img src="${escapeHtml(item.preview)}" alt="preview" class="file-row-thumb">`
        : '';
      const qualityHtml = Number.isInteger(item.quality)
        ? `<div class="file-row-stats">Quality ${item.quality}/100 · ${escapeHtml(item.compressionMode)}</div>`
        : '';
      row.innerHTML = `
        <div class="file-row-left">
          ${thumbHtml}
          <div>
            <div class="file-row-name">${escapeHtml(item.outputFilename)}</div>
            <div class="file-row-stats">${escapeHtml(item.originalSizeFormatted)} → <strong>${escapeHtml(item.compressedSizeFormatted)}</strong></div>
            ${qualityHtml}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.6rem;">
          <span class="badge-save">-${escapeHtml(item.savedPercentage)}%</span>
          <a href="${escapeHtml(item.downloadUrl)}" download="${escapeHtml(item.outputFilename)}" class="btn btn-primary btn-sm">Download</a>
        </div>
      `;

      imgList.appendChild(row);
    });
  }

  imgClearBtn.addEventListener('click', () => {
    imageGeneration++;
    imageFilesList = [];
    imgInput.value = '';
    renderImageResults();
    panelStatus('panel-image', '');
  });
  imgZipBtn.addEventListener('click', async () => {
    if (!imageFilesList.length) return;
    try {
      showToast('Preparing ZIP archive...');
      const fileIds = imageFilesList.map((f) => f.fileId);
      const res = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to generate ZIP archive.');
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = 'omnitools-images.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        window.URL.revokeObjectURL(blobUrl);
      }, 10000);
    } catch (e) {
      showToast('ZIP download failed: ' + e.message);
    }
  });

  // ====================================================================
  // MODULE 2: VIDEO COMPRESSOR CLIENT LOGIC
  // ====================================================================
  ['dragenter', 'dragover'].forEach((name) => {
    videoDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      videoDropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    videoDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      videoDropZone.classList.remove('dragover');
    });
  });
  videoDropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length)
      processVideoUpload(e.dataTransfer.files[0]);
  });
  videoInput.addEventListener('change', (e) => {
    if (e.target.files.length) processVideoUpload(e.target.files[0]);
  });

  async function processVideoUpload(file) {
    if (videoInput.disabled) return;
    videoInput.value = '';
    videoResultsCard.classList.add('hidden');
    if (
      !file.type.startsWith('video/') &&
      !/\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)
    )
      return panelError('panel-video', 'Please select a valid video file.');
    if (file.size > 500 * 1024 * 1024)
      return panelError(
        'panel-video',
        'Video files must be no larger than 500 MB.'
      );
    setBusy(videoInput, true);
    panelStatus(
      'panel-video',
      'Compressing video. Large files can take several minutes; keep this tab open.'
    );
    const formData = new FormData();
    formData.append('video', file);

    try {
      showToast('Compressing video file...');
      const res = await fetch('/api/compress/video', {
        method: 'POST',
        body: formData
      });
      const data = await handleApiResponse(res);

      if (data.file) {
        videoResultsCard.classList.remove('hidden');
        panelStatus(
          'panel-video',
          data.file.compressedSize > data.file.originalSize
            ? 'Video converted. This output is larger than the original.'
            : 'Video ready to download.',
          'success'
        );
        videoResultBox.innerHTML = `
          <div class="file-row">
            <div>
              <div class="file-row-name">${escapeHtml(data.file.outputFilename)}</div>
              <div class="file-row-stats">${escapeHtml(data.file.originalSizeFormatted)} → <strong>${escapeHtml(data.file.compressedSizeFormatted)}</strong></div>
            </div>
            <a href="${escapeHtml(data.file.downloadUrl)}" download="${escapeHtml(data.file.outputFilename)}" class="btn btn-primary btn-sm">Download Video</a>
          </div>
        `;
      }
    } catch (err) {
      panelStatus('panel-video', err.message, 'error');
      showToast(err.message);
    } finally {
      setBusy(videoInput, false);
    }
  }

  // ====================================================================
  // MODULE 4: PDF CONVERTER CLIENT LOGIC
  // ====================================================================
  tabPdfToWord.addEventListener('click', () => {
    if (documentBusy) return;
    pdfResultsCard.classList.add('hidden');
    panelStatus('panel-pdf', '');
    tabPdfToWord.classList.add('active');
    tabWordToPdf.classList.remove('active');
    pdfToWordCard.classList.remove('hidden');
    wordToPdfCard.classList.add('hidden');
  });

  tabWordToPdf.addEventListener('click', () => {
    if (documentBusy) return;
    pdfResultsCard.classList.add('hidden');
    panelStatus('panel-pdf', '');
    tabWordToPdf.classList.add('active');
    tabPdfToWord.classList.remove('active');
    wordToPdfCard.classList.remove('hidden');
    pdfToWordCard.classList.add('hidden');
  });

  ['dragenter', 'dragover'].forEach((name) => {
    pdfDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      pdfDropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    pdfDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      pdfDropZone.classList.remove('dragover');
    });
  });
  pdfDropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) processPdfUpload(e.dataTransfer.files[0]);
  });
  pdfInput.addEventListener('change', (e) => {
    if (e.target.files.length) processPdfUpload(e.target.files[0]);
  });

  async function processPdfUpload(file) {
    if (documentBusy) return;
    pdfResultsCard.classList.add('hidden');
    pdfInput.value = '';
    if (file.size > 20 * 1024 * 1024)
      return panelError('panel-pdf', 'Documents must be no larger than 20 MB.');
    if (!file.name.toLowerCase().endsWith('.pdf'))
      return panelError('panel-pdf', 'Please select a valid PDF file.');
    const formData = new FormData();
    formData.append('pdf', file);
    documentProcessing(true);
    panelStatus('panel-pdf', 'Converting document. Please wait...');

    try {
      showToast('Converting PDF to Word (.docx)...');
      const res = await fetch('/api/pdf/pdf-to-word', {
        method: 'POST',
        body: formData
      });
      const data = await handleApiResponse(res);

      if (data.file) {
        pdfResultsCard.classList.remove('hidden');
        panelStatus(
          'panel-pdf',
          data.file.notice || 'Document ready to download.',
          'success'
        );
        pdfResultBox.innerHTML = `
          <div class="file-row">
            <div>
              <div class="file-row-name">${escapeHtml(data.file.outputFilename)}</div>
              <div class="file-row-stats">${escapeHtml(data.file.fileSizeFormatted)} • Word Document</div>
            </div>
            <a href="${escapeHtml(data.file.downloadUrl)}" download="${escapeHtml(data.file.outputFilename)}" class="btn btn-primary btn-sm">Download Word File</a>
          </div>
        `;
      }
    } catch (err) {
      panelStatus('panel-pdf', err.message, 'error');
      showToast(err.message);
    } finally {
      documentProcessing(false);
    }
  }

  // Word (.docx) Drop Zone & Upload
  if (wordDropZone && wordInput) {
    ['dragenter', 'dragover'].forEach((name) => {
      wordDropZone.addEventListener(name, (e) => {
        e.preventDefault();
        wordDropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      wordDropZone.addEventListener(name, (e) => {
        e.preventDefault();
        wordDropZone.classList.remove('dragover');
      });
    });
    wordDropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length)
        processWordUpload(e.dataTransfer.files[0]);
    });
    wordInput.addEventListener('change', (e) => {
      if (e.target.files.length) processWordUpload(e.target.files[0]);
    });
  }

  async function processWordUpload(file) {
    if (documentBusy) return;
    pdfResultsCard.classList.add('hidden');
    wordInput.value = '';
    if (file.size > 20 * 1024 * 1024)
      return panelError('panel-pdf', 'Documents must be no larger than 20 MB.');
    const validExtensions = ['.docx', '.txt'];
    const hasValidExt = validExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );
    if (!hasValidExt)
      return panelError(
        'panel-pdf',
        'Please select a valid Word (.docx) or text file.'
      );

    const formData = new FormData();
    formData.append('document', file);
    documentProcessing(true);
    panelStatus('panel-pdf', 'Converting document. Please wait...');

    try {
      showToast('Converting Word document to PDF...');
      const res = await fetch('/api/pdf/word-to-pdf', {
        method: 'POST',
        body: formData
      });
      const data = await handleApiResponse(res);

      if (data.file) {
        pdfResultsCard.classList.remove('hidden');
        panelStatus(
          'panel-pdf',
          data.file.notice || 'Document ready to download.',
          'success'
        );
        pdfResultBox.innerHTML = `
          <div class="file-row">
            <div>
              <div class="file-row-name">${escapeHtml(data.file.outputFilename)}</div>
              <div class="file-row-stats">${escapeHtml(data.file.fileSizeFormatted)} • PDF Document</div>
            </div>
            <a href="${escapeHtml(data.file.downloadUrl)}" download="${escapeHtml(data.file.outputFilename)}" class="btn btn-primary btn-sm">Download PDF</a>
          </div>
        `;
      }
    } catch (err) {
      panelStatus('panel-pdf', err.message, 'error');
      showToast(err.message);
    } finally {
      documentProcessing(false);
    }
  }

  generatePdfBtn.addEventListener('click', async () => {
    if (documentBusy) return;
    pdfResultsCard.classList.add('hidden');
    const text = pdfTextInput.value;
    if (!text.trim())
      return panelError('panel-pdf', 'Please enter text content.');

    documentProcessing(true);
    panelStatus('panel-pdf', 'Generating PDF. Please wait...');
    try {
      showToast('Generating PDF document...');
      const res = await fetch('/api/pdf/word-to-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await handleApiResponse(res);

      if (data.file) {
        pdfResultsCard.classList.remove('hidden');
        panelStatus(
          'panel-pdf',
          data.file.notice || 'PDF ready to download.',
          'success'
        );
        pdfResultBox.innerHTML = `
          <div class="file-row">
            <div>
              <div class="file-row-name">${escapeHtml(data.file.outputFilename)}</div>
              <div class="file-row-stats">${escapeHtml(data.file.fileSizeFormatted)} • PDF Document</div>
            </div>
            <a href="${escapeHtml(data.file.downloadUrl)}" download="${escapeHtml(data.file.outputFilename)}" class="btn btn-primary btn-sm">Download PDF</a>
          </div>
        `;
      }
    } catch (err) {
      panelStatus('panel-pdf', err.message, 'error');
      showToast(err.message);
    } finally {
      documentProcessing(false);
    }
  });

  // ====================================================================
  // MODULE 5: URL SHORTENER CLIENT LOGIC
  // ====================================================================
  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = urlForm.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    urlResultBox.classList.add('hidden');
    panelStatus('panel-shortener', 'Creating short link...');
    const originalUrl = longUrlInput.value;
    const customAlias = customAliasInput.value;

    try {
      showToast('Creating short link...');
      const res = await fetch('/api/url/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalUrl, customAlias })
      });
      const data = await handleApiResponse(res);

      if (data.shortUrl) {
        urlResultBox.classList.remove('hidden');
        shortUrlOutput.value = data.shortUrl;
        panelStatus('panel-shortener', 'Short link ready to copy.', 'success');
      }
    } catch (err) {
      panelStatus('panel-shortener', err.message, 'error');
      showToast(err.message);
    } finally {
      submit.disabled = false;
    }
  });

  copyUrlBtn.addEventListener('click', async () => {
    if (!shortUrlOutput.value) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shortUrlOutput.value);
      } else {
        shortUrlOutput.select();
        if (!document.execCommand('copy')) throw new Error('Copy unavailable');
      }
      showToast('Short URL copied to clipboard!');
    } catch {
      shortUrlOutput.select();
      showToast(
        'Could not copy automatically. Copy the selected link manually.'
      );
    }
  });
});
