// content.js
// Injected into chatgpt.com at document_idle.
// Also called programmatically by popup.js via chrome.scripting.executeScript.

function extractConversation() {
  // Guard: check if ChatGPT is still streaming a response
  const isStreaming = document.querySelector('[data-testid="stop-button"]');
  if (isStreaming) {
    return { error: 'ChatGPTの応答が完了するまでお待ちください。' };
  }

  // 1. Gather all message containers: regular messages + canvas documents.
  // A single querySelectorAll with a selector list is guaranteed by spec to
  // return results in DOM order — no separate collection or sorting needed.
  const entries = [];

  document.querySelectorAll(
    '[id^="textdoc-message-"] .ProseMirror, [data-message-author-role]'
  ).forEach(node => {
    if (node.hasAttribute('data-message-author-role')) {
      entries.push({ node, role: node.getAttribute('data-message-author-role'), isCanvas: false });
    } else {
      // ProseMirror canvas document block
      const turn = node.closest('[data-turn]');
      entries.push({ node, role: turn?.getAttribute('data-turn') || 'assistant', isCanvas: true });
    }
  });

  if (entries.length === 0) {
    return { error: 'メッセージが見つかりません。チャットを開いているか確認してください。' };
  }

  // 2. Extract conversation title
  let title = '';

  const titleEl =
    document.querySelector('[data-testid="conversation-title"]') ||
    document.querySelector('nav [aria-current] span') ||
    document.querySelector('nav .active span') ||
    document.querySelector('h1');

  if (titleEl && titleEl.textContent.trim()) {
    title = titleEl.textContent.trim();
  } else {
    title = document.title
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, '')
      .trim();
  }

  if (!title || title.toLowerCase() === 'chatgpt') {
    title = 'ChatGPT Conversation';
  }

  // 3. Process each entry
  const messages = [];

  entries.forEach(({ node, role, isCanvas }) => {
    const md = nodeToMarkdown(node);
    if (md.trim()) {
      messages.push({ role, content: md.trim(), isCanvas });
    }
  });

  if (messages.length === 0) {
    return { error: 'メッセージの内容を抽出できませんでした。' };
  }

  // 4. Build the Markdown document
  const dateStr = new Date().toISOString().slice(0, 10);
  let markdown = `# ${escapeMarkdownHeading(title)}\n\n`;
  markdown += `*Exported on ${dateStr} from ChatGPT*\n\n---\n\n`;

  messages.forEach(({ role, content, isCanvas }) => {
    const label = role === 'user' ? '## You' : '## ChatGPT';
    const body = isCanvas ? `\`\`\`markdown\n${content}\n\`\`\`` : content;
    markdown += `${label}\n\n${body}\n\n---\n\n`;
  });

  // 5. Build a safe filename
  const safeTitle = title
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);

  const filename = `${safeTitle || 'ChatGPT'}_${dateStr}.md`;

  return { markdown, filename, title, messageCount: messages.length };
}


// ─── DOM → Markdown converter ────────────────────────────────────────────────

function nodeToMarkdown(rootNode) {
  return convertNode(rootNode).trim();
}

function convertNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const tag = node.tagName.toLowerCase();

  // Skip UI chrome: buttons, icons, hidden elements
  if (
    node.getAttribute('aria-hidden') === 'true' ||
    node.classList.contains('sr-only') ||
    tag === 'button' ||
    tag === 'svg'
  ) {
    return '';
  }

  // Skip copy buttons and other action elements by data-testid
  const testId = node.getAttribute('data-testid') || '';
  if (testId.includes('button') || testId.includes('action') || testId.includes('copy')) {
    return '';
  }

  // ── Block-level elements ──

  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    const prefix = '#'.repeat(level);
    return `\n\n${prefix} ${childrenToMarkdown(node)}\n\n`;
  }

  if (tag === 'p') {
    return `\n\n${childrenToMarkdown(node)}\n\n`;
  }

  if (tag === 'ul') {
    return '\n\n' + listToMarkdown(node, false) + '\n\n';
  }

  if (tag === 'ol') {
    return '\n\n' + listToMarkdown(node, true) + '\n\n';
  }

  if (tag === 'li') {
    return `- ${childrenToMarkdown(node)}\n`;
  }

  if (tag === 'blockquote') {
    const inner = childrenToMarkdown(node).trim();
    return '\n\n' + inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
  }

  if (tag === 'hr') {
    return '\n\n---\n\n';
  }

  // Code blocks — <pre><code> pattern
  if (tag === 'pre') {
    const codeEl = node.querySelector('code');
    const langEl = node.querySelector('[class*="language-"], [data-code-language]');

    let lang = '';
    if (langEl) {
      const cls = langEl.className || '';
      const match = cls.match(/language-(\S+)/);
      lang = match ? match[1] : (langEl.getAttribute('data-code-language') || '');
    } else if (codeEl) {
      const cls = codeEl.className || '';
      const match = cls.match(/language-(\S+)/);
      if (match) lang = match[1];
    }

    const codeText = (codeEl || node).innerText || (codeEl || node).textContent;
    return `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
  }

  // Inline code (not inside <pre>)
  if (tag === 'code' && node.parentElement?.tagName?.toLowerCase() !== 'pre') {
    return `\`${node.textContent}\``;
  }

  // ── Inline elements ──

  if (tag === 'strong' || tag === 'b') {
    const inner = childrenToMarkdown(node);
    return inner ? `**${inner}**` : '';
  }

  if (tag === 'em' || tag === 'i') {
    const inner = childrenToMarkdown(node);
    return inner ? `*${inner}*` : '';
  }

  if (tag === 's' || tag === 'del') {
    const inner = childrenToMarkdown(node);
    return inner ? `~~${inner}~~` : '';
  }

  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    const text = childrenToMarkdown(node);
    if (!text) return href;
    if (!href || href === text) return text;
    return `[${text}](${href})`;
  }

  if (tag === 'br') {
    return '\n';
  }

  if (tag === 'table') {
    return tableToMarkdown(node);
  }

  // Math: KaTeX stores raw LaTeX in <annotation encoding="application/x-tex">
  if (
    tag === 'math' ||
    node.classList.contains('katex') ||
    node.classList.contains('MathJax')
  ) {
    const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation) {
      const tex = annotation.textContent.trim();
      const isBlock = node.closest('.math-display, [display="block"]');
      return isBlock ? `\n\n$$${tex}$$\n\n` : `$${tex}$`;
    }
    return node.textContent;
  }

  // Generic containers: div, span, section, article, etc.
  return childrenToMarkdown(node);
}


function childrenToMarkdown(node) {
  let result = '';
  node.childNodes.forEach(child => {
    result += convertNode(child);
  });
  return result;
}


function listToMarkdown(listNode, ordered) {
  let result = '';
  let index = 1;
  listNode.childNodes.forEach(child => {
    if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'li') {
      const prefix = ordered ? `${index}. ` : '- ';
      const content = childrenToMarkdown(child).trim().replace(/\n/g, '\n  ');
      result += `${prefix}${content}\n`;
      index++;
    }
  });
  return result;
}


function tableToMarkdown(tableNode) {
  const rows = tableNode.querySelectorAll('tr');
  if (rows.length === 0) return '';

  const data = [];
  let maxCols = 0;

  rows.forEach(row => {
    const cells = [];
    row.querySelectorAll('th, td').forEach(cell => {
      cells.push(childrenToMarkdown(cell).trim().replace(/\|/g, '\\|'));
    });
    data.push(cells);
    if (cells.length > maxCols) maxCols = cells.length;
  });

  if (data.length === 0 || maxCols === 0) return '';

  data.forEach(row => {
    while (row.length < maxCols) row.push('');
  });

  const header = `| ${data[0].join(' | ')} |`;
  const separator = `| ${Array(maxCols).fill('---').join(' | ')} |`;
  const body = data.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n');

  return `\n\n${header}\n${separator}\n${body}\n\n`;
}


function escapeMarkdownHeading(str) {
  return str.replace(/[#*_`[\]]/g, '\\$&');
}
