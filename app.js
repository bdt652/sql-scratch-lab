"use strict";

(function startSQLiteStudio(global) {
  const HISTORY_PREFIX = "sqlite-scratch-history-v3:";
  const EDITOR_PREFIX = "sqlite-scratch-editor-v3:";
  const MAX_HISTORY = 50;
  const MAX_RENDERED_ROWS = 1000;
  const elements = {};
  const state = {
    workspace: null,
    builder: null,
    schema: [],
    history: [],
    lastExecution: null,
    busy: false,
    editorSaveTimer: null,
  };

  let resolveReady;
  let rejectReady;
  global.sqlStudioReady = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const STATIC_IDS = [
    "loadingScreen", "runtimeBadge", "saveState", "openHelpButton", "databaseSelect",
    "newDatabaseButton", "renameDatabaseButton", "deleteDatabaseButton", "importDatabaseInput",
    "exportDatabaseButton", "databaseMeta", "schemaPane", "schemaSearchInput", "refreshSchemaButton",
    "schemaTree", "historyPane", "clearHistoryButton", "historyList", "editorMode", "blocksMode",
    "templateSelect", "insertTemplateButton", "explainButton", "clearEditorButton", "sqlEditor",
    "transactionBadge", "editorStats", "editorHint", "executionScope", "runEditorButton",
    "clearResultsButton", "resultMeta", "resultPlaceholder", "resultOutput", "toastRegion",
    "databaseDialog", "databaseForm", "databaseNameInput", "confirmCreateDatabaseButton", "helpDialog",
  ];

  function cacheElements() {
    STATIC_IDS.forEach((id) => {
      elements[id] = document.getElementById(id);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function quoteIdentifier(identifier) {
    const value = String(identifier || "");
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return value;
    return `"${value.replaceAll('"', '""')}"`;
  }

  function safeGet(key) {
    try {
      return global.localStorage?.getItem(key) || null;
    } catch {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      global.localStorage?.setItem(key, value);
    } catch {
      // The core database remains persisted in IndexedDB.
    }
  }

  function safeRemove(key) {
    try {
      global.localStorage?.removeItem(key);
    } catch {
      // Ignore unavailable localStorage.
    }
  }

  function formatBytes(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
    return `${(size / 1024 ** 2).toFixed(1)} MB`;
  }

  function formatDuration(milliseconds) {
    const duration = Number(milliseconds || 0);
    return duration < 1 ? "< 1 ms" : `${duration.toFixed(duration < 10 ? 1 : 0)} ms`;
  }

  function formatDate(isoDate) {
    try {
      return new Intl.DateTimeFormat("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      }).format(new Date(isoDate));
    } catch {
      return "Vừa xong";
    }
  }

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span aria-hidden="true">${type === "success" ? "✓" : type === "error" ? "!" : "i"}</span><p>${escapeHtml(message)}</p>`;
    elements.toastRegion.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    global.setTimeout(() => {
      toast.classList.remove("show");
      global.setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  function setRuntimeStatus(text, mode = "ready") {
    elements.runtimeBadge.className = `runtime-badge ${mode}`;
    elements.runtimeBadge.innerHTML = `<span class="status-dot ${mode}"></span>${escapeHtml(text)}`;
  }

  function setSaveState(text, mode = "saved") {
    elements.saveState.className = `save-state ${mode}`;
    elements.saveState.innerHTML = `<span class="status-dot ${mode}"></span>${escapeHtml(text)}`;
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.runEditorButton.disabled = busy;
    elements.runEditorButton.classList.toggle("is-running", busy);
    elements.databaseSelect.disabled = busy;
    if (busy) {
      elements.runEditorButton.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>Đang chạy…';
    } else {
      elements.runEditorButton.innerHTML = '<span aria-hidden="true">▶</span>Chạy SQL<kbd>Ctrl ↵</kbd>';
    }
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function getObjects(type) {
    return state.schema.filter((object) => object.type === type);
  }

  function getFirstQueryableObject() {
    return state.schema.find((object) => object.type === "table")
      || state.schema.find((object) => object.type === "view")
      || null;
  }

  function sampleLiteral(column) {
    const type = String(column?.type || "").toUpperCase();
    if (/INT|REAL|NUM|DEC|DOUBLE|FLOAT/.test(type)) return "1";
    if (/BLOB/.test(type)) return "X'00'";
    return `'Giá trị mẫu'`;
  }

  function getTemplate(templateName) {
    const object = getFirstQueryableObject();
    const table = object?.name || "products";
    const quotedTable = quoteIdentifier(table);
    const columns = object?.columns || [];
    const usableColumns = columns.filter((column) => !(column.primaryKey && /INT/i.test(column.type))).slice(0, 4);
    const firstColumn = columns[0]?.name || "id";
    const valueColumn = usableColumns[0]?.name || columns[1]?.name || "name";

    const templates = {
      select: `SELECT *\nFROM ${quotedTable}\nLIMIT 100;`,
      "student-system": `-- CREATE DATABASE được lớp tương thích của ứng dụng xử lý\nCREATE DATABASE QuanLyHocSinh;\n\nCREATE TABLE Lop (\n  MaLop CHAR(10) PRIMARY KEY,\n  TenLop VARCHAR(50) NOT NULL\n);\n\nCREATE TABLE HocSinh (\n  MaHS CHAR(10) PRIMARY KEY,\n  HoTen VARCHAR(50) NOT NULL,\n  NgaySinh DATE,\n  GioiTinh BOOLEAN,\n  MaLop CHAR(10),\n  DiemTB REAL CHECK (DiemTB BETWEEN 0 AND 10),\n  FOREIGN KEY (MaLop) REFERENCES Lop(MaLop)\n    ON UPDATE CASCADE ON DELETE SET NULL\n);\n\n-- Dữ liệu lớp phải có trước học sinh vì có khóa ngoài\nINSERT INTO Lop (MaLop, TenLop) VALUES\n  ('11A1', 'Lớp 11A1'),\n  ('11A2', 'Lớp 11A2');\n\nINSERT INTO HocSinh (MaHS, HoTen, NgaySinh, GioiTinh, MaLop, DiemTB) VALUES\n  ('HS002', 'Trần Thị Bình', '2008-08-20', FALSE, '11A1', 8.6),\n  ('HS003', 'Lê Minh Châu', '2008-03-15', TRUE, '11A2', 7.9);\n\nSELECT HocSinh.HoTen, Lop.TenLop, HocSinh.DiemTB\nFROM HocSinh\nINNER JOIN Lop ON HocSinh.MaLop = Lop.MaLop\nORDER BY HocSinh.DiemTB DESC;`,
      "create-table": `CREATE TABLE products (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),\n  stock INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n);`,
      "alter-table": `-- SQLite hỗ trợ ADD COLUMN, RENAME COLUMN, RENAME TO và DROP COLUMN\nALTER TABLE ${quotedTable}\nADD COLUMN GhiChu TEXT;`,
      insert: usableColumns.length
        ? `INSERT INTO ${quotedTable} (${usableColumns.map((column) => quoteIdentifier(column.name)).join(", ")})\nVALUES (${usableColumns.map(sampleLiteral).join(", ")});`
        : `INSERT INTO products (name, price, stock)\nVALUES ('Bàn phím', 450000, 12);`,
      update: `UPDATE ${quotedTable}\nSET ${quoteIdentifier(valueColumn)} = ${sampleLiteral(usableColumns[0])}\nWHERE ${quoteIdentifier(firstColumn)} = 1;`,
      delete: `DELETE FROM ${quotedTable}\nWHERE ${quoteIdentifier(firstColumn)} = 1;`,
      join: getObjects("table").some((item) => item.name === "enrollments")
        ? `SELECT s.name, c.title, e.status\nFROM enrollments AS e\nJOIN students AS s ON s.id = e.student_id\nJOIN courses AS c ON c.id = e.course_id\nORDER BY s.name;`
        : `SELECT a.*, b.*\nFROM table_a AS a\nJOIN table_b AS b ON b.a_id = a.id;`,
      group: object && columns.length
        ? `SELECT ${quoteIdentifier(columns.find((column) => /TEXT/i.test(column.type))?.name || firstColumn)} AS nhom,\n       COUNT(*) AS so_luong\nFROM ${quotedTable}\nGROUP BY ${quoteIdentifier(columns.find((column) => /TEXT/i.test(column.type))?.name || firstColumn)}\nHAVING COUNT(*) >= 1\nORDER BY so_luong DESC;`
        : `SELECT category, COUNT(*) AS so_luong\nFROM products\nGROUP BY category\nHAVING COUNT(*) >= 1;`,
      view: `CREATE VIEW ${quoteIdentifier(`view_${table}`)} AS\nSELECT *\nFROM ${quotedTable};\n\nSELECT * FROM ${quoteIdentifier(`view_${table}`)};`,
      index: `CREATE INDEX ${quoteIdentifier(`idx_${table}_${firstColumn}`)}\nON ${quotedTable} (${quoteIdentifier(firstColumn)});`,
      trigger: `CREATE TABLE IF NOT EXISTS audit_log (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  action TEXT NOT NULL,\n  object_name TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TRIGGER ${quoteIdentifier(`trg_${table}_after_update`)}\nAFTER UPDATE ON ${quotedTable}\nBEGIN\n  INSERT INTO audit_log (action, object_name)\n  VALUES ('UPDATE', '${String(table).replaceAll("'", "''")}');\nEND;`,
      transaction: `BEGIN TRANSACTION;\n\nUPDATE ${quotedTable}\nSET ${quoteIdentifier(valueColumn)} = ${sampleLiteral(usableColumns[0])}\nWHERE ${quoteIdentifier(firstColumn)} = 1;\n\n-- Đổi COMMIT thành ROLLBACK nếu muốn hủy thay đổi\nCOMMIT;`,
      pragma: `PRAGMA database_list;\nPRAGMA table_list;\nPRAGMA foreign_key_check;\nSELECT sqlite_version() AS sqlite_version;`,
    };
    return templates[templateName] || "";
  }

  function starterSql() {
    const object = getFirstQueryableObject();
    if (object) {
      const columns = object.columns?.slice(0, 4).map((column) => quoteIdentifier(column.name)).join(", ") || "*";
      return `SELECT ${columns}\nFROM ${quoteIdentifier(object.name)}\nLIMIT 100;`;
    }
    return `-- Database đang trống. Hãy tạo table đầu tiên.\nCREATE TABLE products (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  price REAL NOT NULL DEFAULT 0\n);\n\nINSERT INTO products (name, price) VALUES\n  ('Bàn phím', 450000),\n  ('Chuột', 220000);\n\nSELECT * FROM products;`;
  }

  function editorStorageKey(name = state.workspace?.currentName) {
    return `${EDITOR_PREFIX}${name || "default"}`;
  }

  function saveEditorNow(name = state.workspace?.currentName) {
    if (!name || !elements.sqlEditor) return;
    safeSet(editorStorageKey(name), elements.sqlEditor.value);
  }

  function loadEditor() {
    const saved = safeGet(editorStorageKey());
    elements.sqlEditor.value = saved ?? starterSql();
    updateEditorStatus();
  }

  function queueEditorSave() {
    global.clearTimeout(state.editorSaveTimer);
    const name = state.workspace?.currentName;
    state.editorSaveTimer = global.setTimeout(() => saveEditorNow(name), 180);
  }

  function getEditorSelection() {
    const start = elements.sqlEditor.selectionStart;
    const end = elements.sqlEditor.selectionEnd;
    const hasSelection = Number.isInteger(start) && Number.isInteger(end) && end > start;
    return {
      hasSelection,
      sql: hasSelection ? elements.sqlEditor.value.slice(start, end) : elements.sqlEditor.value,
    };
  }

  function updateEditorStatus() {
    const text = elements.sqlEditor.value;
    const lines = text ? text.split("\n").length : 0;
    elements.editorStats.textContent = `${lines} dòng · ${text.length} ký tự`;
    const selection = getEditorSelection();
    elements.executionScope.textContent = selection.hasSelection
      ? `Sẽ chỉ chạy ${selection.sql.length} ký tự đang chọn`
      : "Sẽ chạy toàn bộ nội dung editor";
    elements.editorHint.textContent = selection.hasSelection
      ? "Đang chọn một phần câu lệnh"
      : "Chọn một đoạn để chỉ chạy đoạn đó";
  }

  function setEditorSql(sql, options = {}) {
    elements.sqlEditor.value = String(sql || "");
    saveEditorNow();
    updateEditorStatus();
    if (options.switchToEditor !== false) setMode("editor");
    if (options.focus !== false) elements.sqlEditor.focus();
  }

  function setMode(mode) {
    document.querySelectorAll("[data-mode-tab]").forEach((button) => {
      const active = button.dataset.modeTab === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    elements.editorMode.hidden = mode !== "editor";
    elements.blocksMode.hidden = mode !== "blocks";
  }

  function setSideTab(tab) {
    document.querySelectorAll("[data-side-tab]").forEach((button) => {
      const active = button.dataset.sideTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    elements.schemaPane.hidden = tab !== "schema";
    elements.historyPane.hidden = tab !== "history";
  }

  function historyStorageKey(name = state.workspace?.currentName) {
    return `${HISTORY_PREFIX}${name || "default"}`;
  }

  function loadHistory() {
    const raw = safeGet(historyStorageKey());
    try {
      state.history = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.history)) state.history = [];
    } catch {
      state.history = [];
    }
    renderHistory();
  }

  function addHistory(sql, execution, error = null) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sql,
      createdAt: new Date().toISOString(),
      success: !error,
      statements: execution?.statements || 0,
      affectedRows: execution?.affectedRows || 0,
      resultRows: execution?.results?.reduce((sum, result) => sum + result.values.length, 0) || 0,
      durationMs: execution?.durationMs || 0,
      error: error ? String(error.message || error) : "",
    };
    state.history = [entry, ...state.history].slice(0, MAX_HISTORY);
    safeSet(historyStorageKey(), JSON.stringify(state.history));
    renderHistory();
  }

  function renderHistory() {
    if (!state.history.length) {
      elements.historyList.innerHTML = `
        <div class="explorer-empty">
          <span aria-hidden="true">↺</span>
          <strong>Chưa có lịch sử</strong>
          <p>Các câu SQL đã chạy sẽ xuất hiện ở đây.</p>
        </div>`;
      return;
    }

    elements.historyList.innerHTML = state.history.map((entry) => `
      <button class="history-entry ${entry.success ? "success" : "failed"}" type="button" data-history-id="${escapeHtml(entry.id)}">
        <span class="history-status" aria-hidden="true">${entry.success ? "✓" : "!"}</span>
        <span class="history-content">
          <code>${escapeHtml(entry.sql.replace(/\s+/g, " ").trim().slice(0, 150))}</code>
          <small>${formatDate(entry.createdAt)} · ${formatDuration(entry.durationMs)}${entry.success ? ` · ${entry.resultRows} dòng kết quả` : " · Có lỗi"}</small>
        </span>
      </button>
    `).join("");
  }

  function schemaGroupLabel(type) {
    return { table: "TABLES", view: "VIEWS", index: "INDEXES", trigger: "TRIGGERS" }[type] || type.toUpperCase();
  }

  function schemaIcon(type) {
    return { table: "▦", view: "◫", index: "⌕", trigger: "⚡" }[type] || "•";
  }

  function renderSchema() {
    if (!state.schema.length) {
      elements.schemaTree.innerHTML = `
        <div class="explorer-empty">
          <span aria-hidden="true">▰</span>
          <strong>Database đang trống</strong>
          <p>Dùng SQL Editor và chạy CREATE TABLE để bắt đầu.</p>
          <button class="text-button" type="button" data-empty-template="create-table">Nạp mẫu CREATE TABLE</button>
        </div>`;
      return;
    }

    const types = ["table", "view", "index", "trigger"];
    elements.schemaTree.innerHTML = types.map((type) => {
      const objects = state.schema.filter((object) => object.type === type);
      if (!objects.length) return "";
      return `
        <section class="schema-group" data-schema-group="${type}">
          <div class="schema-group-title"><span>${schemaGroupLabel(type)}</span><b>${objects.length}</b></div>
          ${objects.map((object) => renderSchemaObject(object)).join("")}
        </section>`;
    }).join("");
  }

  function renderSchemaObject(object) {
    const searchable = [object.name, object.tableName, ...object.columns.map((column) => `${column.name} ${column.type}`)].join(" ").toLocaleLowerCase("vi");
    const canQuery = object.type === "table" || object.type === "view";
    return `
      <details class="schema-object" data-schema-search="${escapeHtml(searchable)}">
        <summary>
          <span class="schema-object-icon ${object.type}" aria-hidden="true">${schemaIcon(object.type)}</span>
          <strong title="${escapeHtml(object.name)}">${escapeHtml(object.name)}</strong>
          ${canQuery ? `<small>${object.columns.length} cột</small>` : `<small>${escapeHtml(object.tableName || "")}</small>`}
          <span class="schema-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="schema-object-body">
          ${object.columns.length ? `
            <div class="schema-columns">
              ${object.columns.map((column) => `
                <button type="button" class="schema-column" data-insert-identifier="${escapeHtml(column.name)}" title="Chèn tên cột vào editor">
                  <span>${column.primaryKey ? "◇" : column.notNull ? "◆" : "○"}</span>
                  <strong>${escapeHtml(column.name)}</strong>
                  <small>${escapeHtml(column.type)}${column.primaryKey ? " · PK" : ""}</small>
                </button>
              `).join("")}
            </div>` : ""}
          ${object.foreignKeys.length ? `
            <div class="foreign-key-list">
              <span class="mini-label">FOREIGN KEYS</span>
              ${object.foreignKeys.map((key) => `<code>${escapeHtml(key.from)} → ${escapeHtml(key.table)}.${escapeHtml(key.to)}</code>`).join("")}
            </div>` : ""}
          <div class="schema-object-actions">
            ${canQuery ? `<button class="text-button" type="button" data-preview-object="${escapeHtml(object.name)}">Xem 100 dòng</button>` : ""}
            <button class="text-button" type="button" data-insert-identifier="${escapeHtml(object.name)}">Chèn tên</button>
          </div>
          ${object.sql ? `<details class="object-ddl"><summary>Xem câu lệnh DDL</summary><pre><code>${escapeHtml(object.sql)}</code></pre></details>` : ""}
        </div>
      </details>`;
  }

  function applySchemaSearch() {
    const needle = elements.schemaSearchInput.value.trim().toLocaleLowerCase("vi");
    elements.schemaTree.querySelectorAll("[data-schema-search]").forEach((object) => {
      object.hidden = Boolean(needle) && !object.dataset.schemaSearch.includes(needle);
    });
    elements.schemaTree.querySelectorAll("[data-schema-group]").forEach((group) => {
      const visible = [...group.querySelectorAll("[data-schema-search]")].some((object) => !object.hidden);
      group.hidden = !visible;
    });
  }

  function insertAtCursor(text) {
    const editor = elements.sqlEditor;
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    editor.setRangeText(text, start, end, "end");
    saveEditorNow();
    updateEditorStatus();
    setMode("editor");
    editor.focus();
  }

  async function refreshDatabaseList() {
    const databases = await state.workspace.listDatabases();
    elements.databaseSelect.innerHTML = databases.map((database) => `
      <option value="${escapeHtml(database.name)}" ${database.name === state.workspace.currentName ? "selected" : ""}>
        ${escapeHtml(database.name)}
      </option>`).join("");
  }

  async function refreshSchema(options = {}) {
    state.schema = state.workspace.getSchema();
    renderSchema();
    applySchemaSearch();
    if (state.builder) {
      if (options.newDatabase) state.builder.setDatabase(state.workspace.currentName, state.schema);
      else state.builder.updateSchema(state.schema);
    }
    const status = state.workspace.getStatus();
    const tables = getObjects("table").length;
    const views = getObjects("view").length;
    elements.databaseMeta.innerHTML = `<span>${tables} bảng${views ? ` · ${views} view` : ""} · ${formatBytes(status.size)}</span>`;
    elements.transactionBadge.hidden = !status.transactionOpen;
    return state.schema;
  }

  async function refreshWorkspace(options = {}) {
    await refreshDatabaseList();
    await refreshSchema({ newDatabase: true });
    loadHistory();
    if (options.loadEditor !== false) loadEditor();
    const status = state.workspace.getStatus();
    setRuntimeStatus(`v${status.sqliteVersion}`, "ready");
    setSaveState(status.storageMode === "indexeddb" ? "Đã lưu" : "Lưu tạm", status.storageMode === "indexeddb" ? "saved" : "warning");
  }

  function renderValue(value) {
    if (value === null || value === undefined) return '<span class="null-value">NULL</span>';
    if (value instanceof Uint8Array) return `<span class="blob-value">BLOB · ${value.byteLength} bytes</span>`;
    if (typeof value === "object") return escapeHtml(JSON.stringify(value));
    return escapeHtml(value);
  }

  function renderExecution(execution) {
    state.lastExecution = execution;
    elements.resultPlaceholder.hidden = true;
    elements.resultOutput.hidden = false;
    const totalRows = execution.results.reduce((sum, result) => sum + result.values.length, 0);
    elements.resultMeta.textContent = `${execution.statements} lệnh · ${totalRows} dòng · ${execution.affectedRows} thay đổi · ${formatDuration(execution.durationMs)}`;

    const resultSets = execution.results.map((result, index) => {
      const displayedRows = result.values.slice(0, MAX_RENDERED_ROWS);
      return `
        <article class="result-card">
          <header class="result-card-header">
            <div>
              <span class="result-success-icon" aria-hidden="true">✓</span>
              <strong>Tập kết quả ${index + 1}</strong>
              <small>${result.values.length} dòng × ${result.columns.length} cột</small>
            </div>
            <button class="button button-ghost button-small" type="button" data-download-csv="${index}">Tải CSV</button>
          </header>
          <div class="table-scroll" tabindex="0">
            <table class="result-table">
              <thead><tr>${result.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("")}</tr></thead>
              <tbody>
                ${displayedRows.map((row) => `<tr>${row.map((value) => `<td>${renderValue(value)}</td>`).join("")}</tr>`).join("")}
              </tbody>
            </table>
          </div>
          ${result.values.length > displayedRows.length ? `<div class="result-truncated">Đang hiển thị ${displayedRows.length}/${result.values.length} dòng. Tải CSV để xem đầy đủ.</div>` : ""}
          <details class="executed-sql"><summary>SQL đã thực thi</summary><pre><code>${escapeHtml(result.sql)}</code></pre></details>
        </article>`;
    }).join("");

    const commandSummary = `
      <article class="execution-summary success">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>SQLite đã thực thi thành công</strong>
          <p>${execution.statements} câu lệnh; ${execution.affectedRows} dòng dữ liệu thay đổi trong ${formatDuration(execution.durationMs)}.${execution.transactionOpen ? " Transaction vẫn đang mở và chưa được lưu." : " Database đã được tự lưu."}</p>
        </div>
      </article>`;
    elements.resultOutput.innerHTML = commandSummary + (resultSets || `
      <article class="no-row-result">
        <span aria-hidden="true">✓</span>
        <strong>Lệnh không trả về bảng kết quả</strong>
        <p>DDL, DML hoặc câu lệnh điều khiển đã chạy xong.</p>
      </article>`);
  }

  function getSqlErrorHint(errorMessage) {
    const message = String(errorMessage || "");
    const missingColumn = message.match(/no such column:\s*([^\s]+)/i)?.[1];
    if (missingColumn) {
      return `Cột ${missingColumn} chưa được khai báo. Nếu cần sắp xếp theo điểm, hãy thêm DiemTB vào CREATE TABLE hoặc dùng ALTER TABLE HocSinh ADD COLUMN DiemTB REAL.`;
    }
    const missingTable = message.match(/no such table:\s*(?:main\.)?([^\s]+)/i)?.[1];
    if (missingTable) {
      return `Bảng ${missingTable} chưa tồn tại. Với khóa ngoài, hãy tạo bảng Lop và thêm các mã lớp trước khi thêm HocSinh.`;
    }
    if (/FOREIGN KEY constraint failed/i.test(message)) {
      return "Giá trị khóa ngoài chưa tồn tại trong bảng cha. Hãy thêm MaLop tương ứng vào bảng Lop trước.";
    }
    if (/has \d+ columns but \d+ values were supplied/i.test(message)) {
      return "Số giá trị không khớp số cột. Nên ghi rõ danh sách cột trong INSERT, nhất là khi bảng có thêm cột DiemTB.";
    }
    if (/already exists/i.test(message)) {
      return "Đối tượng đã tồn tại. Có thể đổi tên, xóa đối tượng cũ hoặc dùng IF NOT EXISTS khi phù hợp.";
    }
    return "";
  }

  function renderExecutionError(error, sql) {
    state.lastExecution = null;
    const execution = error.execution || {};
    elements.resultPlaceholder.hidden = true;
    elements.resultOutput.hidden = false;
    elements.resultMeta.textContent = `SQLite báo lỗi · ${formatDuration(execution.durationMs)}`;
    const hint = getSqlErrorHint(error.message || String(error));
    elements.resultOutput.innerHTML = `
      <article class="execution-summary error">
        <span aria-hidden="true">!</span>
        <div>
          <strong>Không thể thực thi câu lệnh</strong>
          <p>${escapeHtml(error.message || String(error))}</p>
        </div>
      </article>
      ${hint ? `<div class="error-hint"><strong>Gợi ý sửa:</strong><span>${escapeHtml(hint)}</span></div>` : ""}
      <details class="failed-sql" open>
        <summary>SQL gây lỗi</summary>
        <pre><code>${escapeHtml(sql)}</code></pre>
      </details>`;
  }

  function clearResults() {
    state.lastExecution = null;
    elements.resultOutput.innerHTML = "";
    elements.resultOutput.hidden = true;
    elements.resultPlaceholder.hidden = false;
    elements.resultMeta.textContent = "Chưa chạy câu lệnh";
  }

  function csvCell(value) {
    if (value === null || value === undefined) return "";
    const text = value instanceof Uint8Array ? `[BLOB ${value.byteLength} bytes]` : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadCsv(index) {
    const result = state.lastExecution?.results?.[index];
    if (!result) return;
    const lines = [result.columns.map(csvCell).join(","), ...result.values.map((row) => row.map(csvCell).join(","))];
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${sanitizeFileName(state.workspace.currentName)}-ket-qua-${index + 1}.csv`);
  }

  function sanitizeFileName(value) {
    return String(value || "database").trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "database";
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function syncAfterSql(previousDatabaseName) {
    const databaseChanged = previousDatabaseName !== state.workspace.currentName;
    await refreshDatabaseList();
    await refreshSchema({ newDatabase: databaseChanged });
    if (databaseChanged) {
      loadHistory();
      saveEditorNow(state.workspace.currentName);
    }
    return databaseChanged;
  }

  async function executeSql(sql, source = "editor") {
    const command = String(sql || "").trim();
    if (!command) {
      showToast("Hãy nhập câu lệnh SQL trước khi chạy.", "error");
      return null;
    }
    if (state.busy) return null;

    setBusy(true);
    setSaveState("Đang thực thi…", "saving");
    const previousDatabaseName = state.workspace.currentName;
    try {
      const execution = await state.workspace.execute(command);
      renderExecution(execution);
      await syncAfterSql(previousDatabaseName);
      addHistory(command, execution);
      if (execution.transactionOpen) setSaveState("Transaction chưa lưu", "warning");
      else setSaveState("Đã lưu", "saved");
      showToast(source === "blocks" ? "Đã chạy truy vấn từ các khối." : "SQLite đã thực thi thành công.", "success");
      return execution;
    } catch (error) {
      renderExecutionError(error, command);
      try {
        await syncAfterSql(previousDatabaseName);
      } catch (syncError) {
        console.error("Không thể đồng bộ giao diện sau khi chạy SQL.", syncError);
      }
      addHistory(command, error.execution, error);
      elements.transactionBadge.hidden = !state.workspace.getStatus().transactionOpen;
      setSaveState(state.workspace.getStatus().transactionOpen ? "Transaction chưa lưu" : "Không có thay đổi", state.workspace.getStatus().transactionOpen ? "warning" : "saved");
      showToast(error.message || "Câu lệnh SQL có lỗi.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runEditor() {
    saveEditorNow();
    const selection = getEditorSelection();
    return executeSql(selection.sql, "editor");
  }

  async function guardOpenTransaction(actionLabel) {
    if (!state.workspace.getStatus().transactionOpen) return true;
    const accepted = global.confirm(`Database đang có transaction chưa COMMIT. Bạn có muốn ROLLBACK rồi ${actionLabel} không?`);
    if (!accepted) return false;
    await state.workspace.rollbackOpenTransaction();
    setSaveState("Đã rollback", "saved");
    return true;
  }

  async function switchDatabase(name) {
    if (!name || name === state.workspace.currentName) return;
    const previous = state.workspace.currentName;
    try {
      if (!(await guardOpenTransaction("chuyển database"))) {
        elements.databaseSelect.value = previous;
        return;
      }
      saveEditorNow(previous);
      setSaveState("Đang mở database…", "saving");
      await state.workspace.switchDatabase(name);
      clearResults();
      await refreshWorkspace();
      showToast(`Đã mở database “${name}”.`, "success");
    } catch (error) {
      elements.databaseSelect.value = previous;
      setSaveState("Không thể chuyển", "warning");
      showToast(error.message, "error");
    }
  }

  async function createDatabaseFromDialog(event) {
    event.preventDefault();
    if (!elements.databaseForm.reportValidity()) return;
    const name = elements.databaseNameInput.value;
    const starter = new FormData(elements.databaseForm).get("starter");
    elements.confirmCreateDatabaseButton.disabled = true;
    try {
      saveEditorNow();
      const createdName = await state.workspace.createDatabase(name, { sample: starter === "sample" });
      await state.workspace.switchDatabase(createdName);
      closeDialog(elements.databaseDialog);
      elements.databaseForm.reset();
      clearResults();
      await refreshWorkspace();
      showToast(`Đã tạo database “${createdName}”.`, "success");
    } catch (error) {
      showToast(error.message, "error");
      elements.databaseNameInput.focus();
    } finally {
      elements.confirmCreateDatabaseButton.disabled = false;
    }
  }

  async function renameDatabase() {
    if (!(await guardOpenTransaction("đổi tên"))) return;
    const oldName = state.workspace.currentName;
    const newName = global.prompt("Tên mới cho database:", oldName);
    if (newName === null || newName.trim() === oldName) return;
    try {
      saveEditorNow(oldName);
      const renamed = await state.workspace.renameDatabase(newName);
      state.builder.renameDatabase(oldName, renamed);
      const editorContent = safeGet(editorStorageKey(oldName));
      if (editorContent !== null) {
        safeSet(editorStorageKey(renamed), editorContent);
        safeRemove(editorStorageKey(oldName));
      }
      const historyContent = safeGet(`${HISTORY_PREFIX}${oldName}`);
      if (historyContent !== null) {
        safeSet(`${HISTORY_PREFIX}${renamed}`, historyContent);
        safeRemove(`${HISTORY_PREFIX}${oldName}`);
      }
      await refreshWorkspace({ loadEditor: false });
      showToast(`Đã đổi tên thành “${renamed}”.`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function deleteDatabase() {
    const name = state.workspace.currentName;
    if (!(await guardOpenTransaction("xóa database"))) return;
    if (!global.confirm(`Xóa database “${name}” khỏi trình duyệt này? Hành động này không thể hoàn tác nếu bạn chưa xuất file sao lưu.`)) return;
    try {
      await state.workspace.deleteDatabase(name);
      safeRemove(editorStorageKey(name));
      safeRemove(`${HISTORY_PREFIX}${name}`);
      clearResults();
      await refreshWorkspace();
      showToast(`Đã xóa database “${name}”.`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function importDatabase(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    document.querySelector(".database-more")?.removeAttribute("open");
    if (!file) return;
    try {
      if (!(await guardOpenTransaction("nhập database"))) return;
      setSaveState("Đang kiểm tra file…", "saving");
      const bytes = await file.arrayBuffer();
      const name = await state.workspace.importDatabase(file.name, bytes);
      saveEditorNow();
      await state.workspace.switchDatabase(name);
      clearResults();
      await refreshWorkspace();
      showToast(`Đã nhập và mở “${name}”.`, "success");
    } catch (error) {
      setSaveState("File không hợp lệ", "warning");
      showToast(`Không thể nhập database: ${error.message}`, "error");
    }
  }

  async function exportDatabase() {
    try {
      const bytes = await state.workspace.exportCurrent();
      const blob = new Blob([bytes], { type: "application/x-sqlite3" });
      downloadBlob(blob, `${sanitizeFileName(state.workspace.currentName)}.sqlite`);
      showToast("Đã xuất file SQLite để sao lưu.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function bindUiEvents() {
    document.querySelectorAll("[data-mode-tab]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.modeTab));
    });
    document.querySelectorAll("[data-side-tab]").forEach((button) => {
      button.addEventListener("click", () => setSideTab(button.dataset.sideTab));
    });

    elements.openHelpButton.addEventListener("click", () => openDialog(elements.helpDialog));
    elements.newDatabaseButton.addEventListener("click", () => {
      elements.databaseNameInput.value = "";
      openDialog(elements.databaseDialog);
      global.setTimeout(() => elements.databaseNameInput.focus(), 0);
    });
    elements.databaseForm.addEventListener("submit", createDatabaseFromDialog);
    elements.databaseSelect.addEventListener("change", () => switchDatabase(elements.databaseSelect.value));
    elements.renameDatabaseButton.addEventListener("click", () => {
      elements.renameDatabaseButton.closest("details")?.removeAttribute("open");
      renameDatabase();
    });
    elements.deleteDatabaseButton.addEventListener("click", () => {
      elements.deleteDatabaseButton.closest("details")?.removeAttribute("open");
      deleteDatabase();
    });
    elements.importDatabaseInput.addEventListener("change", importDatabase);
    elements.exportDatabaseButton.addEventListener("click", exportDatabase);

    elements.sqlEditor.addEventListener("input", () => {
      updateEditorStatus();
      queueEditorSave();
    });
    ["select", "keyup", "mouseup"].forEach((eventName) => elements.sqlEditor.addEventListener(eventName, updateEditorStatus));
    elements.sqlEditor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        runEditor();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const start = elements.sqlEditor.selectionStart;
        const end = elements.sqlEditor.selectionEnd;
        elements.sqlEditor.setRangeText("  ", start, end, "end");
        queueEditorSave();
        updateEditorStatus();
      }
    });
    elements.runEditorButton.addEventListener("click", runEditor);
    elements.clearEditorButton.addEventListener("click", () => setEditorSql(""));
    elements.insertTemplateButton.addEventListener("click", () => {
      const template = getTemplate(elements.templateSelect.value);
      if (!template) return showToast("Hãy chọn một mẫu SQL.", "error");
      setEditorSql(template);
      showToast("Đã nạp mẫu; bạn có thể sửa trước khi chạy.", "success");
    });
    elements.templateSelect.addEventListener("change", () => {
      elements.insertTemplateButton.disabled = !elements.templateSelect.value;
    });
    elements.explainButton.addEventListener("click", () => {
      const sql = getEditorSelection().sql.trim().replace(/;\s*$/, "");
      if (!sql) return showToast("Hãy nhập một truy vấn cần phân tích.", "error");
      executeSql(`EXPLAIN QUERY PLAN ${sql};`, "editor");
    });

    elements.refreshSchemaButton.addEventListener("click", async () => {
      await refreshSchema();
      showToast("Đã làm mới schema.", "success");
    });
    elements.schemaSearchInput.addEventListener("input", applySchemaSearch);
    elements.schemaTree.addEventListener("click", (event) => {
      const preview = event.target.closest("[data-preview-object]");
      const insert = event.target.closest("[data-insert-identifier]");
      const emptyTemplate = event.target.closest("[data-empty-template]");
      if (preview) {
        const sql = `SELECT *\nFROM ${quoteIdentifier(preview.dataset.previewObject)}\nLIMIT 100;`;
        setEditorSql(sql);
        executeSql(sql, "schema");
      } else if (insert) {
        insertAtCursor(quoteIdentifier(insert.dataset.insertIdentifier));
      } else if (emptyTemplate) {
        elements.templateSelect.value = emptyTemplate.dataset.emptyTemplate;
        setEditorSql(getTemplate(emptyTemplate.dataset.emptyTemplate));
      }
    });

    elements.historyList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-history-id]");
      const entry = state.history.find((item) => item.id === button?.dataset.historyId);
      if (entry) setEditorSql(entry.sql);
    });
    elements.clearHistoryButton.addEventListener("click", () => {
      state.history = [];
      safeRemove(historyStorageKey());
      renderHistory();
      showToast("Đã xóa lịch sử của database này.", "success");
    });

    elements.clearResultsButton.addEventListener("click", clearResults);
    elements.resultOutput.addEventListener("click", (event) => {
      const button = event.target.closest("[data-download-csv]");
      if (button) downloadCsv(Number(button.dataset.downloadCsv));
    });

    document.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          const rect = dialog.getBoundingClientRect();
          const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
          if (!inside) closeDialog(dialog);
        }
      });
    });
  }

  async function initialize() {
    cacheElements();
    bindUiEvents();
    elements.insertTemplateButton.disabled = true;

    try {
      state.workspace = new global.SQLiteLab.SQLiteWorkspace({ wasmPath: "vendor/" });
      await state.workspace.initialize();
      state.schema = state.workspace.getSchema();

      state.builder = new global.SqlBlockBuilder({
        onRun: (sql) => executeSql(sql, "blocks"),
        onSendToEditor: (sql) => {
          setEditorSql(sql);
          showToast("Đã đưa câu lệnh sang SQL Editor.", "success");
        },
        onToast: showToast,
      });
      state.builder.init();
      await refreshWorkspace();

      elements.loadingScreen.classList.add("is-hidden");
      global.setTimeout(() => { elements.loadingScreen.hidden = true; }, 360);
      document.documentElement.dataset.appReady = "true";
      document.dispatchEvent(new CustomEvent("sql-studio-ready"));
      resolveReady({ workspace: state.workspace, builder: state.builder });
    } catch (error) {
      console.error(error);
      setRuntimeStatus("SQLite không khởi động", "error");
      elements.loadingScreen.innerHTML = `
        <div class="loading-card loading-error">
          <strong>Không thể khởi động SQLite</strong>
          <span>${escapeHtml(error.message || String(error))}</span>
          <button class="button button-primary" type="button" onclick="location.reload()">Tải lại trang</button>
        </div>`;
      document.documentElement.dataset.appReady = "error";
      rejectReady(error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})(globalThis);
