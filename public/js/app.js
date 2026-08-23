document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const qualitySlider = document.getElementById('qualitySlider');
  const qualityValue = document.getElementById('qualityValue');
  const presetChips = document.querySelectorAll('.btn-chip');
  const formatSelect = document.getElementById('formatSelect');
  
  const enableResize = document.getElementById('enableResize');
  const resizeInputsRow = document.getElementById('resizeInputsRow');
  const resizeWidth = document.getElementById('resizeWidth');
  const resizeHeight = document.getElementById('resizeHeight');
  const aspectRatioCheck = document.getElementById('aspectRatioCheck');

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  const loaderContainer = document.getElementById('loaderContainer');
  const loaderFill = document.getElementById('loaderFill');
  const loaderText = document.getElementById('loaderText');

  const resultsCard = document.getElementById('resultsCard');
  const fileCountText = document.getElementById('fileCountText');
  const totalOrigSizeEl = document.getElementById('totalOrigSize');
  const totalCompSizeEl = document.getElementById('totalCompSize');
  const totalSaveBadge = document.getElementById('totalSaveBadge');
  const totalSavedHeader = document.getElementById('totalSavedHeader');
  const fileList = document.getElementById('fileList');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');

  const previewModal = document.getElementById('previewModal');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalImg = document.getElementById('modalImg');
  const modalCaption = document.getElementById('modalCaption');

  // --- State ---
  let processedFiles = []; // Array of processed file objects from API

  // --- Helper Functions ---
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // --- Quality Slider & Presets ---
  qualitySlider.addEventListener('input', (e) => {
    const val = e.target.value;
    qualityValue.textContent = val + '%';
    updateActiveChip(val);
  });

  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const preset = chip.dataset.preset;
      qualitySlider.value = preset;
      qualityValue.textContent = preset + '%';
      updateActiveChip(preset);
    });
  });

  function updateActiveChip(val) {
    presetChips.forEach(chip => {
      if (chip.dataset.preset === val) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
  }

  // --- Resize Settings Toggle ---
  enableResize.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    if (isChecked) {
      resizeInputsRow.classList.remove('disabled');
      resizeWidth.disabled = false;
      resizeHeight.disabled = false;
      aspectRatioCheck.disabled = false;
    } else {
      resizeInputsRow.classList.add('disabled');
      resizeWidth.disabled = true;
      resizeHeight.disabled = true;
      aspectRatioCheck.disabled = true;
    }
  });

  // --- Drag & Drop Handlers ---
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFilesUpload(files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesUpload(e.target.files);
      fileInput.value = ''; // Reset input
    }
  });

  // --- Upload & Compression Logic ---
  async function handleFilesUpload(fileListObj) {
    const files = Array.from(fileListObj).filter(file => file.type.startsWith('image/'));
    
    if (files.length === 0) {
      alert('Please select valid image files (JPG, PNG, WebP, AVIF, etc.)');
      return;
    }

    // Prepare FormData
    const formData = new FormData();
    files.forEach(file => formData.append('images', file));
    formData.append('quality', qualitySlider.value);
    formData.append('format', formatSelect.value);

    if (enableResize.checked) {
      if (resizeWidth.value) formData.append('width', resizeWidth.value);
      if (resizeHeight.value) formData.append('height', resizeHeight.value);
      formData.append('maintainAspectRatio', aspectRatioCheck.checked);
    }

    // UI Progress State
    showLoader(true);
    updateProgress(30, 'Uploading & optimizing images...');

    try {
      const response = await fetch('/api/compress', {
        method: 'POST',
        body: formData
      });

      updateProgress(80, 'Finalizing compression specs...');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Server processing failed.');
      }

      const data = await response.json();
      updateProgress(100, 'Done!');

      setTimeout(() => {
        showLoader(false);
        if (data.files && data.files.length > 0) {
          processedFiles = [...processedFiles, ...data.files];
          renderResults();
        }
      }, 300);

    } catch (err) {
      console.error('Compression request error:', err);
      showLoader(false);
      alert('Error compressing images: ' + err.message);
    }
  }

  function showLoader(show) {
    if (show) {
      loaderContainer.classList.remove('hidden');
    } else {
      loaderContainer.classList.add('hidden');
      loaderFill.style.width = '0%';
    }
  }

  function updateProgress(percent, text) {
    loaderFill.style.width = `${percent}%`;
    if (text) loaderText.textContent = text;
  }

  // --- Render Results ---
  function renderResults() {
    if (processedFiles.length === 0) {
      resultsCard.classList.add('hidden');
      updateGlobalStats(0);
      return;
    }

    resultsCard.classList.remove('hidden');
    fileList.innerHTML = '';

    let totalOrig = 0;
    let totalComp = 0;

    processedFiles.forEach((fileItem) => {
      totalOrig += fileItem.originalSize;
      totalComp += fileItem.compressedSize;

      const itemEl = document.createElement('div');
      itemEl.className = 'file-item';
      itemEl.innerHTML = `
        <div class="file-left">
          <img src="${fileItem.preview}" alt="${fileItem.outputFilename}" class="file-thumb" data-file-id="${fileItem.fileId}">
          <div class="file-info">
            <div class="file-name" title="${fileItem.outputFilename}">${fileItem.outputFilename}</div>
            <div class="file-meta">
              <span class="format-tag">${fileItem.format}</span>
              <span>${fileItem.originalDimensions}</span>
            </div>
          </div>
        </div>

        <div class="file-stats-row">
          <div class="size-comparison">
            <span class="orig-size">${fileItem.originalSizeFormatted}</span>
            <span class="arrow-right">→</span>
            <span class="comp-size">${fileItem.compressedSizeFormatted}</span>
          </div>

          <span class="save-percent">-${fileItem.savedPercentage}%</span>

          <a href="/api/download/${fileItem.fileId}" class="btn btn-secondary btn-sm" download="${fileItem.outputFilename}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download
          </a>
        </div>
      `;

      // Thumb click preview modal
      const thumb = itemEl.querySelector('.file-thumb');
      thumb.addEventListener('click', () => {
        openModal(fileItem.preview, `${fileItem.outputFilename} (${fileItem.compressedSizeFormatted})`);
      });

      fileList.appendChild(itemEl);
    });

    // Update Summary Header
    fileCountText.textContent = processedFiles.length;
    totalOrigSizeEl.textContent = formatBytes(totalOrig);
    totalCompSizeEl.textContent = formatBytes(totalComp);

    const totalSavedBytes = Math.max(0, totalOrig - totalComp);
    const overallPercent = totalOrig > 0 ? Math.round((totalSavedBytes / totalOrig) * 100) : 0;
    totalSaveBadge.textContent = `-${overallPercent}% Saved`;

    updateGlobalStats(totalSavedBytes);
  }

  function updateGlobalStats(savedBytes) {
    totalSavedHeader.textContent = formatBytes(savedBytes);
  }

  // --- Clear All ---
  clearAllBtn.addEventListener('click', () => {
    processedFiles = [];
    renderResults();
  });

  // --- Download Batch ZIP ---
  downloadZipBtn.addEventListener('click', async () => {
    if (processedFiles.length === 0) return;

    const fileIds = processedFiles.map(f => f.fileId);

    try {
      downloadZipBtn.disabled = true;
      downloadZipBtn.textContent = 'Generating ZIP...';

      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds })
      });

      if (!response.ok) {
        throw new Error('Failed to generate ZIP archive.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'compressed-images-bundle.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

    } catch (err) {
      console.error('ZIP download error:', err);
      alert('Failed to download ZIP bundle.');
    } finally {
      downloadZipBtn.disabled = false;
      downloadZipBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Download All (ZIP)
      `;
    }
  });

  // --- Image Preview Modal ---
  function openModal(src, captionText) {
    modalImg.src = src;
    modalCaption.textContent = captionText;
    previewModal.classList.remove('hidden');
  }

  function closeModal() {
    previewModal.classList.add('hidden');
    modalImg.src = '';
  }

  modalOverlay.addEventListener('click', closeModal);
  modalCloseBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !previewModal.classList.contains('hidden')) {
      closeModal();
    }
  });
});
