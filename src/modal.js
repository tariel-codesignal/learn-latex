export function createFileModal({
  title = 'Create File',
  label = 'File name',
  placeholder = 'notes.tex',
  submitLabel = 'Create',
  onSubmit,
} = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.innerHTML = `
    <div class="modal">
      <form class="modal-form">
        <header class="modal-header">
          <h3>${title}</h3>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </header>
        <label class="modal-field">
          <span>${label}</span>
          <input type="text" name="filename" placeholder="${placeholder}" autocomplete="off" />
        </label>
        <p class="modal-error" aria-live="polite"></p>
        <footer class="modal-footer">
          <button type="button" class="button is-soft" data-dismiss>Cancel</button>
          <button type="submit" class="button">${submitLabel}</button>
        </footer>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const input = overlay.querySelector('input[name="filename"]');
  const cancelButton = overlay.querySelector('[data-dismiss]');
  const closeButton = overlay.querySelector('.modal-close');
  const errorEl = overlay.querySelector('.modal-error');

  let submitHandler = onSubmit;

  function setError(message = '') {
    errorEl.textContent = message;
    errorEl.style.display = message ? 'block' : 'none';
  }

  function close() {
    overlay.classList.add('hidden');
    form.reset();
    setError('');
  }

  function open(initialValue = '') {
    input.value = initialValue;
    overlay.classList.remove('hidden');
    setTimeout(() => input.focus(), 0);
  }

  function normalizeResult(result) {
    if (!result) return { ok: true };
    if (typeof result === 'boolean') return { ok: result };
    if (typeof result === 'string') return { ok: false, message: result };
    return { ok: result.ok !== false, message: result.message ?? '' };
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      setError('File name is required.');
      input.focus();
      return;
    }
    const result = normalizeResult(submitHandler?.(value));
    if (result.ok) {
      close();
    } else if (result.message) {
      setError(result.message);
    }
  });

  cancelButton.addEventListener('click', () => {
    close();
  });

  closeButton.addEventListener('click', () => {
    close();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (!overlay.classList.contains('hidden') && event.key === 'Escape') {
      close();
    }
  });

  function setSubmitHandler(handler) {
    submitHandler = handler;
  }

  return {
    open,
    close,
    setError,
    setSubmitHandler,
  };
}
