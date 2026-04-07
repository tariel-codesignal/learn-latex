const DEFAULT_ZOOM_LEVELS = [50, 75, 100, 125, 150, 175, 200];

function buildZoomOptions(levels) {
  return levels.map((level) => `<option value="${level}">${level}%</option>`).join('');
}

export const ZOOM_LEVELS = DEFAULT_ZOOM_LEVELS;

export function createPreviewControls({
  container,
  onCompile,
  onToggleAutoRender,
  onPageStep,
  onPageJump,
  onZoomStep,
  onZoomSelect,
  zoomLevels = DEFAULT_ZOOM_LEVELS,
}) {
  container.innerHTML = `
    <div class="preview-controls-left">
      <button class="button" data-preview-compile>Compile</button>
      <label class="toggle preview-toggle">
        <input type="checkbox" id="preview-auto-toggle" checked />
        <span class="toggle-switch"></span>
        <span class="toggle-label">Auto</span>
      </label>
      <span class="preview-status" data-preview-status>Ready</span>
    </div>
    <div class="preview-controls-right">
      <button class="preview-icon-button" data-page-up title="Previous page">&#8593;</button>
      <button class="preview-icon-button" data-page-down title="Next page">&#8595;</button>
      <div class="preview-page-indicator">
        <input type="number" min="1" value="1" data-page-input />
        <span class="preview-page-total" data-page-total>/ 1</span>
      </div>
      <button class="preview-icon-button" data-zoom-out title="Zoom out">&#8722;</button>
      <button class="preview-icon-button" data-zoom-in title="Zoom in">&#43;</button>
      <select class="preview-zoom-select" data-zoom-select>
        ${buildZoomOptions(zoomLevels)}
      </select>
    </div>
  `;

  const compileButton = container.querySelector('[data-preview-compile]');
  const toggleInput = container.querySelector('#preview-auto-toggle');
  const toggleLabel = container.querySelector('.preview-toggle .toggle-label');
  const pageUpBtn = container.querySelector('[data-page-up]');
  const pageDownBtn = container.querySelector('[data-page-down]');
  const pageInput = container.querySelector('[data-page-input]');
  const pageTotal = container.querySelector('[data-page-total]');
  const zoomOutBtn = container.querySelector('[data-zoom-out]');
  const zoomInBtn = container.querySelector('[data-zoom-in]');
  const zoomSelect = container.querySelector('[data-zoom-select]');
  const statusEl = container.querySelector('[data-preview-status]');

  let totalPages = 0;
  let currentPage = 0;
  let currentZoom = 100;

  compileButton.addEventListener('click', () => {
    onCompile?.();
  });

  toggleInput.addEventListener('change', () => {
    const enabled = toggleInput.checked;
    toggleLabel.textContent = enabled ? 'Auto' : 'Manual';
    compileButton.classList.toggle('is-muted', enabled);
    onToggleAutoRender?.(enabled);
  });

  pageUpBtn.addEventListener('click', () => {
    if (!totalPages) return;
    onPageStep?.(-1);
  });

  pageDownBtn.addEventListener('click', () => {
    if (!totalPages) return;
    onPageStep?.(1);
  });

  function commitPageInput() {
    if (!totalPages) {
      pageInput.value = '';
      return;
    }
    const nextValue = Number(pageInput.value);
    if (Number.isNaN(nextValue)) {
      pageInput.value = currentPage;
      return;
    }
    const clamped = Math.min(Math.max(nextValue, 1), totalPages);
    if (clamped !== currentPage) {
      onPageJump?.(clamped);
    } else {
      pageInput.value = currentPage;
    }
  }

  pageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      commitPageInput();
      pageInput.blur();
    }
  });

  pageInput.addEventListener('blur', commitPageInput);

  zoomOutBtn.addEventListener('click', () => {
    onZoomStep?.(-1);
  });

  zoomInBtn.addEventListener('click', () => {
    onZoomStep?.(1);
  });

  zoomSelect.addEventListener('change', () => {
    const nextValue = Number(zoomSelect.value);
    if (Number.isNaN(nextValue)) return;
    onZoomSelect?.(nextValue);
  });

  function setAutoRender(enabled) {
    toggleInput.checked = enabled;
    toggleLabel.textContent = enabled ? 'Auto' : 'Manual';
    compileButton.classList.toggle('is-muted', enabled);
  }

  function setPageInfo({ current = 0, total = 0 }) {
    totalPages = total;
    currentPage = total ? Math.min(Math.max(current, 1), total) : 0;
    if (!totalPages) {
      pageInput.value = '';
      pageInput.placeholder = '—';
      pageInput.disabled = true;
      pageTotal.textContent = '/ 0';
      pageUpBtn.disabled = true;
      pageDownBtn.disabled = true;
    } else {
      pageInput.disabled = false;
      pageInput.placeholder = '';
      pageInput.value = currentPage;
      pageInput.max = totalPages;
      pageTotal.textContent = `/ ${totalPages}`;
      pageUpBtn.disabled = currentPage <= 1;
      pageDownBtn.disabled = currentPage >= totalPages;
    }
  }

  function setZoom(value) {
    currentZoom = value;
    zoomSelect.value = String(value);
  }

  function setZoomControlsState({ canZoomIn = true, canZoomOut = true } = {}) {
    zoomInBtn.disabled = !canZoomIn;
    zoomOutBtn.disabled = !canZoomOut;
  }

  function setStatus(text, type = 'ready') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove('is-busy', 'is-error', 'is-ready');
    if (type === 'busy') statusEl.classList.add('is-busy');
    if (type === 'error') statusEl.classList.add('is-error');
    if (type === 'ready') statusEl.classList.add('is-ready');
  }

  return {
    setAutoRender,
    setPageInfo,
    setZoom,
    setZoomControlsState,
    setStatus,
    getCurrentZoom: () => currentZoom,
  };
}
