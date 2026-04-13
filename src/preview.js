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
const PAPER_WIDTH_MM = 210;
const PAPER_HEIGHT_MM = 297;
const PAPER_WIDTH_CSS = `${PAPER_WIDTH_MM}mm`;
const PAGE_CONTENT_HEIGHT_PT = 716;
const PAGE_ASPECT_RATIO = PAPER_HEIGHT_MM / PAPER_WIDTH_MM;
const PAGE_NATURAL_WIDTH_PX = (PAPER_WIDTH_MM / 25.4) * 96;
const MIN_AUTO_SCALE = 1;
const MAX_AUTO_SCALE = 1;

function ptToPx(pt) {
  return pt * (96 / 72);
}

function renderInlineLatex(snippet) {
  const trimmed = (snippet || '').trim();
  if (!trimmed) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode(''));
    return fragment;
  }
  try {
    const generator = new HtmlGenerator({ hyphenate: false });
    parse(trimmed, { generator });
    return generator.domFragment();
  } catch (err) {
    console.warn('Failed to render table cell content', err);
    const fallback = document.createDocumentFragment();
    fallback.appendChild(document.createTextNode(trimmed.replace(/\\/g, ' ')));
    return fallback;
  }
}

function buildPreviewTable(tableInfo) {
  const host = document.createElement('div');
  host.className = 'preview-tabular-host';
  const table = document.createElement('table');
  table.className = 'preview-table';
  if (tableInfo.bottomRule) {
    table.classList.add('has-bottom-rule');
  }
  const tbody = document.createElement('tbody');
  tableInfo.rows.forEach((row) => {
    if (!row?.cells?.length) return;
    const tr = document.createElement('tr');
    if (row.hasTopRule) {
      tr.classList.add('has-top-rule');
    }
    row.cells.forEach((cell, index) => {
      const td = document.createElement('td');
      const alignment = tableInfo.alignments[index]
        || tableInfo.alignments[tableInfo.alignments.length - 1]
        || 'left';
      td.classList.add(`align-${alignment}`);
      const fragment = renderInlineLatex(cell);
      td.appendChild(fragment);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  host.appendChild(table);
  return host;
}

function replaceTabularPlaceholders(root, tables = []) {
  if (!tables.length) return;
  tables.forEach((tableInfo) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let targetNode = null;
    let indexInNode = -1;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const idx = node.nodeValue.indexOf(tableInfo.placeholder);
      if (idx !== -1) {
        targetNode = node;
        indexInNode = idx;
        break;
      }
    }
    if (!targetNode || indexInNode === -1) {
      console.warn('Preview table placeholder missing:', tableInfo.placeholder);
      return;
    }
    const beforeText = targetNode.nodeValue.slice(0, indexInNode);
    const afterText = targetNode.nodeValue.slice(indexInNode + tableInfo.placeholder.length);
    const fragment = document.createDocumentFragment();
    if (beforeText) {
      fragment.appendChild(document.createTextNode(beforeText));
    }
    fragment.appendChild(buildPreviewTable(tableInfo));
    if (afterText) {
      fragment.appendChild(document.createTextNode(afterText));
    }
    targetNode.parentNode.replaceChild(fragment, targetNode);
  });
}

/**
 * After latex.js renders into a single page, split the .body children across
 * multiple pages if the content overflows.
 */
function paginate(container, firstPage, options = {}) {
  const body = firstPage.querySelector('.body');
  if (!body) return;

  const maxHeight = options.maxHeightPx ?? ptToPx(PAGE_CONTENT_HEIGHT_PT);
  const onPageCreated = options.onPageCreated;

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
    if (typeof onPageCreated === 'function') onPageCreated(newPage);
  }
}

export function createPreview(container) {
  container.innerHTML = '';
  let pageEntries = [];
  let manualZoom = 1;
  let autoScale = 1;
  let activeGeometry = null; // null = use latex.js / CSS defaults

  function mmToPx(mm) {
    return (mm / 25.4) * 96;
  }

  function getPageDimensionsPx() {
    if (activeGeometry) {
      return {
        widthPx: mmToPx(activeGeometry.paperWidth),
        heightPx: mmToPx(activeGeometry.paperHeight),
      };
    }
    return {
      widthPx: PAGE_NATURAL_WIDTH_PX,
      heightPx: PAGE_NATURAL_WIDTH_PX * PAGE_ASPECT_RATIO,
    };
  }

  function getContentHeightPx() {
    if (activeGeometry) {
      return mmToPx(activeGeometry.textHeight);
    }
    return ptToPx(PAGE_CONTENT_HEIGHT_PT);
  }

  function applyGeometryToPage(page) {
    if (!page) return;
    if (!activeGeometry) {
      page.style.setProperty('--paperwidth', PAPER_WIDTH_CSS);
      return;
    }
    const g = activeGeometry;
    page.style.setProperty('--paperwidth', `${g.paperWidth}mm`);
    page.style.setProperty('--marginleftwidth', `${g.left}mm`);
    page.style.setProperty('--textwidth', `${g.textWidth}mm`);
    page.style.setProperty('--marginrightwidth', `${g.right}mm`);
    page.style.width = `${g.paperWidth}mm`;
    page.style.minWidth = `${g.paperWidth}mm`;
    page.style.height = `${g.paperHeight}mm`;
    page.style.minHeight = `${g.paperHeight}mm`;

    const body = page.querySelector('.body');
    if (body) {
      // Body uses border-box; height includes padding-top. Setting it to
      // top + textHeight makes the actual content area equal textHeight,
      // and leaves `bottom` mm beneath the body for the page-number footer.
      const bodyExtent = `${g.top + g.textHeight}mm`;
      body.style.paddingTop = `${g.top}mm`;
      body.style.height = bodyExtent;
      body.style.minHeight = bodyExtent;
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    updateAutoScale();
  });
  resizeObserver.observe(container);

  function applyZoom() {
    const effective = manualZoom * autoScale;
    pageEntries.forEach((entry) => {
      entry.page.style.transform = `scale(${effective})`;
      entry.page.style.transformOrigin = 'top left';
      entry.wrapper.style.width = `${entry.baseWidth * effective}px`;
      entry.wrapper.style.height = `${entry.baseHeight * effective}px`;
    });
  }

  function buildPageEntries() {
    const { widthPx, heightPx } = getPageDimensionsPx();
    const rawPages = Array.from(container.querySelectorAll('.preview-page'));
    pageEntries = rawPages.map((page) => {
      page.style.transform = '';
      page.style.transformOrigin = 'top left';
      const wrapper = document.createElement('div');
      wrapper.className = 'preview-page-wrapper';
      page.parentNode.insertBefore(wrapper, page);
      wrapper.appendChild(page);
      return { page, wrapper, baseHeight: heightPx, baseWidth: widthPx };
    });
    updateAutoScale(true);
  }

  function render(content, options = {}) {
    const tables = options.tables ?? [];
    activeGeometry = options.geometry ?? null;
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
      applyGeometryToPage(page);
      replaceTabularPlaceholders(page, tables);

      // Split into multiple pages if content overflows
      paginate(container, page, {
        maxHeightPx: getContentHeightPx(),
        onPageCreated: applyGeometryToPage,
      });

      buildPageEntries();
      applyZoom();
      centerHorizontalScroll();
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
    manualZoom = value;
    updateAutoScale(true);
    centerHorizontalScroll();
  }

  function centerHorizontalScroll() {
    // After layout, center the horizontal scroll so the page feels centered
    // even when it overflows the column (pinned-left + scroll offset == centered).
    window.requestAnimationFrame(() => {
      const overflow = container.scrollWidth - container.clientWidth;
      if (overflow > 0) {
        container.scrollLeft = overflow / 2;
      }
    });
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

  function updateAutoScale(force = false) {
    if (!pageEntries.length) {
      if (autoScale !== 1) {
        autoScale = 1;
        if (force) applyZoom();
      }
      return;
    }

    const nextScale = 1;
    if (Math.abs(nextScale - autoScale) > 0.01 || force) {
      autoScale = nextScale;
      applyZoom();
    }
  }

  return {
    render,
    setZoom,
    scrollToPage,
    getPages,
  };
}
