// popup.js — v1.1.0
(function () {
  "use strict";

  // ── Element refs ────────────────────────────────────────────────
  const fileListEl       = document.getElementById("fileList");
  const statusEl         = document.getElementById("status");
  const selectAllBtn     = document.getElementById("selectAll");
  const selectNoneBtn    = document.getElementById("selectNone");
  const refreshBtn       = document.getElementById("refresh");
  const flattenChk       = document.getElementById("flattenFolders");
  const askWhereChk      = document.getElementById("askWhere");
  const askWhereLabel    = document.getElementById("askWhereLabel");
  const downloadZipBtn   = document.getElementById("downloadZip");
  const downloadFilesBtn = document.getElementById("downloadFiles");

  let currentBlocks = [];

  // ── Helpers ─────────────────────────────────────────────────────
  const EXT_MAP = {
    javascript: "js", typescript: "ts", python: "py", java: "java",
    csharp: "cs", cpp: "cpp", c: "c", go: "go", rust: "rs", ruby: "rb",
    php: "php", swift: "swift", kotlin: "kt", bash: "sh", shell: "sh",
    sql: "sql", html: "html", css: "css", json: "json", yaml: "yml",
    markdown: "md", md: "md", xml: "xml", text: "txt",
  };

  function fallbackFilename(language, index) {
    const ext = EXT_MAP[(language || "").toLowerCase()] || "txt";
    return `code_${String(index + 1).padStart(3, "0")}.${ext}`;
  }

  function formatBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(2) + " MB";
  }

  /** Replace backslashes, drop empty/`.`/`..` segments. */
  function sanitizeZipPath(raw) {
    if (!raw) return "";
    return String(raw)
      .replace(/\\/g, "/")
      .split("/")
      .map(s => s.trim())
      .filter(s => s && s !== "." && s !== "..")
      .join("/");
  }

  /** Strip characters illegal in ZIP entry names + separators. */
  function sanitizeZipName(raw) {
    if (!raw) return "";
    return String(raw)
      .replace(/[\\/:*?"<>|]/g, "")
      .trim()
      .replace(/^\.+|\.+$/g, "");
  }

  /**
   * Build final path for a download/ZIP entry.
   * If the filename field itself contains a path, it wins — we do
   * NOT prepend finalPath (prevents "src/utils/src/utils/a.js").
   */
  function buildZipPath(folderPath, filename) {
    const name = sanitizeZipName(filename);
    if (!name) return "";
    if (name.includes("/")) return sanitizeZipPath(name);
    const dir = sanitizeZipPath(folderPath);
    return dir ? `${dir}/${name}` : name;
  }

  // ── Content-script bridge ───────────────────────────────────────
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function refreshBlocks() {
    statusEl.textContent = "Scanning…";
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.url || !tab.url.startsWith("https://chat.deepseek.com/")) {
        currentBlocks = [];
        renderList();
        updateToolbarState();
        statusEl.innerHTML = `Open chat.deepseek.com and try again. <span style="float:right">
  provided by <a style="text-decoration: none;color:black;" target="_dudikkocak" href="https://dudik.store?ref=ds-code-extractor">Dudik Kocak</a>
  </span>`;
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "extractCodeBlocks",
      });

      if (response && response.error) throw new Error(response.error);

      currentBlocks = ((response && response.blocks) || []).map((b, i) => ({
        ...b,
        finalFilename: b.filename || fallbackFilename(b.language, i),
        finalPath: b.folderPath || "",
        checked: true,
      }));

      renderList();
      updateToolbarState();
      statusEl.textContent = `Found ${currentBlocks.length} code block(s).`;
    } catch (err) {
      currentBlocks = [];
      renderList();
      updateToolbarState();
      statusEl.textContent =
        "Could not scan. Reload chat.deepseek.com, then click Refresh. (" +
        err.message + ")";
    }
  }

  // ── Rendering ───────────────────────────────────────────────────
  function renderList() {
    if (currentBlocks.length === 0) {
      fileListEl.innerHTML =
        '<div class="empty">No code blocks found on this page.</div>';
      return;
    }
    fileListEl.innerHTML = "";

    currentBlocks.forEach(block => {
      const row = document.createElement("div");
      row.className = "file-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = block.checked;
      cb.addEventListener("change", () => {
        block.checked = cb.checked;
        updateToolbarState();
      });

      const info = document.createElement("div");
      info.className = "file-info";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "file-name-input";
      nameInput.value = block.finalFilename;
      nameInput.placeholder = "filename.ext";
      nameInput.addEventListener("input", () => {
        block.finalFilename = nameInput.value;
      });

      const pathInput = document.createElement("input");
      pathInput.type = "text";
      pathInput.className = "file-path-input";
      pathInput.value = block.finalPath;
      pathInput.placeholder = "folder/path (optional)";
      pathInput.addEventListener("input", () => {
        block.finalPath = pathInput.value;
      });

      const meta = document.createElement("div");
      meta.className = "file-meta";
      const lang = (block.language || "unknown").toUpperCase();
      const size = new Blob([block.code]).size;
      const lines = block.code.split("\n").length;
      meta.textContent = `${lang} · ${formatBytes(size)} · ${lines} lines`;

      const preview = document.createElement("div");
      preview.className = "file-preview";
      preview.textContent =
        block.code.slice(0, 140) + (block.code.length > 140 ? "…" : "");

      info.append(nameInput, pathInput, meta, preview);
      row.append(cb, info);
      fileListEl.appendChild(row);
    });
  }

  function updateToolbarState() {
    const selectedCount = currentBlocks.filter(b => b.checked).length;
    const disabled = selectedCount === 0;

    downloadZipBtn.disabled = disabled;
    downloadFilesBtn.disabled = disabled;
    downloadZipBtn.textContent = `Download ZIP (${selectedCount})`;
    downloadFilesBtn.textContent = `Download Files (${selectedCount})`;

    // "Ask where to save" opens one dialog per file — disable it
    // when more than one file is selected to avoid a dialog flood.
    const multi = selectedCount > 1;
    askWhereChk.disabled = multi;
    askWhereLabel.classList.toggle("disabled", multi);
    if (multi) {
      askWhereChk.checked = false;
    } else {
      askWhereChk.checked = true;
    }
  }

  // ── ZIP download ────────────────────────────────────────────────
  async function downloadZip() {
    const selected = currentBlocks.filter(b => b.checked);
    if (selected.length === 0) return;
    if (typeof JSZip === "undefined") {
      statusEl.textContent =
        "JSZip missing — make sure jszip.min.js sits next to popup.html.";
      return;
    }

    const flatten = flattenChk.checked;
    statusEl.textContent = "Creating ZIP…";

    try {
      const zip = new JSZip();
      const used = new Set();
      const trace = [];

      for (const block of selected) {
        const name = sanitizeZipName(block.finalFilename);
        if (!name) continue;

        let zipPath = flatten
          ? sanitizeZipName(name.split("/").pop())
          : buildZipPath(block.finalPath, block.finalFilename);
        zipPath = sanitizeZipPath(zipPath);
        if (!zipPath) continue;

        // De-dupe identical paths by appending " (2)", " (3)" …
        if (used.has(zipPath)) {
          const dot = zipPath.lastIndexOf(".");
          const stem = dot > 0 ? zipPath.slice(0, dot) : zipPath;
          const ext  = dot > 0 ? zipPath.slice(dot)   : "";
          let n = 2;
          while (used.has(`${stem} (${n})${ext}`)) n++;
          zipPath = `${stem} (${n})${ext}`;
        }
        used.add(zipPath);

        // JSZip creates intermediate folders automatically.
        zip.file(zipPath, block.code);
        trace.push(zipPath);
      }

      if (trace.length === 0) {
        statusEl.textContent = "Nothing to zip (all filenames empty).";
        return;
      }

      console.debug("[DeepSeek ZIP] entries:", trace);

      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const url = URL.createObjectURL(blob);

      chrome.downloads.download(
        {
          url,
          filename: `deepseek-code-${Date.now()}.zip`,
          saveAs: true,
        },
        () => setTimeout(() => URL.revokeObjectURL(url), 30_000)
      );

      statusEl.textContent = `ZIP created with ${trace.length} file(s).`;
    } catch (err) {
      console.error(err);
      statusEl.textContent = "ZIP error: " + err.message;
    }
  }

    // ── Individual downloads ────────────────────────────────────────
  async function downloadIndividualFiles() {
    const selected = currentBlocks.filter(b => b.checked);
    if (selected.length === 0) return;

    const flatten = flattenChk.checked;
    const multi = selected.length > 1;
    const useDialog = !multi && askWhereChk.checked;

    let started = 0;

    for (const block of selected) {
      const name = sanitizeZipName(block.finalFilename);
      if (!name) continue;

      // saveAs:true  → the DIRECTORY part of `filename` is ignored and
      //                only the basename pre-fills the save dialog.
      // saveAs:false → the full path becomes a sub-folder under ~/Downloads.
      const path = useDialog
        ? sanitizeZipPath(name.split("/").pop())
        : sanitizeZipPath(
            flatten
              ? name.split("/").pop()
              : buildZipPath(block.finalPath, block.finalFilename)
          );
      if (!path) continue;

      // 🟢 THE FIX: Use application/octet-stream so Chrome stops forcing .txt
      const blob = new Blob([block.code], { type: "application/octet-stream" });
      const url  = URL.createObjectURL(blob);

      chrome.downloads.download(
        {
          url,
          filename: path,             // pre-fills the save dialog's name field
          saveAs: useDialog,          // dialog only when single file + toggle on
          conflictAction: "uniquify",
        },
        () => setTimeout(() => URL.revokeObjectURL(url), 30_000)
      );
      started++;
    }

    statusEl.textContent = useDialog
      ? "Save dialog opened — pick a folder to finish."
      : `Started ${started} download(s).`;
  }
  
  // ── Wire-up ─────────────────────────────────────────────────────
  selectAllBtn.addEventListener("click", () => {
    currentBlocks.forEach(b => (b.checked = true));
    renderList();
    updateToolbarState();
  });

  selectNoneBtn.addEventListener("click", () => {
    currentBlocks.forEach(b => (b.checked = false));
    renderList();
    updateToolbarState();
  });

  refreshBtn.addEventListener("click", refreshBlocks);
  downloadZipBtn.addEventListener("click", downloadZip);
  downloadFilesBtn.addEventListener("click", downloadIndividualFiles);

  // Auto-scan on open
  refreshBlocks();
})();