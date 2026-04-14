import { undo, redo } from '@codemirror/commands';

const buttons = [
  { label: '↩', title: 'Undo', command: undo },
  { label: '↪', title: 'Redo', command: redo },
  { sep: true },
  { label: 'B', title: 'Bold', wrap: ['\\textbf{', '}'], toggle: true },
  { label: 'I', title: 'Italic', wrap: ['\\textit{', '}'], toggle: true },
  { sep: true },
  { dropdown: true },
  { sep: true },
  { mathDropdown: true },
  { sep: true },
  { listDropdown: true },
];

const sectionOptions = [
  { label: 'Normal text', wrap: null },
  { label: 'Section', wrap: ['\\section{', '}'] },
  { label: 'Subsection', wrap: ['\\subsection{', '}'] },
  { label: 'Subsubsection', wrap: ['\\subsubsection{', '}'] },
  { label: 'Paragraph', wrap: ['\\paragraph{', '}'] },
  { label: 'Subparagraph', wrap: ['\\subparagraph{', '}'] },
];

const mathOptions = [
  { label: '\u03A3 Math', wrap: null },
  { label: 'Inline math \\(...\\)', wrap: ['\\(', '\\)'] },
  { label: 'Display math \\[...\\]', wrap: ['\\[', '\\]'] },
];

const listOptions = [
  { label: '\u2261 Lists', block: null },
  { label: 'Bullet list', block: '\\begin{itemize}\n  \\item \n\\end{itemize}' },
  { label: 'Numbered list', block: '\\begin{enumerate}\n  \\item \n\\end{enumerate}' },
];

function insertWrap(editorView, wrap, options = {}) {
  editorView.focus();
  const { state } = editorView;
  const range = state.selection.main;
  const [open, close] = wrap;
  const selected = state.sliceDoc(range.from, range.to);
  const toggle = options.toggle ?? false;

  const removeSelectionWrap = (from, to, innerText) => {
    editorView.dispatch({
      changes: { from, to, insert: innerText },
      selection: { anchor: from, head: from + innerText.length },
    });
  };

  if (selected) {
    if (
      toggle &&
      selected.startsWith(open) &&
      selected.endsWith(close)
    ) {
      const inner = selected.slice(open.length, selected.length - close.length);
      removeSelectionWrap(range.from, range.to, inner);
      return;
    }

    if (toggle) {
      const beforeStart = range.from - open.length;
      const afterEnd = range.to + close.length;
      if (
        beforeStart >= 0 &&
        afterEnd <= state.doc.length &&
        state.sliceDoc(beforeStart, range.from) === open &&
        state.sliceDoc(range.to, afterEnd) === close
      ) {
        removeSelectionWrap(beforeStart, afterEnd, selected);
        return;
      }
    }

    const wrapped = open + selected + close;
    editorView.dispatch({
      changes: { from: range.from, to: range.to, insert: wrapped },
      selection: { anchor: range.from + open.length, head: range.from + open.length + selected.length },
    });
    return;
  }

  const inserted = open + close;
  editorView.dispatch({
    changes: { from: range.from, insert: inserted },
    selection: { anchor: range.from + open.length },
  });
}

export function createEditorToolbar(container) {
  const bar = document.createElement('div');
  bar.className = 'editor-toolbar';
  let editorViewRef = null;

  buttons.forEach((btn) => {
    if (btn.sep) {
      const sep = document.createElement('span');
      sep.className = 'editor-toolbar-sep';
      bar.appendChild(sep);
      return;
    }

    if (btn.dropdown || btn.mathDropdown || btn.listDropdown) {
      const options = btn.listDropdown ? listOptions : btn.dropdown ? sectionOptions : mathOptions;
      const resetLabel = options[0].label;
      const select = document.createElement('select');
      select.className = 'editor-toolbar-select';
      select.title = btn.listDropdown ? 'Lists' : btn.dropdown ? 'Section type' : 'Math mode';
      options.forEach((opt) => {
        const option = document.createElement('option');
        option.textContent = opt.label;
        option.value = opt.label;
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        const opt = options.find((o) => o.label === select.value);
        if (opt?.wrap && editorViewRef) {
          insertWrap(editorViewRef, opt.wrap);
        } else if (opt?.block && editorViewRef) {
          editorViewRef.focus();
          const { state } = editorViewRef;
          const range = state.selection.main;
          const cursorOffset = opt.block.indexOf('\\item ') + '\\item '.length;
          editorViewRef.dispatch({
            changes: { from: range.from, to: range.to, insert: opt.block },
            selection: { anchor: range.from + cursorOffset },
          });
        }
        select.value = resetLabel;
      });
      bar.appendChild(select);
      return;
    }

    const el = document.createElement('button');
    el.className = 'editor-toolbar-btn';
    el.textContent = btn.label;
    el.title = btn.title;
    el.dataset.action = btn.title;
    bar.appendChild(el);
  });

  container.prepend(bar);

  function attach(editorView) {
    editorViewRef = editorView;

    bar.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;

      const btn = buttons.find((b) => b.title === el.dataset.action);
      if (!btn) return;

      if (btn.command) {
        editorView.focus();
        btn.command(editorView);
        return;
      }

      if (btn.block) {
        editorView.focus();
        const { state } = editorView;
        const range = state.selection.main;
        const cursorOffset = btn.block.indexOf('\\item ') + '\\item '.length;
        editorView.dispatch({
          changes: { from: range.from, to: range.to, insert: btn.block },
          selection: { anchor: range.from + cursorOffset },
        });
        return;
      }

      if (btn.wrap) {
        insertWrap(editorView, btn.wrap, { toggle: btn.toggle });
      }
    });
  }

  return { attach };
}
