const MATH_ENV_PATTERN = /\\begin\{(equation\*?|align\*?)\}([\s\S]*?)\\end\{\1\}/g;
const BOOKTABS_PACKAGE_PATTERN = /\\usepackage(?:\[[^\]]*])?\{booktabs\}/gi;
const MATH_PACKAGE_PATTERN = /\\usepackage(?:\[[^\]]*])?\{(?:amsmath|amssymb|amsfonts|mathtools)\}/gi;
const GRAPHICX_PACKAGE_PATTERN = /\\usepackage(?:\[([^\]]*)])?\{graphicx\}/gi;
const INCLUDEGRAPHICS_PATTERN = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
const FIGURE_BEGIN_PATTERN = /\\begin\{figure\*?\}/g;
const GRAPHIC_PLACEHOLDER_PREFIX = 'PREVIEWGRAPHICBLOCK';
const IMAGE_EXTENSIONS = ['', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.PNG', '.JPG', '.JPEG'];
const DEFAULT_TEXT_WIDTH_MM = 210 - 25.4 - 25.4;   // A4 with 1in margins
const DEFAULT_TEXT_HEIGHT_MM = 297 - 25.4 - 25.4;

const GEOMETRY_PACKAGE_PATTERN = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{geometry\}/gi;
const GEOMETRY_COMMAND_PATTERN = /\\geometry\s*\{([^}]*)\}/gi;

const UNIT_TO_MM = {
  pt: 25.4 / 72,
  bp: 25.4 / 72,
  pc: 25.4 / 6,
  mm: 1,
  cm: 10,
  in: 25.4,
};

const PAPER_SIZES_MM = {
  a3paper: { width: 297, height: 420 },
  a4paper: { width: 210, height: 297 },
  a5paper: { width: 148, height: 210 },
  b4paper: { width: 250, height: 353 },
  b5paper: { width: 176, height: 250 },
  letterpaper: { width: 215.9, height: 279.4 },
  legalpaper: { width: 215.9, height: 355.6 },
  executivepaper: { width: 184.15, height: 266.7 },
};

const DEFAULT_MARGIN_MM = 25.4; // 1in, matches LaTeX defaults

const BOOKTABS_COMMANDS = [
  { pattern: /\\toprule/g, replacement: '\\hline', message: 'Replaced \\toprule with \\hline; line weight differences are not simulated.' },
  { pattern: /\\midrule/g, replacement: '\\hline', message: 'Replaced \\midrule with \\hline.' },
  { pattern: /\\bottomrule/g, replacement: '\\hline', message: 'Replaced \\bottomrule with \\hline.' },
];
const CMIDRULE_PATTERN = /\\cmidrule\*?(?:\[[^\]]*])?\{[^}]+\}/g;
const TABULAR_BEGIN_PATTERN = /\\begin\{(tabular\*?)\}/g;
const PLACEHOLDER_PREFIX = 'PREVIEWTABULARBLOCK';

