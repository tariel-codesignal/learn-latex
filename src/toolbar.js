export function initToolbar({ container, onCompile, onToggleAutoRender }) {
  container.innerHTML = `
    <div class="toolbar-title">LaTeX Editor</div>
    <div class="toolbar-actions">
      <button class="button" data-action="compile">Compile</button>
      <label class="toggle">
        <input type="checkbox" id="auto-render-toggle" checked />
        <span class="toggle-switch"></span>
        <span class="toggle-label">Auto</span>
      </label>
      <span class="status-indicator" data-status>Ready</span>
    </div>
  `;

  const compileButton = container.querySelector('[data-action="compile"]');
  const toggleInput = container.querySelector('#auto-render-toggle');
  const toggleLabel = container.querySelector('.toggle-label');
  const statusEl = container.querySelector('[data-status]');
  compileButton.classList.toggle('is-muted', toggleInput.checked);

  compileButton.addEventListener('click', () => {
    onCompile?.();
  });

  toggleInput.addEventListener('change', () => {
    toggleLabel.textContent = toggleInput.checked ? 'Auto' : 'Manual';
    if (toggleInput.checked) {
      compileButton.classList.add('is-muted');
    } else {
      compileButton.classList.remove('is-muted');
    }
    onToggleAutoRender?.(toggleInput.checked);
  });

  function setStatus(text, type = 'ready') {
    statusEl.textContent = text;
    statusEl.classList.remove('is-busy', 'is-error', 'is-ready');
    if (type === 'busy') statusEl.classList.add('is-busy');
    if (type === 'error') statusEl.classList.add('is-error');
    if (type === 'ready') statusEl.classList.add('is-ready');
  }

  function setAutoRender(enabled) {
    toggleInput.checked = enabled;
    toggleLabel.textContent = enabled ? 'Auto' : 'Manual';
    compileButton.classList.toggle('is-muted', enabled);
  }

  return {
    setStatus,
    setAutoRender,
  };
}
