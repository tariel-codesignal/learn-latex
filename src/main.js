import './style.css';
import { createEditor } from './editor.js';
import { createPreview } from './preview.js';
import { initFileTree } from './filetree.js';
import { initToolbar } from './toolbar.js';

const state = {
  files: {},
  activeFile: '',
  readOnlyFiles: new Set(),
  autoRender: true,
};

const refs = {
  editor: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  fileTree: document.getElementById('file-tree'),
  toolbar: document.getElementById('toolbar'),
};

let editorApi;
let previewApi;
let fileTreeApi;
let toolbarApi;
let renderTimer = null;
let snapshotTimer = null;

function initModules() {
  previewApi = createPreview(refs.preview);

  editorApi = createEditor({
    parent: refs.editor,
    doc: '',
    readOnly: false,
    onChange: (doc) => {
      if (!state.activeFile) return;
      state.files[state.activeFile] = doc;
      scheduleSnapshot();
      if (state.autoRender) {
        scheduleRender();
      }
    },
  });

  toolbarApi = initToolbar({
    container: refs.toolbar,
    onCompile: () => renderActiveFile(),
    onToggleAutoRender: (enabled) => {
      state.autoRender = enabled;
      if (enabled) {
        scheduleRender({ immediate: true });
      }
    },
  });

  fileTreeApi = initFileTree({
    container: refs.fileTree,
    onSelectFile: (filename) => {
      if (filename === state.activeFile) return;
      setActiveFile(filename);
      if (state.autoRender) {
        scheduleRender({ immediate: true });
      }
    },
    onCreateFile: handleCreateFile,
    onRenameFile: handleRenameFile,
    onDeleteFile: handleDeleteFile,
  });

  setupResizers();
}

function scheduleRender({ immediate = false } = {}) {
  if (!state.activeFile) return;
  if (immediate) {
    clearTimeout(renderTimer);
    renderActiveFile();
    return;
  }
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderActiveFile, 500);
}

function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = window.setTimeout(() => {
    const payload = {
      files: state.files,
      activeFile: state.activeFile,
    };
    fetch('/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err) => console.error('Failed to send snapshot', err));
  }, 1000);
}

function renderActiveFile() {
  if (!state.activeFile) return;
  toolbarApi?.setStatus('Rendering...', 'busy');
  try {
    const result = previewApi.render(state.files[state.activeFile] ?? '');
    if (result.ok) {
      toolbarApi?.setStatus('Ready', 'ready');
    } else {
      toolbarApi?.setStatus('Error', 'error');
    }
  } catch (err) {
    toolbarApi?.setStatus('Error', 'error');
    console.error(err);
  }
}

function setActiveFile(filename) {
  if (!Object.prototype.hasOwnProperty.call(state.files, filename)) return;
  state.activeFile = filename;
  editorApi?.setDoc(state.files[filename]);
  const isReadOnly = state.readOnlyFiles.has(filename);
  editorApi?.setReadOnly(isReadOnly);
  fileTreeApi?.render(state.files, state.activeFile, [...state.readOnlyFiles]);
}

function handleCreateFile(filename) {
  const trimmed = filename.trim();
  if (!trimmed) {
    return { ok: false, message: 'File name is required.' };
  }
  if (Object.prototype.hasOwnProperty.call(state.files, trimmed)) {
    return { ok: false, message: 'A file with that name already exists.' };
  }
  state.files = { ...state.files, [trimmed]: '' };
  setActiveFile(trimmed);
  fileTreeApi?.render(state.files, state.activeFile, [...state.readOnlyFiles]);
  scheduleSnapshot();
  if (state.autoRender) {
    scheduleRender({ immediate: true });
  }
  return { ok: true };
}

