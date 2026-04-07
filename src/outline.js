const SECTION_LEVELS = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};

const SECTION_RE = /^(?!%)\s*\\(section|subsection|subsubsection|paragraph|subparagraph)\s*\{([^}]*)}/;

/**
 * Parse LaTeX source into a flat list of headings with line numbers.
 */
function parseOutline(source) {
  if (!source) return [];
  const lines = source.split('\n');
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(SECTION_RE);
    if (m) {
      items.push({
        type: m[1],
        level: SECTION_LEVELS[m[1]],
        title: m[2].trim() || m[1],
        line: i,
      });
    }
  }
  return items;
}

/**
 * Build a nested tree from the flat heading list.
 */
function buildTree(items) {
  const root = [];
  const stack = [{ level: 0, children: root }];

  items.forEach((item) => {
    const node = { ...item, children: [] };
    // Pop back to find the right parent
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });

  return root;
}

export function createOutline(container) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'outline-header';
  header.innerHTML = '<span>File outline</span>';

  const list = document.createElement('div');
  list.className = 'outline-list';

  const emptyState = document.createElement('div');
  emptyState.className = 'outline-empty';
  emptyState.textContent = 'No sections found.';

  container.append(header, list, emptyState);

  let onNavigate = null;

  function renderTree(nodes, parentEl, depth = 0) {
    nodes.forEach((node) => {
      const row = document.createElement('div');
      row.className = 'outline-item';
      row.style.paddingLeft = `${12 + depth * 14}px`;
      row.dataset.line = node.line;

      const hasChildren = node.children.length > 0;

      const toggle = document.createElement('span');
      toggle.className = 'outline-toggle';
      toggle.textContent = hasChildren ? '▾' : '';
      row.appendChild(toggle);

      const label = document.createElement('span');
      label.className = 'outline-label';
      label.textContent = node.title;
      row.appendChild(label);

      parentEl.appendChild(row);

      if (hasChildren) {
        const childContainer = document.createElement('div');
        childContainer.className = 'outline-children';
        parentEl.appendChild(childContainer);

        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const collapsed = childContainer.classList.toggle('is-collapsed');
          toggle.textContent = collapsed ? '▸' : '▾';
        });

        renderTree(node.children, childContainer, depth + 1);
      }

      row.addEventListener('click', () => {
        // Highlight
        list.querySelectorAll('.outline-item.is-active').forEach((el) => el.classList.remove('is-active'));
        row.classList.add('is-active');
        onNavigate?.(node.line);
      });
    });
  }

  function update(source) {
    const items = parseOutline(source);
    const tree = buildTree(items);

    list.innerHTML = '';

    if (!tree.length) {
      emptyState.style.display = 'block';
      list.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    list.style.display = 'block';
    renderTree(tree, list);
  }

  function setNavigateHandler(fn) {
    onNavigate = fn;
  }

  return { update, setNavigateHandler };
}
