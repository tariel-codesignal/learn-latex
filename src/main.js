import './style.css';
import { createEditor } from './editor.js';
import { createPreview } from './preview.js';
import { createPreviewControls, ZOOM_LEVELS } from './previewControls.js';
import { initFileTree } from './filetree.js';
import { createEditorToolbar } from './editorToolbar.js';
import { createOutline } from './outline.js';

const state = {
  files: {},
  activeFile: '',
  readOnlyFiles: new Set(),
  autoRender: true,
  lastRenderResult: null,
  pageCount: 0,
  currentPage: 0,
  previewZoom: 100,
};

const refs = {
  editor: document.getElementById('editor'),
  previewControls: document.getElementById('preview-controls'),
  preview: document.getElementById('preview'),
  fileTree: document.getElementById('file-tree'),
  outline: document.getElementById('outline'),
};

let editorApi;
let previewApi;
let previewControlsApi;
let fileTreeApi;
let editorToolbarApi;
let outlineApi;
let renderTimer = null;
let snapshotTimer = null;
let outlineTimer = null;
let previewScrollRaf = null;

function initModules() {
  previewApi = createPreview(refs.preview);

  previewControlsApi = createPreviewControls({
    container: refs.previewControls,
    onCompile: () => renderActiveFile(),
    onToggleAutoRender: (enabled) => handleAutoToggle(enabled),
    onPageStep: (delta) => handlePageStep(delta),
    onPageJump: (page) => goToPage(page),
    onZoomStep: (delta) => stepPreviewZoom(delta),
    onZoomSelect: (value) => setPreviewZoom(value),
  });
  previewControlsApi.setAutoRender(state.autoRender);
  previewControlsApi.setPageInfo({ current: 0, total: 0 });
  setPreviewZoom(state.previewZoom);
  previewControlsApi.setStatus('Ready', 'ready');

  refs.preview.addEventListener('scroll', handlePreviewScroll);

  editorToolbarApi = createEditorToolbar(refs.editor);

  editorApi = createEditor({
    parent: refs.editor,
    doc: '',
    readOnly: false,
    onChange: (doc) => {
      if (!state.activeFile) return;
      state.files[state.activeFile] = doc;
      scheduleSnapshot();
      scheduleOutlineUpdate(doc);
      if (state.autoRender) {
        scheduleRender();
      }
    },
  });

  editorToolbarApi.attach(editorApi.view);

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

  outlineApi = createOutline(refs.outline);
  outlineApi.setNavigateHandler((line) => {
    if (!editorApi) return;
    const { view } = editorApi;
    const lineInfo = view.state.doc.line(line + 1); // 0-based to 1-based
    view.dispatch({
      selection: { anchor: lineInfo.from },
      scrollIntoView: true,
    });
    view.focus();
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

function scheduleOutlineUpdate(doc) {
  clearTimeout(outlineTimer);
  outlineTimer = window.setTimeout(() => {
    outlineApi?.update(doc);
  }, 300);
}

function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = window.setTimeout(() => {
    const payload = {
      files: state.files,
      activeFile: state.activeFile,
      lastRenderResult: state.lastRenderResult,
    };
    fetch('/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err) => console.error('Failed to send snapshot', err));
  }, 1000);
}

function handleAutoToggle(enabled) {
  state.autoRender = enabled;
  previewControlsApi?.setAutoRender(enabled);
  if (enabled) {
    scheduleRender({ immediate: true });
  }
}

function handlePageStep(delta) {
  if (!state.pageCount) return;
  const target = Math.min(Math.max((state.currentPage || 1) + delta, 1), state.pageCount);
  goToPage(target);
}

function goToPage(pageNumber, { behavior = 'smooth' } = {}) {
  if (!state.pageCount) return;
  const clamped = Math.min(Math.max(pageNumber, 1), state.pageCount);
  if (previewApi?.scrollToPage(clamped, { behavior })) {
    state.currentPage = clamped;
    updatePageControls();
  }
}

function handlePreviewScroll() {
  if (previewScrollRaf) return;
  previewScrollRaf = window.requestAnimationFrame(() => {
    previewScrollRaf = null;
    syncCurrentPageFromScroll();
  });
}

function syncCurrentPageFromScroll() {
  const pages = previewApi?.getPages() ?? [];
  if (!pages.length) return;
  const scrollTop = refs.preview.scrollTop;
  let closestIndex = 0;
  let smallestDelta = Number.POSITIVE_INFINITY;
  pages.forEach((page, index) => {
    const delta = Math.abs(page.offsetTop - scrollTop);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closestIndex = index;
    }
  });
  const nextPage = closestIndex + 1;
  if (nextPage !== state.currentPage) {
    state.currentPage = nextPage;
    updatePageControls();
  }
}

function setPreviewZoom(percent) {
  const clamped = Math.min(Math.max(percent, ZOOM_LEVELS[0]), ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  state.previewZoom = clamped;
  previewApi?.setZoom(clamped / 100);
  previewControlsApi?.setZoom(clamped);
  updateZoomButtons();
}

function stepPreviewZoom(direction) {
  const currentIndex = ZOOM_LEVELS.indexOf(state.previewZoom);
  if (currentIndex === -1) {
    setPreviewZoom(100);
    return;
  }
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), ZOOM_LEVELS.length - 1);
  setPreviewZoom(ZOOM_LEVELS[nextIndex]);
}

function updateZoomButtons() {
  const min = ZOOM_LEVELS[0];
  const max = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  previewControlsApi?.setZoomControlsState({
    canZoomIn: state.previewZoom < max,
    canZoomOut: state.previewZoom > min,
  });
}

function updatePageControls() {
  previewControlsApi?.setPageInfo({ current: state.currentPage, total: state.pageCount });
}

function setStatus(text, type = 'ready') {
  previewControlsApi?.setStatus(text, type);
}

function renderActiveFile() {
  if (!state.activeFile) return;
  setStatus('Rendering...', 'busy');
  try {
    const previousPage = state.currentPage || 1;
    const result = previewApi.render(state.files[state.activeFile] ?? '');
    updateRenderStatus(result);
    applyPaginationResult(result.pageCount ?? 0, previousPage);
    if (result.ok) {
      setStatus('Ready', 'ready');
    } else {
      setStatus('Error', 'error');
    }
  } catch (err) {
    updateRenderStatus({ ok: false, error: err?.message || 'Failed to render document.' });
    applyPaginationResult(0, 1);
    setStatus('Error', 'error');
    console.error(err);
  }
}

function applyPaginationResult(pageCount, previousPage = 1) {
  state.pageCount = pageCount;
  if (!pageCount) {
    state.currentPage = 0;
    updatePageControls();
    return;
  }
  const desiredPage = Math.min(Math.max(previousPage, 1), pageCount);
  state.currentPage = desiredPage || 1;
  previewApi?.scrollToPage(state.currentPage, { behavior: 'auto' });
  updatePageControls();
}

function updateRenderStatus(result) {
  const base = {
    ok: Boolean(result?.ok),
    error: result?.ok ? null : (result?.error || 'Failed to render document.'),
    file: state.activeFile,
    timestamp: new Date().toISOString(),
  };
  state.lastRenderResult = base;
}

function setActiveFile(filename) {
  if (!Object.prototype.hasOwnProperty.call(state.files, filename)) return;
  state.activeFile = filename;
  editorApi?.setDoc(state.files[filename]);
  const isReadOnly = state.readOnlyFiles.has(filename);
  editorApi?.setReadOnly(isReadOnly);
  fileTreeApi?.render(state.files, state.activeFile, [...state.readOnlyFiles]);
  outlineApi?.update(state.files[filename]);
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
    const result = previewApi.render('');
    applyPaginationResult(result.pageCount ?? 0, 1);
    setStatus('Ready', 'ready');
  }
}

async function loadConfig() {
  setStatus('Loading...', 'busy');
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
    setStatus('Ready', 'ready');
    if (state.activeFile) {
      outlineApi?.update(state.files[state.activeFile]);
    }
    if (state.autoRender && state.activeFile) {
      renderActiveFile();
    } else {
      renderEmptyPreviewIfNoFiles();
    }
  } catch (err) {
    console.error(err);
    setStatus('Error loading config', 'error');
    previewApi.render('');
  }
}

function setupResizers() {
  const handles = document.querySelectorAll('.drag-handle');
  const fileTreePanel = document.querySelector('.panel.sidebar');
  const editorPanel = document.getElementById('editor');
  const previewPanel = document.getElementById('preview-panel');

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