function handleRenameFile(oldName, newName) {
  if (state.readOnlyFiles.has(oldName)) {
    alert('This file is read-only.');
    return;
  }
  const trimmed = newName.trim();
  if (!trimmed) return;
  if (Object.prototype.hasOwnProperty.call(state.files, trimmed)) {
    alert('A file with that name already exists.');
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(state.files, oldName)) return;
  const content = state.files[oldName];
  const newFiles = { ...state.files };
  delete newFiles[oldName];
  newFiles[trimmed] = content;
  state.files = newFiles;
  if (state.activeFile === oldName) {
    state.activeFile = trimmed;
  }
  fileTreeApi?.render(state.files, state.activeFile, [...state.readOnlyFiles]);
  scheduleSnapshot();
}

function handleDeleteFile(filename) {
  if (state.readOnlyFiles.has(filename)) {
    alert('This file is read-only and cannot be deleted.');
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(state.files, filename)) return;
  const newFiles = { ...state.files };
  delete newFiles[filename];
  state.files = newFiles;
  if (state.activeFile === filename) {
    state.activeFile = Object.keys(state.files)[0] ?? '';
    if (state.activeFile) {
      editorApi?.setDoc(state.files[state.activeFile]);
      const isReadOnly = state.readOnlyFiles.has(state.activeFile);
      editorApi?.setReadOnly(isReadOnly);
    } else {
      editorApi?.setDoc('');
    }
  }
  fileTreeApi?.render(state.files, state.activeFile, [...state.readOnlyFiles]);
  scheduleSnapshot();
  if (state.autoRender) {
    scheduleRender({ immediate: true });
  } else {
    renderEmptyPreviewIfNoFiles();
  }
}

function renderEmptyPreviewIfNoFiles() {
  if (Object.keys(state.files).length === 0) {
    previewApi.render('');
    toolbarApi?.setStatus('Ready', 'ready');
  }
}

async function loadConfig() {
  toolbarApi?.setStatus('Loading...', 'busy');
  try {
    const res = await fetch('/config');
    if (!res.ok) throw new Error(`Request failed with ${res.status}`);
    const config = await res.json();
    state.files = { ...(config.starterFiles ?? {}) };
    state.readOnlyFiles = new Set(config.readOnlyFiles ?? []);
    const firstFile = config.activeFile && state.files[config.activeFile]
      ? config.activeFile
      : Object.keys(state.files)[0] ?? '';
    state.activeFile = firstFile;
    fileTreeApi?.render(state.files, state.activeFile, [...state.readOnlyFiles]);
    if (state.activeFile) {
      editorApi?.setDoc(state.files[state.activeFile]);
      const isReadOnly = state.readOnlyFiles.has(state.activeFile);
      editorApi?.setReadOnly(isReadOnly);
    }
    toolbarApi?.setStatus('Ready', 'ready');
    if (state.autoRender && state.activeFile) {
      renderActiveFile();
    } else {
      renderEmptyPreviewIfNoFiles();
    }
  } catch (err) {
    console.error(err);
    toolbarApi?.setStatus('Error loading config', 'error');
    previewApi.render('');
  }
}

function setupResizers() {
  const handles = document.querySelectorAll('.drag-handle');
  const fileTreePanel = document.getElementById('file-tree');
  const editorPanel = document.getElementById('editor');
  const previewPanel = document.getElementById('preview');

  handles.forEach((handle) => {
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const isFirst = handle.dataset.handle === 'file-editor';
      const startX = event.clientX;
      const startFileWidth = fileTreePanel.getBoundingClientRect().width;
      const startEditorWidth = editorPanel.getBoundingClientRect().width;
      const startPreviewWidth = previewPanel.getBoundingClientRect().width;
      function onMouseMove(e) {
        const delta = e.clientX - startX;
        if (isFirst) {
          const newWidth = Math.min(Math.max(150, startFileWidth + delta), 400);
          fileTreePanel.style.width = `${newWidth}px`;
        } else {
          const newEditorWidth = Math.min(Math.max(200, startEditorWidth + delta), window.innerWidth - 240);
          editorPanel.style.flex = '0 0 auto';
          editorPanel.style.width = `${newEditorWidth}px`;
          previewPanel.style.flex = '1 1 auto';
        }
      }
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

function bootstrap() {
  initModules();
  loadConfig();
}

bootstrap();
