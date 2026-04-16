import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { latex } from 'codemirror-lang-latex';

const editableCompartment = new Compartment();

// Custom Enter handler: insert newline and copy the current line's leading
// whitespace.  This avoids the latex language plugin's auto-indent which
// incorrectly adds a tab after comment lines (and can be surprising in other
// contexts too).
function insertNewlineKeepIndent({ state, dispatch }) {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  const indent = line.text.match(/^\s*/)[0];
  const insert = '\n' + indent;
  dispatch(state.update({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  }));
  return true;
}

export function createEditor({ parent, doc = '', readOnly = false, onChange }) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        keymap.of([{ key: 'Enter', run: insertNewlineKeepIndent }, ...defaultKeymap, indentWithTab, ...historyKeymap]),
        history(),
        bracketMatching(),
        oneDark,
        latex(),
        editableCompartment.of(EditorView.editable.of(!readOnly)),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange?.(update.state.doc.toString());
          }
        }),
      ],
    }),
    parent,
  });

  function setDoc(nextDoc) {
    const current = view.state.doc.toString();
    if (nextDoc === current) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
    });
  }

  function setReadOnly(isReadOnly) {
    view.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!isReadOnly)),
    });
  }

  return {
    view,
    setDoc,
    setReadOnly,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    getValue: () => view.state.doc.toString(),
  };
}
