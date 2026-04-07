import { HtmlGenerator, parse } from 'latex.js';
import 'latex.js/dist/css/katex.css';
import 'latex.js/dist/css/base.css';
import 'latex.js/dist/css/article.css';

function extractBalancedBlock(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue; }
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(openIndex + 1, i), endIndex: i };
    }
  }
  return null;
}

function cleanFootnoteText(raw) {
  if (!raw) return '';
  return raw
    .replace(/\\(textbf|textit|emph|texttt)\s*\{([^}]*)\}/g, '$2')
    .replace(/\\[a-zA-Z*]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function preprocessFootnotes(content) {
  if (!content || !content.includes('\\footnote')) {
    return content;
  }

  const footnotes = [];
  let cursor = 0;
  let result = '';

  while (cursor < content.length) {
    const start = content.indexOf('\\footnote', cursor);
    if (start === -1) { result += content.slice(cursor); break; }

    result += content.slice(cursor, start);
    let braceIdx = start + '\\footnote'.length;
    while (braceIdx < content.length && /\s/.test(content[braceIdx])) braceIdx += 1;

    if (content[braceIdx] !== '{') {
      result += '\\footnote';
      cursor = braceIdx;
      continue;
    }

    const block = extractBalancedBlock(content, braceIdx);
    if (!block) {
      result += content.slice(start, braceIdx + 1);
      cursor = braceIdx + 1;
      continue;
    }

    const id = footnotes.length + 1;
    footnotes.push({ id, text: block.text.trim() });
    result += `$^{${id}}$`;
    cursor = block.endIndex + 1;
  }

  if (!footnotes.length) return result;

  const endDocIdx = result.lastIndexOf('\\end{document}');
  const footnotesLatex = '\n\\bigskip\n\\begin{enumerate}\n'
    + footnotes.map((n) => `\\item ${cleanFootnoteText(n.text)}`).join('\n')
    + '\n\\end{enumerate}\n';

  if (endDocIdx !== -1) {
    return result.slice(0, endDocIdx) + footnotesLatex + result.slice(endDocIdx);
  }
  return result + footnotesLatex;
}

export function createPreview(container) {
  container.innerHTML = '';

  function render(content) {
    container.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'preview-page page';
    container.appendChild(page);

    if (!content || !content.trim()) {
      page.innerHTML = '<p class="empty-state" style="color:#666">Start typing LaTeX to see a preview.</p>';
      return { ok: true };
    }

    const processed = preprocessFootnotes(content);

    try {
      const generator = new HtmlGenerator({ hyphenate: false });
      parse(processed, { generator });
      page.appendChild(generator.domFragment());
      generator.applyLengthsAndGeometryToDom(page);
      return { ok: true };
    } catch (err) {
      console.error('LaTeX.js render error', err);
      page.innerHTML = '';
      const errorEl = document.createElement('div');
      errorEl.className = 'preview-error';
      errorEl.textContent = err.message || 'Failed to render document.';
      page.appendChild(errorEl);
      return { ok: false, error: err.message };
    }
  }

  return { render };
}