function skipWhitespace(str, index) {
  let cursor = index;
  while (cursor < str.length && /\s/.test(str[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function extractDelimitedContent(str, startIndex, openChar, closeChar) {
  if (str[startIndex] !== openChar) return null;
  let depth = 0;
  for (let i = startIndex; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { content: str.slice(startIndex + 1, i), endIndex: i + 1 };
      }
    } else if (ch === '\\') {
      i += 1;
    }
  }
  return null;
}

function escapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findEnvironmentEnd(source, startIndex, envName) {
  const pattern = new RegExp(`\\\\(begin|end)\{${escapeForRegex(envName)}\}`, 'g');
  pattern.lastIndex = startIndex;
  let depth = 1;
  let match = pattern.exec(source);
  while (match) {
    if (match[1] === 'begin') {
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        return { start: match.index, end: pattern.lastIndex };
      }
    }
    match = pattern.exec(source);
  }
  return null;
}

function parseColumnAlignments(spec = '') {
  const alignments = [];
  const leftRules = []; // leftRules[i] = true when one or more `|` precede column i
  let pendingRule = false;
  let i = 0;
  const pushColumn = (align) => {
    alignments.push(align);
    leftRules.push(pendingRule);
    pendingRule = false;
  };
  while (i < spec.length) {
    const ch = spec[i];
    if (ch === 'l' || ch === 'L') {
      pushColumn('left');
    } else if (ch === 'c' || ch === 'C') {
      pushColumn('center');
    } else if (ch === 'r' || ch === 'R') {
      pushColumn('right');
    } else if (ch === 'p' || ch === 'm' || ch === 'b') {
      pushColumn('left');
      if (spec[i + 1] === '{') {
        const block = extractDelimitedContent(spec, i + 1, '{', '}');
        if (block) {
          i = block.endIndex - 1;
        }
      }
    } else if (ch === '|') {
      pendingRule = true;
    } else if (ch === '@' || ch === '!' || ch === '<' || ch === '>') {
      if (spec[i + 1] === '{') {
        const block = extractDelimitedContent(spec, i + 1, '{', '}');
        if (block) {
          i = block.endIndex - 1;
        }
      }
    }
    i += 1;
  }
  // Anything left over in pendingRule becomes the trailing right-edge rule.
  return { alignments, leftRules, rightRule: pendingRule };
}

function parseMulticolumn(text) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('\\multicolumn')) return null;
  let i = '\\multicolumn'.length;
  while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
  const numArg = extractDelimitedContent(trimmed, i, '{', '}');
  if (!numArg) return null;
  i = numArg.endIndex;
  while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
  const specArg = extractDelimitedContent(trimmed, i, '{', '}');
  if (!specArg) return null;
  i = specArg.endIndex;
  while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
  const contentArg = extractDelimitedContent(trimmed, i, '{', '}');
  if (!contentArg) return null;
  const span = parseInt(numArg.content.trim(), 10);
  if (!Number.isFinite(span) || span < 1) return null;
  const colInfo = parseColumnAlignments(specArg.content);
  return {
    type: 'multicolumn',
    content: contentArg.content,
    span,
    align: colInfo.alignments[0] || 'left',
    leftRule: colInfo.leftRules[0] || false,
    rightRule: colInfo.rightRule || false,
  };
}

function parseTabularBody(body, warnings) {
  const cleaned = (body || '')
    .replace(/%[^\n]*$/gm, '')
    .replace(/\r\n/g, '\n');
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let braceDepth = 0;
  let pendingRule = 0;
  let notedClines = false;

  const pushCell = () => {
    const trimmed = currentCell.trim();
    const mc = parseMulticolumn(trimmed);
    currentRow.push(mc ?? trimmed);
    currentCell = '';
  };

  const cellHasContent = (cell) => (
    typeof cell === 'string' ? cell.length > 0 : Boolean(cell?.content)
  );

  const finalizeRow = () => {
    if (!currentRow.length) return;
    if (!currentRow.some(cellHasContent)) {
      currentRow = [];
      return;
    }
    rows.push({ cells: [...currentRow], hasTopRule: pendingRule > 0 });
    pendingRule = 0;
    currentRow = [];
  };

  let i = 0;
  while (i < cleaned.length) {
    const char = cleaned[i];
    if (char === '\\') {
      if (cleaned.startsWith('\\hline', i)) {
        pendingRule += 1;
        i += 6;
        while (i < cleaned.length && /\s/.test(cleaned[i])) i += 1;
        continue;
      }
      if (cleaned.startsWith('\\cline', i)) {
        pendingRule += 1;
        const clineMatch = /\\cline\*?(?:\[[^\]]*])?\{[^}]+\}/.exec(cleaned.slice(i));
        if (clineMatch) {
          i += clineMatch[0].length;
          if (!notedClines) {
            warnings.push('Converted \\cline segments to \\hline; preview tables only support full-width rules.');
            notedClines = true;
          }
        } else {
          i += 6;
        }
        while (i < cleaned.length && /\s/.test(cleaned[i])) i += 1;
        continue;
      }
      if (cleaned.startsWith('\\\\', i)) {
        pushCell();
        finalizeRow();
        i += 2;
        i = skipWhitespace(cleaned, i);
        if (cleaned[i] === '[') {
          const bracket = extractDelimitedContent(cleaned, i, '[', ']');
          if (bracket) {
            i = bracket.endIndex;
          }
        }
        continue;
      }
      if (cleaned[i + 1] === '&') {
        currentCell += '&';
        i += 2;
        continue;
      }
    }
    if (char === '&' && braceDepth === 0) {
      pushCell();
      i += 1;
      continue;
    }
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }
    currentCell += char;
    i += 1;
  }
  pushCell();
  finalizeRow();
  const trailingRule = pendingRule > 0;
  return { rows, trailingRule };
}

