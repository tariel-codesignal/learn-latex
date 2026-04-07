import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { latex } from 'codemirror-lang-latex';

const editableCompartment = new Compartment();

export function createEditor({ parent, doc = '', readOnly = false, onChange }) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, indentWithTab, ...historyKeymap]),
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
