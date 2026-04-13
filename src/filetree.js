import { createFileModal } from './modal.js';

const DEFAULT_EMPTY_MESSAGE = 'Create or open a .tex file to begin editing.';

export function initFileTree({
  container,
  onSelectFile,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  onUploadImage,
  onSelectImage,
  onDeleteImage,
}) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'file-tree-header';
  header.innerHTML = `
    <span>Files</span>
    <div class="file-tree-actions">
      <button class="add-file-button" data-action="upload-image" title="Upload image" aria-label="Upload image"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
      <button class="add-file-button" data-action="new-file" title="New file" aria-label="Create file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg></button>
    </div>
  `;

  const list = document.createElement('ul');
  list.className = 'file-tree-list';

  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  emptyState.textContent = DEFAULT_EMPTY_MESSAGE;

  container.append(header, list, emptyState);

  const newFileModal = createFileModal({
    title: 'New LaTeX File',
    label: 'File name',
    placeholder: 'chapter.tex',
    submitLabel: 'Create',
    onSubmit: (filename) => {
      const trimmed = filename.trim();
      if (!trimmed) {
        return { ok: false, message: 'File name is required.' };
      }
      return onCreateFile?.(trimmed) ?? { ok: true };
    },
  });

  const contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu hidden';
  contextMenu.innerHTML = `
    <button data-action="rename">Rename</button>
    <button data-action="delete">Delete</button>
  `;
  document.body.appendChild(contextMenu);

  const imageContextMenu = document.createElement('div');
  imageContextMenu.className = 'context-menu hidden';
  imageContextMenu.innerHTML = `
    <button data-action="insert">Insert in document</button>
    <button data-action="delete">Delete</button>
  `;
  document.body.appendChild(imageContextMenu);

  let currentFiles = {};
  let currentImages = {};
  let activeFile = '';
  let readonlySet = new Set();
  let contextTarget = '';
  let contextImageTarget = '';

  const hideContextMenu = () => {
    contextMenu.classList.add('hidden');
    imageContextMenu.classList.add('hidden');
  };

  document.addEventListener('click', hideContextMenu);
  window.addEventListener('blur', hideContextMenu);

  function handleContextAction(action) {
    if (!contextTarget) return;
    const isReadOnly = readonlySet.has(contextTarget);
    if (isReadOnly && action !== 'select') return;

    if (action === 'rename') {
      const nextName = prompt('Rename file', contextTarget);
      if (!nextName || nextName === contextTarget) return;
      onRenameFile?.(contextTarget, nextName.trim());
    }

    if (action === 'delete') {
      const confirmed = confirm(`Delete ${contextTarget}? This cannot be undone.`);
      if (!confirmed) return;
      onDeleteFile?.(contextTarget);
    }
  }

  contextMenu.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    handleContextAction(button.dataset.action);
    hideContextMenu();
  });

  imageContextMenu.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !contextImageTarget) return;
    if (button.dataset.action === 'insert') {
      onSelectImage?.(contextImageTarget);
    } else if (button.dataset.action === 'delete') {
      const confirmed = confirm(`Remove image ${contextImageTarget}?`);
      if (confirmed) onDeleteImage?.(contextImageTarget);
    }
    hideContextMenu();
  });

  list.addEventListener('click', (event) => {
    const imageItem = event.target.closest('[data-image]');
    if (imageItem) {
      onSelectImage?.(imageItem.dataset.image);
      return;
    }
    const item = event.target.closest('[data-file]');
    if (!item) return;
    onSelectFile?.(item.dataset.file);
  });

  list.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const imageItem = event.target.closest('[data-image]');
    if (imageItem) {
      contextImageTarget = imageItem.dataset.image;
      imageContextMenu.style.top = `${event.clientY}px`;
      imageContextMenu.style.left = `${event.clientX}px`;
      imageContextMenu.classList.remove('hidden');
      contextMenu.classList.add('hidden');
      return;
    }
    const item = event.target.closest('[data-file]');
    if (!item) {
      hideContextMenu();
      return;
    }
    contextTarget = item.dataset.file;
    const isReadOnly = readonlySet.has(contextTarget);
    contextMenu.querySelectorAll('button').forEach((btn) => {
      btn.disabled = isReadOnly;
      if (isReadOnly) {
        btn.classList.add('is-disabled');
      } else {
        btn.classList.remove('is-disabled');
      }
    });
    contextMenu.style.top = `${event.clientY}px`;
    contextMenu.style.left = `${event.clientX}px`;
    contextMenu.classList.remove('hidden');
    imageContextMenu.classList.add('hidden');
  });

  header.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'new-file') newFileModal.open();
    else if (btn.dataset.action === 'upload-image') onUploadImage?.();
  });

  function render(files, nextActiveFile, readOnlyFiles = [], images = {}) {
    currentFiles = { ...files };
    currentImages = { ...images };
    activeFile = nextActiveFile;
    readonlySet = new Set(readOnlyFiles);

    const fileEntries = Object.keys(currentFiles).sort((a, b) => a.localeCompare(b));
    const imageEntries = Object.keys(currentImages).sort((a, b) => a.localeCompare(b));
    list.innerHTML = '';

    if (!fileEntries.length && !imageEntries.length) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    fileEntries.forEach((name) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      if (name === activeFile) li.classList.add('is-active');
      if (readonlySet.has(name)) li.classList.add('is-readonly');
      li.dataset.file = name;
      li.innerHTML = `
        <span>${name}</span>
        ${readonlySet.has(name) ? '<span title="Read only">&#128274;</span>' : ''}
      `;
      list.appendChild(li);
    });

    imageEntries.forEach((name) => {
      const item = currentImages[name];
      const li = document.createElement('li');
      li.className = 'file-item file-item-image';
      li.dataset.image = name;
      li.title = `Click to insert \\includegraphics{${name}}`;
      li.innerHTML = `
        <img class="file-item-thumb" src="${item.url}" alt="" />
        <span class="file-item-name">${name}</span>
      `;
      list.appendChild(li);
    });
  }

  return { render };
}
