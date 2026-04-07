import { createFileModal } from './modal.js';

const DEFAULT_EMPTY_MESSAGE = 'Create or open a .tex file to begin editing.';

export function initFileTree({ container, onSelectFile, onCreateFile, onRenameFile, onDeleteFile }) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'file-tree-header';
  header.innerHTML = `
    <span>Files</span>
    <button class="add-file-button" title="New file" aria-label="Create file">+</button>
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

  let currentFiles = {};
  let activeFile = '';
  let readonlySet = new Set();
  let contextTarget = '';

  const hideContextMenu = () => {
    contextMenu.classList.add('hidden');
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

  list.addEventListener('click', (event) => {
    const item = event.target.closest('[data-file]');
    if (!item) return;
    const filename = item.dataset.file;
    onSelectFile?.(filename);
  });

  list.addEventListener('contextmenu', (event) => {
    event.preventDefault();
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
  });

  header.querySelector('.add-file-button').addEventListener('click', () => {
    newFileModal.open();
  });

  function render(files, nextActiveFile, readOnlyFiles = []) {
    currentFiles = { ...files };
    activeFile = nextActiveFile;
    readonlySet = new Set(readOnlyFiles);

    const entries = Object.keys(currentFiles).sort((a, b) => a.localeCompare(b));
    list.innerHTML = '';

    if (!entries.length) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    entries.forEach((name) => {
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
  }

  return { render };
}
