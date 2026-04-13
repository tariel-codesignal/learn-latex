// 2 MB per image, up to 10 images total — small enough that the running tab
// stays comfortable even on modest devices.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_COUNT = 10;

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
]);

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function createImageUploadModal({ onAdd, onRemove, getImages }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.innerHTML = `
    <div class="modal modal-wide">
      <form class="modal-form">
        <header class="modal-header">
          <h3>Upload images</h3>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </header>
        <label class="image-dropzone">
          <input type="file" accept="image/*" multiple hidden data-image-input />
          <span class="image-dropzone-cta">Click to choose images</span>
          <small class="image-dropzone-hint">PNG, JPG, GIF, SVG, WEBP — max ${formatBytes(MAX_IMAGE_BYTES)} each, up to ${MAX_IMAGE_COUNT} total.</small>
        </label>
        <p class="modal-error" data-image-error></p>
        <ul class="image-list" data-image-list></ul>
        <footer class="modal-footer">
          <button type="button" class="button" data-dismiss>Done</button>
        </footer>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const fileInput = overlay.querySelector('[data-image-input]');
  const errorEl = overlay.querySelector('[data-image-error]');
  const listEl = overlay.querySelector('[data-image-list]');
  const closeButton = overlay.querySelector('.modal-close');
  const doneButton = overlay.querySelector('[data-dismiss]');

  function setError(msg = '') {
    errorEl.textContent = msg;
    errorEl.style.display = msg ? 'block' : 'none';
  }

  function close() {
    overlay.classList.add('hidden');
    setError('');
  }

  function open() {
    overlay.classList.remove('hidden');
    refreshList();
  }

  function refreshList() {
    const images = getImages?.() ?? {};
    const names = Object.keys(images);
    listEl.innerHTML = '';
    if (!names.length) {
      const empty = document.createElement('li');
      empty.className = 'image-list-empty';
      empty.textContent = 'No images uploaded yet.';
      listEl.appendChild(empty);
      return;
    }
    names.sort((a, b) => a.localeCompare(b)).forEach((name) => {
      const item = images[name];
      const li = document.createElement('li');
      li.className = 'image-list-item';
      li.innerHTML = `
        <img src="${item.url}" alt="" class="image-list-thumb" />
        <div class="image-list-meta">
          <code class="image-list-name">${name}</code>
          <small class="image-list-size">${formatBytes(item.size)}</small>
        </div>
        <button type="button" class="image-list-remove" data-remove="${name}" title="Remove">&times;</button>
      `;
      listEl.appendChild(li);
    });
  }

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    onRemove?.(btn.dataset.remove);
    refreshList();
  });

  fileInput.addEventListener('change', () => {
    setError('');
    const files = Array.from(fileInput.files ?? []);
    if (!files.length) return;
    const messages = [];
    const existing = getImages?.() ?? {};
    let count = Object.keys(existing).length;
    files.forEach((file) => {
      if (count >= MAX_IMAGE_COUNT) {
        messages.push(`Reached upload limit (${MAX_IMAGE_COUNT}) — skipped "${file.name}".`);
        return;
      }
      if (!ALLOWED_MIMES.has(file.type) && !file.type.startsWith('image/')) {
        messages.push(`Skipped "${file.name}": not an image.`);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        messages.push(`Skipped "${file.name}": ${formatBytes(file.size)} exceeds ${formatBytes(MAX_IMAGE_BYTES)} limit.`);
        return;
      }
      const result = onAdd?.(file);
      if (result && result.ok === false) {
        messages.push(result.message || `Skipped "${file.name}".`);
      } else {
        count += 1;
      }
    });
    fileInput.value = '';
    if (messages.length) setError(messages.join(' '));
    refreshList();
  });

  closeButton.addEventListener('click', close);
  doneButton.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('hidden') && e.key === 'Escape') close();
  });

  return { open, close, refresh: refreshList };
}