function rewriteTabularEnvironments(source, warnings) {
  if (!source) return { content: source, tables: [] };
  const tables = [];
  let result = '';
  let lastIndex = 0;
  TABULAR_BEGIN_PATTERN.lastIndex = 0;
  let match;
  while ((match = TABULAR_BEGIN_PATTERN.exec(source))) {
    const envName = match[1];
    const beginIndex = match.index;
    let cursor = TABULAR_BEGIN_PATTERN.lastIndex;
    cursor = skipWhitespace(source, cursor);
    if (envName === 'tabular*') {
      const widthBlock = extractDelimitedContent(source, cursor, '{', '}');
      if (!widthBlock) continue;
      cursor = skipWhitespace(source, widthBlock.endIndex);
    }
    if (source[cursor] === '[') {
      const optionBlock = extractDelimitedContent(source, cursor, '[', ']');
      if (optionBlock) {
        cursor = skipWhitespace(source, optionBlock.endIndex);
      }
    }
    const colBlock = extractDelimitedContent(source, cursor, '{', '}');
    if (!colBlock) continue;
    const colSpec = colBlock.content;
    const bodyStart = colBlock.endIndex;
    const envEnd = findEnvironmentEnd(source, bodyStart, envName);
    if (!envEnd) continue;
    const body = source.slice(bodyStart, envEnd.start);
    const placeholder = `${PLACEHOLDER_PREFIX}${tables.length}`;
    result += source.slice(lastIndex, beginIndex);
    result += `\n${placeholder}\n`;
    lastIndex = envEnd.end;
    const parsed = parseTabularBody(body, warnings);
    const colInfo = parseColumnAlignments(colSpec);
    tables.push({
      placeholder,
      alignments: colInfo.alignments,
      leftRules: colInfo.leftRules,
      rightRule: colInfo.rightRule,
      rows: parsed.rows,
      bottomRule: parsed.trailingRule,
    });
    warnings.push('Rendered \\begin{tabular} ... \\end{tabular} using a preview-only table; spacing and width controls are approximate.');
  }
  result += source.slice(lastIndex);
  return { content: result, tables };
}


function stripBooktabsPackage(source, warnings) {
  if (!source) return source;
  if (!BOOKTABS_PACKAGE_PATTERN.test(source)) {
    BOOKTABS_PACKAGE_PATTERN.lastIndex = 0;
    return source;
  }
  BOOKTABS_PACKAGE_PATTERN.lastIndex = 0;
  warnings.push('Removed \\usepackage{booktabs}; preview applies built-in replacements for booktabs rules.');
  return source.replace(BOOKTABS_PACKAGE_PATTERN, '');
}

function stripMathPackages(source) {
  if (!source || !MATH_PACKAGE_PATTERN.test(source)) {
    MATH_PACKAGE_PATTERN.lastIndex = 0;
    return source;
  }
  MATH_PACKAGE_PATTERN.lastIndex = 0;
  return source.replace(MATH_PACKAGE_PATTERN, '');
}

function rewriteBooktabsCommands(source, warnings) {
  if (!source) return source;
  let result = source;
  BOOKTABS_COMMANDS.forEach(({ pattern, replacement, message }) => {
    if (pattern.test(result)) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
      warnings.push(message);
    }
  });

  if (CMIDRULE_PATTERN.test(result)) {
    CMIDRULE_PATTERN.lastIndex = 0;
    result = result.replace(CMIDRULE_PATTERN, '\\hline');
    warnings.push('Converted \\cmidrule segments to \\hline for preview compatibility.');
  }

  return result;
}

