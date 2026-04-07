const ALIGN_ENV_PATTERN = /\\begin\{(align\*?)\}([\s\S]*?)\\end\{\1\}/g;
const BOOKTABS_PACKAGE_PATTERN = /\\usepackage(?:\[[^\]]*])?\{booktabs\}/gi;
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
  let i = 0;
  while (i < spec.length) {
    const ch = spec[i];
    if (ch === 'l' || ch === 'L') {
      alignments.push('left');
    } else if (ch === 'c' || ch === 'C') {
      alignments.push('center');
    } else if (ch === 'r' || ch === 'R') {
      alignments.push('right');
    } else if (ch === 'p' || ch === 'm' || ch === 'b') {
      alignments.push('left');
      if (spec[i + 1] === '{') {
        const block = extractDelimitedContent(spec, i + 1, '{', '}');
        if (block) {
          i = block.endIndex - 1;
        }
      }
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
  return alignments;
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
    currentRow.push(currentCell.trim());
    currentCell = '';
  };

  const finalizeRow = () => {
    if (!currentRow.length) return;
    const hasContent = currentRow.some((cell) => cell.length > 0);
    if (!hasContent) {
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
    tables.push({
      placeholder,
      alignments: parseColumnAlignments(colSpec),
      rows: parsed.rows,
      bottomRule: parsed.trailingRule,
    });
    warnings.push('Rendered \\begin{tabular} ... \\end{tabular} using a preview-only table; spacing and width controls are approximate.');
  }
  result += source.slice(lastIndex);
  return { content: result, tables };
}

function rewriteAlignEnvironments(source, warnings) {
  if (!source || !ALIGN_ENV_PATTERN.test(source)) {
    ALIGN_ENV_PATTERN.lastIndex = 0;
    return source;
  }

  ALIGN_ENV_PATTERN.lastIndex = 0;
  return source.replace(ALIGN_ENV_PATTERN, (_, envName, body) => {
    warnings.push(`Converted \\begin{${envName}} ... \\end{${envName}} to an aligned display block for browser preview.`);
    const trimmed = body.trim();
    return `\\[\n\\begin{aligned}\n${trimmed}\n\\end{aligned}\n\\]`;
  });
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

export function preprocessLatex(source) {
  const warnings = [];
  let content = source ?? '';
  content = stripBooktabsPackage(content, warnings);
  content = rewriteBooktabsCommands(content, warnings);
  const tabularResult = rewriteTabularEnvironments(content, warnings);
  content = tabularResult.content;
  content = rewriteAlignEnvironments(content, warnings);
  return { content, warnings, tables: tabularResult.tables };
}
