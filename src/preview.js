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

// Height of the usable content area per page (A4 minus top padding minus page-number area).
// 297mm ≈ 841.89pt; top padding = 72pt; page-number footer ≈ 54pt → ~716pt usable.
const PAGE_CONTENT_HEIGHT_PT = 716;

function ptToPx(pt) {
  return pt * (96 / 72);
}

/**
 * After latex.js renders into a single page, split the .body children across
 * multiple pages if the content overflows.
 */
function paginate(container, firstPage) {
  const body = firstPage.querySelector('.body');
  if (!body) return;

  const maxHeight = ptToPx(PAGE_CONTENT_HEIGHT_PT);

  // Collect all children into an array (we'll redistribute them)
  const children = Array.from(body.children);
  if (!children.length) return;

  // Measure: walk children and find where page breaks are needed
  const pages = [[]];
  let currentHeight = 0;

  children.forEach((child) => {
    const rect = child.getBoundingClientRect();
    const style = getComputedStyle(child);
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginBottom = parseFloat(style.marginBottom) || 0;
    const totalHeight = rect.height + marginTop + marginBottom;

    if (currentHeight + totalHeight > maxHeight && pages[pages.length - 1].length > 0) {
      pages.push([]);
      currentHeight = 0;
    }

    pages[pages.length - 1].push(child);
    currentHeight += totalHeight;
  });

  // If everything fits on one page, nothing to do
  if (pages.length <= 1) return;

  // Read grid CSS variables from first page to copy to new pages
  const computedStyle = getComputedStyle(firstPage);
  const cssVarsToCopy = ['--textwidth', '--marginleftwidth', '--marginrightwidth',
    '--marginparwidth', '--marginparsep', '--parindent'];
  const varValues = {};
  cssVarsToCopy.forEach((v) => { varValues[v] = computedStyle.getPropertyValue(v); });

  // Rebuild: first page keeps page 1 children, new pages for the rest
  body.innerHTML = '';
  pages[0].forEach((child) => body.appendChild(child));

  for (let i = 1; i < pages.length; i += 1) {
    const newPage = document.createElement('div');
    newPage.className = 'preview-page page';
    // Copy grid CSS variables
    Object.entries(varValues).forEach(([k, v]) => { if (v) newPage.style.setProperty(k, v); });

    const newBody = document.createElement('div');
    newBody.className = 'body';
    pages[i].forEach((child) => newBody.appendChild(child));
    newPage.appendChild(newBody);
    container.appendChild(newPage);
  }
}

export function createPreview(container) {
  container.innerHTML = '';
  let pageEntries = [];
  let zoom = 1;

  function applyZoom() {
    pageEntries.forEach((entry) => {
      entry.page.style.transform = `scale(${zoom})`;
      entry.page.style.transformOrigin = 'top center';
      entry.wrapper.style.height = `${entry.baseHeight * zoom}px`;
    });
  }

  function buildPageEntries() {
    const rawPages = Array.from(container.querySelectorAll('.preview-page'));
    pageEntries = rawPages.map((page) => {
      page.style.transform = '';
      page.style.transformOrigin = 'top center';
      const baseHeight = page.offsetHeight;
      const wrapper = document.createElement('div');
      wrapper.className = 'preview-page-wrapper';
      page.parentNode.insertBefore(wrapper, page);
      wrapper.appendChild(page);
      return { page, wrapper, baseHeight };
    });
  }

  function render(content) {
    pageEntries = [];
    container.innerHTML = '';

    if (!content || !content.trim()) {
      const emptyState = document.createElement('p');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'Start typing LaTeX to see a preview.';
      container.appendChild(emptyState);
      return { ok: true, pageCount: 0 };
    }

    const processed = preprocessFootnotes(content);

    try {
      const page = document.createElement('div');
      page.className = 'preview-page page';
      container.appendChild(page);

      const generator = new HtmlGenerator({ hyphenate: false });
      parse(processed, { generator });
      page.appendChild(generator.domFragment());
      generator.applyLengthsAndGeometryToDom(page);

      // Split into multiple pages if content overflows
      paginate(container, page);

      buildPageEntries();
      applyZoom();
      return { ok: true, pageCount: pageEntries.length };
    } catch (err) {
      console.error('LaTeX.js render error', err);
      const errorEl = document.createElement('div');
      errorEl.className = 'preview-error';
      errorEl.textContent = err.message || 'Failed to render document.';
      container.appendChild(errorEl);
      return { ok: false, error: err.message, pageCount: 0 };
    }
  }

  function setZoom(value) {
    zoom = value;
    applyZoom();
  }

  function scrollToPage(pageNumber, { behavior = 'smooth' } = {}) {
    if (!pageEntries.length) return false;
    const target = pageEntries[pageNumber - 1]?.wrapper;
    if (!target) return false;
    container.scrollTo({ top: target.offsetTop, behavior });
    return true;
  }

  function getPages() {
    return pageEntries.map((entry) => entry.wrapper);
  }

  return {
    render,
    setZoom,
    scrollToPage,
    getPages,
  };
}