function parseLengthMm(str) {
  if (!str) return null;
  const match = /^([+-]?\d*\.?\d+)\s*([a-z]+)$/i.exec(String(str).trim());
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || !(unit in UNIT_TO_MM)) return null;
  return value * UNIT_TO_MM[unit];
}

function parseGeometryOptionString(optStr) {
  const opts = {};
  if (!optStr) return opts;
  // Split on commas that aren't inside braces (geometry options don't really
  // nest braces, but be defensive).
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i < optStr.length; i += 1) {
    const ch = optStr[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(optStr.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(optStr.slice(start));
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) {
        opts[part.toLowerCase()] = true;
      } else {
        const key = part.slice(0, eq).trim().toLowerCase();
        const value = part.slice(eq + 1).trim();
        opts[key] = value;
      }
    });
  return opts;
}

function resolveGeometry(rawOpts, warnings) {
  let paperWidth = PAPER_SIZES_MM.a4paper.width;
  let paperHeight = PAPER_SIZES_MM.a4paper.height;

  Object.keys(rawOpts).forEach((key) => {
    if (rawOpts[key] === true && PAPER_SIZES_MM[key]) {
      paperWidth = PAPER_SIZES_MM[key].width;
      paperHeight = PAPER_SIZES_MM[key].height;
    }
  });
  if (rawOpts.landscape === true) {
    [paperWidth, paperHeight] = [paperHeight, paperWidth];
  }
  const pw = parseLengthMm(rawOpts.paperwidth);
  if (pw) paperWidth = pw;
  const ph = parseLengthMm(rawOpts.paperheight);
  if (ph) paperHeight = ph;

  let left = DEFAULT_MARGIN_MM;
  let right = DEFAULT_MARGIN_MM;
  let top = DEFAULT_MARGIN_MM;
  let bottom = DEFAULT_MARGIN_MM;

  const tryAssign = (key, target) => {
    const v = parseLengthMm(rawOpts[key]);
    return v == null ? target : v;
  };

  const m = parseLengthMm(rawOpts.margin);
  if (m != null) { left = right = top = bottom = m; }
  const hm = parseLengthMm(rawOpts.hmargin);
  if (hm != null) { left = right = hm; }
  const vm = parseLengthMm(rawOpts.vmargin);
  if (vm != null) { top = bottom = vm; }
  left = tryAssign('left', left);
  left = tryAssign('lmargin', left);
  right = tryAssign('right', right);
  right = tryAssign('rmargin', right);
  top = tryAssign('top', top);
  top = tryAssign('tmargin', top);
  bottom = tryAssign('bottom', bottom);
  bottom = tryAssign('bmargin', bottom);

  let textWidth = paperWidth - left - right;
  let textHeight = paperHeight - top - bottom;
  const tw = parseLengthMm(rawOpts.textwidth);
  if (tw) textWidth = tw;
  const th = parseLengthMm(rawOpts.textheight);
  if (th) textHeight = th;

  if (textWidth <= 5 || textHeight <= 5) {
    warnings.push(
      `Ignoring \\usepackage{geometry} options — resulting text area `
      + `(${textWidth.toFixed(1)}mm × ${textHeight.toFixed(1)}mm) is invalid for the page.`,
    );
    return null;
  }

  // Re-derive margins so the three column widths sum exactly to paperWidth
  // (latex.js's grid uses these three values as the grid template columns).
  const finalLeft = Math.max(left, 0);
  const finalRight = Math.max(paperWidth - finalLeft - textWidth, 0);

  return {
    paperWidth,
    paperHeight,
    left: finalLeft,
    right: finalRight,
    top: Math.max(top, 0),
    bottom: Math.max(bottom, 0),
    textWidth,
    textHeight,
  };
}

