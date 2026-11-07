// content.js — runs on chat.deepseek.com, answers the popup's scan request
(function () {
  "use strict";

  /** A filename token: starts with a word char, has a short extension. */
  const FILE_RE = /[\w./-]+\.[a-zA-Z][a-zA-Z0-9]{0,9}/;

  // ────────────────────────────────────────────────────────────────
  // 🟢 NEW: Check if the element is inside a Thinking/Reasoning block
  // ────────────────────────────────────────────────────────────────
  function isInThinkingSection(element) {
    // 1. Check for DeepSeek's specific thinking classes
    if (element.closest('.ds-think, .ds-reasoning, .ds-thinking')) {
      return true;
    }

    // 2. Check for collapsible <details> blocks used for reasoning
    const details = element.closest('details');
    if (details) {
      const summary = details.querySelector('summary');
      // If the summary says "Thinking" or "Reasoning", skip it
      if (summary && /thinking|reasoning/i.test(summary.textContent)) {
        return true;
      }
    }

    // 3. Catch-all: any ancestor with "think" or "reason" in the class name
    if (element.closest('[class*="think" i], [class*="reason" i]')) {
      return true;
    }

    return false;
  }

  // ────────────────────────────────────────────────────────────────
  // Main scan
  // ────────────────────────────────────────────────────────────────
  function extractCodeBlocks() {
    const containers = document.querySelectorAll(".md-code-block");
    const blocks = [];
    let i = 0;

    for (const container of containers) {
      // 🟢 Skip if this code block is part of the thinking process
      if (isInThinkingSection(container)) continue;

      const pre = container.querySelector("pre");
      if (!pre) continue;
      const code = pre.textContent || "";
      if (!code.trim()) continue;

      const banner = container.querySelector(".md-code-block-banner");
      const fromBanner = parseBanner(banner);

      let language = fromBanner.language || null;
      let filename = fromBanner.filename || null;
      let folderPath = fromBanner.folderPath || null;

      if (!filename) {
        const near = extractFromNearbyText(container);
        if (near.filename) {
          filename = near.filename;
          folderPath = folderPath || near.folderPath;
        }
      }

      if (!filename) {
        const first = extractFromFirstLine(code);
        if (first.filename) {
          filename = first.filename;
          folderPath = folderPath || first.folderPath;
        }
      }

      if (!language && filename) language = guessLanguageFromExt(filename);

      blocks.push({
        id: `cb_${i}_${Date.now()}`,
        code,
        language,
        filename,
        folderPath,
      });
      i++;
    }
    return blocks;
  }

  // ────────────────────────────────────────────────────────────────
  // Banner parsing — walks spans, skipping anything inside a button
  // ────────────────────────────────────────────────────────────────
  function parseBanner(banner) {
    if (!banner) return { language: null, filename: null, folderPath: null };

    let label = null;
    for (const span of banner.querySelectorAll("span")) {
      if (span.closest('[role="button"]')) continue;
      if (span.closest("button")) continue;
      if (span.closest("svg")) continue;

      const text = span.textContent.trim();
      if (!text) continue;
      if (/^(copy|download|run|edit|save)$/i.test(text)) continue;

      label = text;
      break;
    }
    if (!label) return { language: null, filename: null, folderPath: null };

    if (FILE_RE.test(label)) return pathResult(label);
    return { language: label.toLowerCase(), filename: null, folderPath: null };
  }

  // ────────────────────────────────────────────────────────────────
  // Walk previous siblings — look for <code>file.ext</code> in <h2>/<p>
  // ────────────────────────────────────────────────────────────────
  function extractFromNearbyText(container, maxSiblings = 4) {
    let sibling = container.previousElementSibling;
    let hops = 0;

    while (sibling && hops < maxSiblings) {
      for (const codeEl of sibling.querySelectorAll("code")) {
        if (codeEl.closest(".md-code-block")) continue;
        const text = codeEl.textContent.trim();
        if (FILE_RE.test(text)) return pathResult(text);
      }
      if (/^H[1-6]$/.test(sibling.tagName)) {
        const m = sibling.textContent.match(FILE_RE);
        if (m) return pathResult(m[0]);
      }
      sibling = sibling.previousElementSibling;
      hops++;
    }
    return { filename: null, folderPath: null };
  }

  // ────────────────────────────────────────────────────────────────
  // First-line comment fallback:  // file.js   # file.py   /* file.css */
  // ────────────────────────────────────────────────────────────────
  function extractFromFirstLine(code) {
    const first = code.split("\n")[0].trim();
    const pats = [
      /^\/\/\s*([\w./-]+\.[a-zA-Z][a-zA-Z0-9]{0,9})\s*$/,
      /^#\s*([\w./-]+\.[a-zA-Z][a-zA-Z0-9]{0,9})\s*$/,
      /^\/\*\s*([\w./-]+\.[a-zA-Z][a-zA-Z0-9]{0,9})\s*\*\/$/,
      /^<!--\s*([\w./-]+\.[a-zA-Z][a-zA-Z0-9]{0,9})\s*-->$/,
      /^--\s*([\w./-]+\.[a-zA-Z][a-zA-Z0-9]{0,9})\s*$/,
      /^(?:filename|file|path)\s*:\s*([\w./-]+\.[a-zA-Z][a-zA-Z0-9]{0,9})/i,
    ];
    for (const p of pats) {
      const m = first.match(p);
      if (m) return pathResult(m[1]);
    }
    return { filename: null, folderPath: null };
  }

  function pathResult(fullPath) {
    const clean = fullPath.replace(/[`'"]/g, "").trim();
    const filename = clean.split("/").pop();
    const folderPath = clean.includes("/")
      ? clean.substring(0, clean.lastIndexOf("/"))
      : null;
    return { filename, folderPath };
  }

  function guessLanguageFromExt(filename) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    const map = {
      js: "javascript", mjs: "javascript", cjs: "javascript",
      ts: "typescript", tsx: "typescript", jsx: "javascript",
      py: "python", rb: "ruby", rs: "rust", go: "go",
      java: "java", kt: "kotlin", swift: "swift",
      cs: "csharp", cpp: "cpp", cxx: "cpp", cc: "cpp", h: "c", hpp: "cpp",
      php: "php", sh: "bash", bash: "bash", zsh: "bash",
      sql: "sql", html: "html", htm: "html", css: "css",
      scss: "scss", less: "less", json: "json", yml: "yaml", yaml: "yaml",
      toml: "toml", xml: "xml", md: "markdown", txt: "text",
    };
    return map[ext] || null;
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "extractCodeBlocks") {
      try {
        sendResponse({ blocks: extractCodeBlocks() });
      } catch (err) {
        sendResponse({ error: err.message, blocks: [] });
      }
      return true;
    }
  });
})();