function extractGeometry(source, warnings) {
  if (!source) return { content: source, geometry: null };
  let touched = false;
  const rawOpts = {};
  let cleaned = source;

  cleaned = cleaned.replace(GEOMETRY_PACKAGE_PATTERN, (_match, optStr) => {
    touched = true;
    if (optStr) Object.assign(rawOpts, parseGeometryOptionString(optStr));
    return '';
  });

  cleaned = cleaned.replace(GEOMETRY_COMMAND_PATTERN, (_match, optStr) => {
    touched = true;
    Object.assign(rawOpts, parseGeometryOptionString(optStr));
    return '';
  });

  if (!touched) return { content: source, geometry: null };

  const geometry = resolveGeometry(rawOpts, warnings);
  if (geometry) {
    warnings.push(
      `Applied geometry options (page ${geometry.paperWidth.toFixed(1)}×${geometry.paperHeight.toFixed(1)}mm, `
      + `text ${geometry.textWidth.toFixed(1)}×${geometry.textHeight.toFixed(1)}mm).`,
    );
  }
  return { content: cleaned, geometry };
}

function rewriteFigureEnvironments(source, warnings) {
  if (!source || !source.includes('\\begin{figure')) {
    return { content: source, labels: {} };
  }
  const labels = {}; // label name → figure number
  let result = '';
  let lastIndex = 0;
  let figureNumber = 0;
  let warned = false;
  FIGURE_BEGIN_PATTERN.lastIndex = 0;
  let match;
  while ((match = FIGURE_BEGIN_PATTERN.exec(source))) {
    const beginIndex = match.index;
    const envName = match[0].includes('*') ? 'figure*' : 'figure';
    let cursor = FIGURE_BEGIN_PATTERN.lastIndex;
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] === '[') {
      const opt = extractDelimitedContent(source, cursor, '[', ']');
      if (opt) cursor = opt.endIndex;
    }
    const envEnd = findEnvironmentEnd(source, cursor, envName);
    if (!envEnd) continue;
    const body = source.slice(cursor, envEnd.start);
    figureNumber += 1;

    // Pull out caption text (brace-balanced) and remove \centering.
    let captionText = '';
    let cleaned = body;
    cleaned = cleaned.replace(/\\centering\s*/g, '');
    const captionRe = /\\caption\s*\{/g;
    let capMatch;
    while ((capMatch = captionRe.exec(cleaned))) {
      const openIdx = capMatch.index + capMatch[0].length - 1;
      const block = extractDelimitedContent(cleaned, openIdx, '{', '}');
      if (!block) break;
      captionText = block.content.trim();
      cleaned = cleaned.slice(0, capMatch.index) + cleaned.slice(block.endIndex);
      captionRe.lastIndex = capMatch.index;
    }

    // Extract \label{...} → store mapping to this figure's number.
    cleaned = cleaned.replace(/\\label\s*\{([^}]*)\}/g, (_m, labelName) => {
      const key = labelName.trim();
      if (key) labels[key] = String(figureNumber);
      return '';
    });
    cleaned = cleaned.trim();

    const captionPart = captionText
      ? `\n\n\\textbf{Figure ${figureNumber}:} ${captionText}\n`
      : '';
    const replacement = `\n\\begin{center}\n${cleaned}${captionPart}\n\\end{center}\n`;

    result += source.slice(lastIndex, beginIndex);
    result += replacement;
    lastIndex = envEnd.end;
    FIGURE_BEGIN_PATTERN.lastIndex = envEnd.end;
    if (!warned) {
      warnings.push('Rendered \\begin{figure} as a centered block with caption; floats are not actually positioned.');
      warned = true;
    }
  }
  result += source.slice(lastIndex);
  return { content: result, labels };
}

function rewriteMathEnvironments(source, warnings) {
  if (!source) return { content: source, labels: {} };
  const labels = {};
  let eqNumber = 0;
  let warnedAlign = false;

  const content = source.replace(MATH_ENV_PATTERN, (_match, envName, body) => {
    const isStarred = envName.includes('*');
    const isAlign = envName.startsWith('align');

    if (isAlign) {
      if (!warnedAlign) {
        warnings.push(`Converted \\begin{${envName}} to aligned display block for browser preview.`);
        warnedAlign = true;
      }
      // Split into lines on \\ (with optional [length] arg).
      const lines = body.split(/\\\\\s*(?:\[[^\]]*\])?\s*/);
      const processed = [];
      for (const raw of lines) {
        let line = raw.trim();
        if (!line) continue;
        const hasNonumber = /\\(nonumber|notag)\b/.test(line);
        line = line.replace(/\\(nonumber|notag)\b\s*/g, '');
        line = line.replace(/\\label\s*\{([^}]*)\}/g, (_m, labelName) => {
          const key = labelName.trim();
          if (key && !isStarred && !hasNonumber) labels[key] = String(eqNumber + 1);
          return '';
        });
        if (!isStarred && !hasNonumber) {
          eqNumber += 1;
          line += ` && \\text{(${eqNumber})}`;
        }
        processed.push(line);
      }
      return `\\[\\begin{aligned}\n${processed.join(' \\\\\n')}\n\\end{aligned}\\]`;
    }

    // equation / equation*
    let cleaned = body.replace(/\\label\s*\{([^}]*)\}/g, (_m, labelName) => {
      const key = labelName.trim();
      if (key && !isStarred) labels[key] = String(eqNumber + 1);
      return '';
    });
    if (!isStarred) {
      eqNumber += 1;
      return `\\[${cleaned}\\tag{${eqNumber}}\\]`;
    }
    return `\\[${cleaned}\\]`;
  });

  return { content, labels };
}

function resolveRefs(source, labels) {
  if (!source || !Object.keys(labels).length) return source;
  let result = source.replace(/\\eqref\s*\{([^}]*)\}/g, (_match, labelName) => {
    const key = labelName.trim();
    const num = labels[key];
    return num ? `(${num})` : '(??)';
  });
  result = result.replace(/\\ref\s*\{([^}]*)\}/g, (_match, labelName) => {
    const key = labelName.trim();
    return labels[key] ?? '??';
  });
  return result;
}

function resolveGraphicLength(value, textWidthMm, textHeightMm) {
  if (!value) return null;
  const trimmed = String(value).trim();
  // Match "0.5\linewidth", "\textwidth", "0.7 \columnwidth" — case-insensitive.
  const widthRe = /^(?:([\d.]+)\s*)?\\(linewidth|textwidth|columnwidth|hsize)\b/i;
  const wMatch = widthRe.exec(trimmed);
  if (wMatch) {
    const factor = wMatch[1] ? parseFloat(wMatch[1]) : 1.0;
    return `${(factor * textWidthMm).toFixed(2)}mm`;
  }
  const heightRe = /^(?:([\d.]+)\s*)?\\(textheight|vsize)\b/i;
  const hMatch = heightRe.exec(trimmed);
  if (hMatch) {
    const factor = hMatch[1] ? parseFloat(hMatch[1]) : 1.0;
    return `${(factor * textHeightMm).toFixed(2)}mm`;
  }
  return trimmed;
}

function stripGraphicxPackage(source, warnings) {
  if (!source || !GRAPHICX_PACKAGE_PATTERN.test(source)) {
    GRAPHICX_PACKAGE_PATTERN.lastIndex = 0;
    return { content: source, draft: false };
  }
  GRAPHICX_PACKAGE_PATTERN.lastIndex = 0;
  let draft = false;
  const cleaned = source.replace(GRAPHICX_PACKAGE_PATTERN, (_match, optStr) => {
    if (optStr && /\bdraft\b/i.test(optStr)) draft = true;
    return '';
  });
  warnings.push('Removed \\usepackage{graphicx}; preview substitutes uploaded images for \\includegraphics.');
  return { content: cleaned, draft };
}

function resolveImageName(name, images) {
  if (!images) return null;
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = trimmed + ext;
    if (images[candidate]) return candidate;
  }
  // Case-insensitive fallback.
  const lower = trimmed.toLowerCase();
  for (const key of Object.keys(images)) {
    const k = key.toLowerCase();
    if (k === lower) return key;
    for (const ext of IMAGE_EXTENSIONS) {
      if (k === lower + ext.toLowerCase()) return key;
    }
  }
  return null;
}

function rewriteIncludeGraphics(source, images, warnings, geometry, options = {}) {
  if (!source) return { content: source, graphics: [] };
  if (!INCLUDEGRAPHICS_PATTERN.test(source)) {
    INCLUDEGRAPHICS_PATTERN.lastIndex = 0;
    return { content: source, graphics: [] };
  }
  INCLUDEGRAPHICS_PATTERN.lastIndex = 0;
  const textWidthMm = geometry?.textWidth ?? DEFAULT_TEXT_WIDTH_MM;
  const textHeightMm = geometry?.textHeight ?? DEFAULT_TEXT_HEIGHT_MM;
  const graphics = [];
  let warnedMissing = false;
  let warnedNoUploads = false;
  const result = source.replace(INCLUDEGRAPHICS_PATTERN, (_match, optStr, rawName) => {
    const placeholder = `${GRAPHIC_PLACEHOLDER_PREFIX}${graphics.length}`;
    const opts = optStr ? parseGeometryOptionString(optStr) : {};
    const resolved = resolveImageName(rawName, images);
    const isDraft = options.draft === true;
    const entry = {
      placeholder,
      requestedName: (rawName || '').trim(),
      resolvedName: resolved,
      url: isDraft ? null : (resolved ? images[resolved].url : null),
      width: resolveGraphicLength(opts.width, textWidthMm, textHeightMm),
      height: resolveGraphicLength(opts.height, textWidthMm, textHeightMm),
      scale: opts.scale ? parseFloat(opts.scale) : null,
      angle: opts.angle ? parseFloat(opts.angle) : null,
      keepAspectRatio: opts.keepaspectratio === true,
    };
    graphics.push(entry);
    if (!resolved) {
      if (!images || !Object.keys(images).length) {
        if (!warnedNoUploads) {
          warnings.push('No images uploaded — \\includegraphics references will render as missing-image placeholders.');
          warnedNoUploads = true;
        }
      } else if (!warnedMissing) {
        warnings.push(`\\includegraphics{${entry.requestedName}} did not match any uploaded image.`);
        warnedMissing = true;
      }
    }
    return `\n${placeholder}\n`;
  });
  return { content: result, graphics };
}

export function preprocessLatex(source, options = {}) {
  const warnings = [];
  let content = source ?? '';
  // Snapshot a few preamble facts before we start stripping packages.
  const graphicxLoaded = /\\usepackage(?:\[[^\]]*])?\{graphicx\}/i.test(content);
  const usesIncludeGraphics = /\\includegraphics\b/.test(content);
  if (usesIncludeGraphics && !graphicxLoaded) {
    return {
      content: '',
      warnings,
      tables: [],
      geometry: null,
      graphics: [],
      error: 'Undefined control sequence \\includegraphics.\n\nAdd \\usepackage{graphicx} to the preamble before using \\includegraphics.',
    };
  }
  const geometryResult = extractGeometry(content, warnings);
  content = geometryResult.content;
  content = stripBooktabsPackage(content, warnings);
  content = rewriteBooktabsCommands(content, warnings);
  content = stripMathPackages(content);
  const graphicxResult = stripGraphicxPackage(content, warnings);
  content = graphicxResult.content;
  const figureResult = rewriteFigureEnvironments(content, warnings);
  content = figureResult.content;
  const mathResult = rewriteMathEnvironments(content, warnings);
  content = mathResult.content;
  const allLabels = { ...figureResult.labels, ...mathResult.labels };
  content = resolveRefs(content, allLabels);
  const graphicsResult = rewriteIncludeGraphics(
    content,
    options.images,
    warnings,
    geometryResult.geometry,
    { draft: graphicxResult.draft },
  );
  content = graphicsResult.content;
  const tabularResult = rewriteTabularEnvironments(content, warnings);
  content = tabularResult.content;
  return {
    content,
    warnings,
    tables: tabularResult.tables,
    geometry: geometryResult.geometry,
    graphics: graphicsResult.graphics,
  };
}
