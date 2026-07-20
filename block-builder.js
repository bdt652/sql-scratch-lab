"use strict";

(function attachSqlBlockBuilder(global) {
  const STORAGE_PREFIX = "sqlite-scratch-blocks-v3:";

  const BLOCKS = {
    select: {
      keyword: "SELECT",
      help: "Chọn cột cần xem",
      className: "block-select",
      singleton: true,
    },
    from: {
      keyword: "FROM",
      help: "Chọn bảng hoặc view",
      className: "block-from",
      singleton: true,
    },
    where: {
      keyword: "WHERE",
      help: "Bắt đầu điều kiện lọc",
      className: "block-where",
      singleton: true,
    },
    and: {
      keyword: "AND",
      help: "Thêm điều kiện bắt buộc",
      className: "block-and",
      singleton: false,
    },
    or: {
      keyword: "OR",
      help: "Thêm điều kiện lựa chọn",
      className: "block-or",
      singleton: false,
    },
    order: {
      keyword: "ORDER BY",
      help: "Sắp xếp kết quả",
      className: "block-order",
      singleton: true,
    },
    limit: {
      keyword: "LIMIT",
      help: "Giới hạn số dòng",
      className: "block-limit",
      singleton: true,
    },
  };

  const OPERATORS = ["=", "!=", ">", ">=", "<", "<=", "LIKE", "NOT LIKE", "IS", "IS NOT"];
  const SQL_KEYWORDS = /\b(SELECT|DISTINCT|FROM|WHERE|AND|OR|ORDER\s+BY|ASC|DESC|LIMIT|LIKE|NOT\s+LIKE|IS\s+NOT|IS|NULL)\b/gi;

  function createId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    if (value === "*") return "*";
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return value;
    return `"${value.replaceAll('"', '""')}"`;
  }

  function formatLiteral(value, operator) {
    const source = String(value ?? "").trim();
    const normalizedOperator = String(operator || "").toUpperCase();

    if (["IS", "IS NOT"].includes(normalizedOperator) && (!source || source.toUpperCase() === "NULL")) {
      return "NULL";
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(source)) return source;
    if (/^(NULL|TRUE|FALSE)$/i.test(source)) return source.toUpperCase();
    return `'${source.replaceAll("'", "''")}'`;
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
      // The builder remains usable when localStorage is unavailable.
    }
  }

  function safeRemove(key) {
    try {
      global.localStorage?.removeItem(key);
    } catch {
      // The builder remains usable when localStorage is unavailable.
    }
  }

  class SqlBlockBuilder {
    constructor(options = {}) {
      this.elements = {
        palette: document.getElementById("blockPalette"),
        workspace: document.getElementById("workspace"),
        workspaceBlocks: document.getElementById("workspaceBlocks"),
        emptyWorkspace: document.getElementById("emptyWorkspace"),
        blockCount: document.getElementById("blockCount"),
        preview: document.getElementById("blockSqlPreview"),
        validation: document.getElementById("blockValidationMessage"),
        clear: document.getElementById("clearBlocksButton"),
        copy: document.getElementById("copyBlockSqlButton"),
        send: document.getElementById("sendBlockToEditorButton"),
        run: document.getElementById("runBlockButton"),
      };
      this.onRun = options.onRun || (() => {});
      this.onSendToEditor = options.onSendToEditor || (() => {});
      this.onToast = options.onToast || (() => {});
      this.blocks = [];
      this.schema = [];
      this.databaseName = "";
      this.draggingId = null;
      this.suppressClickUntil = 0;
      this.pointerDrag = null;
      this.initialized = false;
    }

    init() {
      if (this.initialized) return;
      this.initialized = true;
      this.renderPalette();
      this.bindEvents();
      this.render();
    }

    setDatabase(databaseName, schema) {
      if (this.databaseName) this.save();
      this.databaseName = databaseName || "default";
      this.schema = Array.isArray(schema) ? schema : [];
      this.blocks = this.restore();
      this.normalizeForSchema();
      this.render();
    }

    renameDatabase(oldName, newName) {
      if (!oldName || !newName || oldName === newName) return;
      if (this.databaseName === oldName) this.save();
      const saved = safeGet(`${STORAGE_PREFIX}${oldName}`);
      if (saved !== null) {
        safeSet(`${STORAGE_PREFIX}${newName}`, saved);
        safeRemove(`${STORAGE_PREFIX}${oldName}`);
      }
      if (this.databaseName === oldName) this.databaseName = newName;
    }

    updateSchema(schema) {
      this.schema = Array.isArray(schema) ? schema : [];
      this.normalizeForSchema();
      this.render();
    }

    getSelectableObjects() {
      return this.schema.filter((item) => item.type === "table" || item.type === "view");
    }

    getCurrentObject() {
      const from = this.blocks.find((block) => block.type === "from");
      const objects = this.getSelectableObjects();
      return objects.find((item) => item.name === from?.values?.table) || objects[0] || null;
    }

    getColumns() {
      return this.getCurrentObject()?.columns?.map((column) => column.name) || [];
    }

    defaultValues(type) {
      const object = this.getCurrentObject();
      const firstColumn = object?.columns?.[0]?.name || "";
      const defaults = {
        select: { columns: ["*"], distinct: false },
        from: { table: object?.name || "" },
        where: { column: firstColumn, operator: "=", value: "" },
        and: { column: firstColumn, operator: "=", value: "" },
        or: { column: firstColumn, operator: "=", value: "" },
        order: { column: firstColumn, direction: "ASC" },
        limit: { count: "10" },
      };
      return { ...defaults[type] };
    }

    renderPalette() {
      this.elements.palette.innerHTML = Object.entries(BLOCKS)
        .map(([type, block]) => `
          <button
            class="palette-block ${block.className}"
            type="button"
            draggable="true"
            data-palette-type="${type}"
            aria-label="Thêm khối ${block.keyword}: ${block.help}"
          >
            <strong>${block.keyword}</strong>
            <small>${block.help}</small>
            <span class="palette-drag-icon" aria-hidden="true">⠿</span>
          </button>
        `)
        .join("");
    }

    bindEvents() {
      this.elements.palette.addEventListener("click", (event) => {
        const button = event.target.closest("[data-palette-type]");
        if (!button) return;
        if (Date.now() < this.suppressClickUntil) {
          event.preventDefault();
          return;
        }
        this.addBlock(button.dataset.paletteType);
      });

      this.elements.palette.addEventListener("dragstart", (event) => {
        const button = event.target.closest("[data-palette-type]");
        if (!button || !event.dataTransfer) return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-sql-block-type", button.dataset.paletteType);
        event.dataTransfer.setData("text/plain", button.dataset.paletteType);
        button.classList.add("is-dragging");
      });

      this.elements.palette.addEventListener("dragend", (event) => {
        event.target.closest("[data-palette-type]")?.classList.remove("is-dragging");
        this.clearDropState();
      });

      this.elements.workspaceBlocks.addEventListener("click", (event) => {
        const article = event.target.closest("[data-block-id]");
        if (!article) return;
        if (event.target.closest("[data-action='delete']")) this.removeBlock(article.dataset.blockId);
      });

      this.elements.workspaceBlocks.addEventListener("change", (event) => {
        const control = event.target.closest("[data-field]");
        const article = event.target.closest("[data-block-id]");
        if (control && article) this.updateValue(article.dataset.blockId, control);
      });

      this.elements.workspaceBlocks.addEventListener("input", (event) => {
        const control = event.target.closest("input[data-field]:not([type='checkbox'])");
        const article = event.target.closest("[data-block-id]");
        if (control && article) this.updateValue(article.dataset.blockId, control, false);
      });

      this.elements.workspaceBlocks.addEventListener("dragstart", (event) => {
        const handle = event.target.closest(".block-handle");
        const article = event.target.closest("[data-block-id]");
        if (!handle || !article || !event.dataTransfer) return;
        this.draggingId = article.dataset.blockId;
        article.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-sql-workspace-block", this.draggingId);
        event.dataTransfer.setData("text/plain", this.draggingId);
      });

      this.elements.workspaceBlocks.addEventListener("dragend", () => {
        this.draggingId = null;
        this.clearDropState();
      });

      this.elements.workspace.addEventListener("dragenter", (event) => {
        event.preventDefault();
        this.elements.workspace.classList.add("is-drag-over");
      });

      this.elements.workspace.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = this.draggingId ? "move" : "copy";
        this.showDropMarker(this.getDropIndex(event.clientY));
      });

      this.elements.workspace.addEventListener("dragleave", (event) => {
        if (!this.elements.workspace.contains(event.relatedTarget)) this.clearDropState();
      });

      this.elements.workspace.addEventListener("drop", (event) => {
        event.preventDefault();
        const plain = event.dataTransfer?.getData("text/plain") || "";
        const type = event.dataTransfer?.getData("application/x-sql-block-type") || (BLOCKS[plain] ? plain : "");
        const id = event.dataTransfer?.getData("application/x-sql-workspace-block")
          || this.draggingId
          || (!BLOCKS[plain] ? plain : "");
        const index = this.getDropIndex(event.clientY);
        this.clearDropState();
        if (type) this.addBlock(type, index);
        else if (id) this.moveBlock(id, index);
      });

      this.elements.clear.addEventListener("click", () => {
        if (!this.blocks.length) return;
        this.blocks = [];
        this.save();
        this.render();
      });

      this.elements.copy.addEventListener("click", async () => {
        const state = this.buildSql();
        if (!state.sql) return this.onToast("Chưa có SQL để sao chép.", "error");
        try {
          await navigator.clipboard.writeText(state.sql);
          this.onToast("Đã sao chép câu lệnh SQL.", "success");
        } catch {
          this.onToast("Trình duyệt không cho phép sao chép tự động.", "error");
        }
      });

      this.elements.send.addEventListener("click", () => {
        const state = this.buildSql();
        if (state.valid) this.onSendToEditor(state.sql);
      });

      this.elements.run.addEventListener("click", () => {
        const state = this.buildSql();
        if (state.valid) this.onRun(state.sql);
      });

      this.bindPointerDrag(this.elements.palette, "[data-palette-type]", (element) => ({
        type: "palette",
        value: element.dataset.paletteType,
      }));
      this.bindPointerDrag(this.elements.workspaceBlocks, ".block-handle", (element) => ({
        type: "workspace",
        value: element.closest("[data-block-id]")?.dataset.blockId,
      }));
    }

    bindPointerDrag(container, selector, getPayload) {
      container.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" || event.button !== 0) return;
        const target = event.target.closest(selector);
        if (!target) return;
        const payload = getPayload(target);
        if (!payload.value) return;
        const source = payload.type === "workspace" ? target.closest("[data-block-id]") : target;
        this.pointerDrag = {
          ...payload,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          active: false,
          source,
          ghost: null,
        };
        target.setPointerCapture?.(event.pointerId);
      });

      container.addEventListener("pointermove", (event) => this.onPointerMove(event));
      container.addEventListener("pointerup", (event) => this.onPointerEnd(event));
      container.addEventListener("pointercancel", (event) => this.onPointerEnd(event, true));
    }

    onPointerMove(event) {
      const drag = this.pointerDrag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      const distance = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
      if (!drag.active && distance < 7) return;

      event.preventDefault();
      if (!drag.active) {
        drag.active = true;
        this.suppressClickUntil = Date.now() + 450;
        drag.source?.classList.add("is-dragging");
        drag.ghost = drag.source?.cloneNode(true);
        if (drag.ghost) {
          drag.ghost.classList.add("touch-drag-ghost");
          drag.ghost.removeAttribute("id");
          document.body.appendChild(drag.ghost);
        }
      }
      if (drag.ghost) {
        drag.ghost.style.transform = `translate3d(${drag.x + 14}px, ${drag.y + 14}px, 0)`;
      }
      const overWorkspace = this.pointInsideWorkspace(drag.x, drag.y);
      this.elements.workspace.classList.toggle("is-drag-over", overWorkspace);
      if (overWorkspace) this.showDropMarker(this.getDropIndex(drag.y));
      else this.removeDropMarker();
    }

    onPointerEnd(event, cancelled = false) {
      const drag = this.pointerDrag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.active && !cancelled && this.pointInsideWorkspace(drag.x, drag.y)) {
        const index = this.getDropIndex(drag.y);
        if (drag.type === "palette") this.addBlock(drag.value, index);
        else this.moveBlock(drag.value, index);
      }
      drag.source?.classList.remove("is-dragging");
      drag.ghost?.remove();
      this.pointerDrag = null;
      this.clearDropState();
    }

    pointInsideWorkspace(x, y) {
      const rect = this.elements.workspace.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    getDropIndex(clientY) {
      const articles = [...this.elements.workspaceBlocks.querySelectorAll("[data-block-id]:not(.is-dragging)")];
      for (let index = 0; index < articles.length; index += 1) {
        const rect = articles[index].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return index;
      }
      return articles.length;
    }

    showDropMarker(index) {
      this.removeDropMarker();
      const marker = document.createElement("div");
      marker.className = "block-drop-marker";
      marker.dataset.dropMarker = "true";
      const children = this.elements.workspaceBlocks.querySelectorAll("[data-block-id]:not(.is-dragging)");
      if (children[index]) this.elements.workspaceBlocks.insertBefore(marker, children[index]);
      else this.elements.workspaceBlocks.appendChild(marker);
    }

    removeDropMarker() {
      this.elements.workspaceBlocks.querySelector("[data-drop-marker]")?.remove();
    }

    clearDropState() {
      this.elements.workspace.classList.remove("is-drag-over");
      this.elements.workspaceBlocks.querySelectorAll(".is-dragging").forEach((item) => item.classList.remove("is-dragging"));
      this.removeDropMarker();
    }

    addBlock(type, index = this.blocks.length) {
      const definition = BLOCKS[type];
      if (!definition) return;
      if (definition.singleton && this.blocks.some((block) => block.type === type)) {
        this.onToast(`Mỗi truy vấn chỉ dùng một khối ${definition.keyword}.`, "error");
        return;
      }
      if (["and", "or"].includes(type) && !this.blocks.some((block) => block.type === "where")) {
        this.onToast(`Hãy thêm WHERE trước khi dùng ${definition.keyword}.`, "error");
        return;
      }
      const block = { id: createId(), type, values: this.defaultValues(type) };
      this.blocks.splice(Math.max(0, Math.min(index, this.blocks.length)), 0, block);
      this.save();
      this.render();
    }

    removeBlock(id) {
      const removed = this.blocks.find((block) => block.id === id);
      this.blocks = this.blocks.filter((block) => block.id !== id);
      if (removed?.type === "where") {
        this.blocks = this.blocks.filter((block) => !["and", "or"].includes(block.type));
      }
      this.save();
      this.render();
    }

    moveBlock(id, targetIndex) {
      const currentIndex = this.blocks.findIndex((block) => block.id === id);
      if (currentIndex < 0) return;
      const [block] = this.blocks.splice(currentIndex, 1);
      this.blocks.splice(Math.max(0, Math.min(targetIndex, this.blocks.length)), 0, block);
      this.save();
      this.render();
    }

    updateValue(id, control, shouldRender = true) {
      const block = this.blocks.find((item) => item.id === id);
      if (!block) return;
      const field = control.dataset.field;

      if (field === "columns") {
        const picker = control.closest(".column-picker");
        let selected = [...picker.querySelectorAll("input:checked")].map((input) => input.value);
        if (control.value === "*" && control.checked) selected = ["*"];
        else if (control.value !== "*" && control.checked) selected = selected.filter((item) => item !== "*");
        if (!selected.length) selected = ["*"];
        block.values.columns = selected;
        shouldRender = true;
      } else if (field === "distinct") {
        block.values.distinct = control.checked;
      } else {
        block.values[field] = control.value;
      }

      if (block.type === "from" && field === "table") {
        this.normalizeForSchema();
        shouldRender = true;
      }
      this.save();
      if (shouldRender) this.render();
      else this.renderSqlState();
    }

    normalizeForSchema() {
      const objects = this.getSelectableObjects();
      const names = new Set(objects.map((item) => item.name));
      const from = this.blocks.find((block) => block.type === "from");
      if (from && !names.has(from.values.table)) from.values.table = objects[0]?.name || "";

      const columns = this.getColumns();
      const columnSet = new Set(columns);
      this.blocks.forEach((block) => {
        if (block.type === "select") {
          const valid = (block.values.columns || []).filter((column) => column === "*" || columnSet.has(column));
          block.values.columns = valid.length ? valid : ["*"];
          block.values.distinct = Boolean(block.values.distinct);
        }
        if (["where", "and", "or", "order"].includes(block.type) && !columnSet.has(block.values.column)) {
          block.values.column = columns[0] || "";
        }
      });
      this.save();
    }

    render() {
      this.elements.emptyWorkspace.hidden = this.blocks.length > 0;
      this.elements.blockCount.textContent = `${this.blocks.length} khối`;
      this.elements.workspaceBlocks.innerHTML = this.blocks.map((block) => this.renderBlock(block)).join("");
      this.renderSqlState();
    }

    renderBlock(block) {
      const definition = BLOCKS[block.type];
      const object = this.getCurrentObject();
      const columns = this.getColumns();
      let controls = "";

      if (block.type === "select") {
        const choices = ["*", ...columns];
        controls = `
          <label class="block-check distinct-check">
            <input type="checkbox" data-field="distinct" ${block.values.distinct ? "checked" : ""} />
            <span>DISTINCT</span>
          </label>
          <div class="column-picker" aria-label="Chọn các cột">
            ${choices.map((column) => `
              <label class="column-chip">
                <input type="checkbox" data-field="columns" value="${escapeHtml(column)}"
                  ${(block.values.columns || []).includes(column) ? "checked" : ""} />
                <span>${escapeHtml(column)}</span>
              </label>
            `).join("") || '<span class="empty-control">Chưa có cột</span>'}
          </div>`;
      }

      if (block.type === "from") {
        controls = this.createSelect(
          "table",
          this.getSelectableObjects().map((item) => ({ value: item.name, label: `${item.name} · ${item.type}` })),
          block.values.table,
          "Chọn bảng hoặc view",
        );
      }

      if (["where", "and", "or"].includes(block.type)) {
        controls = [
          this.createSelect("column", columns.map((column) => ({ value: column, label: column })), block.values.column, "Chọn cột"),
          this.createSelect("operator", OPERATORS.map((operator) => ({ value: operator, label: operator })), block.values.operator, "Chọn toán tử"),
          `<input class="block-input" data-field="value" value="${escapeHtml(block.values.value)}" placeholder="Giá trị" aria-label="Giá trị so sánh" />`,
        ].join("");
      }

      if (block.type === "order") {
        controls = [
          this.createSelect("column", columns.map((column) => ({ value: column, label: column })), block.values.column, "Cột sắp xếp"),
          this.createSelect("direction", [
            { value: "ASC", label: "ASC · tăng dần" },
            { value: "DESC", label: "DESC · giảm dần" },
          ], block.values.direction, "Chiều sắp xếp"),
        ].join("");
      }

      if (block.type === "limit") {
        controls = `<input class="block-input limit-input" type="number" min="1" max="10000" step="1" data-field="count" value="${escapeHtml(block.values.count)}" aria-label="Số dòng tối đa" />`;
      }

      return `
        <article class="workspace-block ${definition.className}" data-block-id="${escapeHtml(block.id)}">
          <button class="block-handle" type="button" draggable="true" title="Kéo để đổi vị trí" aria-label="Kéo khối ${definition.keyword}">⠿</button>
          <div class="block-content">
            <div class="block-label-row">
              <span class="block-keyword">${definition.keyword}</span>
              ${block.type === "from" && object ? `<small>${escapeHtml(object.columns?.length || 0)} cột</small>` : ""}
            </div>
            <div class="block-controls">${controls}</div>
          </div>
          <button class="block-delete" type="button" data-action="delete" aria-label="Xóa khối ${definition.keyword}">×</button>
        </article>`;
    }

    createSelect(field, options, selected, label) {
      if (!options.length) return `<select class="block-control" disabled aria-label="${escapeHtml(label)}"><option>Chưa có dữ liệu</option></select>`;
      return `
        <select class="block-control" data-field="${escapeHtml(field)}" aria-label="${escapeHtml(label)}">
          ${options.map((option) => `
            <option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? "selected" : ""}>${escapeHtml(option.label)}</option>
          `).join("")}
        </select>`;
    }

    buildSql() {
      if (!this.blocks.length) return { sql: "", valid: false, message: "Thêm khối để bắt đầu tạo SQL." };
      const select = this.blocks.find((block) => block.type === "select");
      const from = this.blocks.find((block) => block.type === "from");
      if (!select) return { sql: "", valid: false, message: "Truy vấn cần bắt đầu bằng khối SELECT." };
      if (!from) return { sql: "", valid: false, message: "Thêm khối FROM để chọn bảng dữ liệu." };
      if (!from.values.table) return { sql: "", valid: false, message: "Database chưa có table hoặc view. Hãy tạo table trong SQL Editor trước." };

      const order = { select: 1, from: 2, where: 3, and: 3, or: 3, order: 4, limit: 5 };
      for (let index = 1; index < this.blocks.length; index += 1) {
        if (order[this.blocks[index].type] < order[this.blocks[index - 1].type]) {
          return {
            sql: this.composeSql(),
            valid: false,
            message: `Khối ${BLOCKS[this.blocks[index].type].keyword} đang sai vị trí. Thứ tự gợi ý: SELECT → FROM → WHERE → ORDER BY → LIMIT.`,
          };
        }
      }
      if (this.blocks[0].type !== "select") {
        return { sql: this.composeSql(), valid: false, message: "Kéo SELECT lên đầu câu lệnh." };
      }
      const fromIndex = this.blocks.findIndex((block) => block.type === "from");
      if (fromIndex !== 1) return { sql: this.composeSql(), valid: false, message: "FROM cần nằm ngay sau SELECT." };

      const conditions = this.blocks.filter((block) => ["where", "and", "or"].includes(block.type));
      if (conditions.some((block) => !block.values.column)) {
        return { sql: this.composeSql(), valid: false, message: "Một điều kiện chưa có cột để so sánh." };
      }
      const limit = this.blocks.find((block) => block.type === "limit");
      if (limit && (!Number.isInteger(Number(limit.values.count)) || Number(limit.values.count) < 1)) {
        return { sql: this.composeSql(), valid: false, message: "LIMIT phải là số nguyên lớn hơn 0." };
      }

      return { sql: this.composeSql(), valid: true, message: "Câu lệnh hợp lệ và sẵn sàng chạy bằng SQLite." };
    }

    composeSql() {
      const lines = [];
      this.blocks.forEach((block) => {
        if (block.type === "select") {
          const columns = (block.values.columns || ["*"]).map(quoteIdentifier).join(", ");
          lines.push(`SELECT${block.values.distinct ? " DISTINCT" : ""} ${columns || "*"}`);
        }
        if (block.type === "from") lines.push(`FROM ${quoteIdentifier(block.values.table)}`);
        if (["where", "and", "or"].includes(block.type)) {
          lines.push(`${BLOCKS[block.type].keyword} ${quoteIdentifier(block.values.column)} ${block.values.operator} ${formatLiteral(block.values.value, block.values.operator)}`);
        }
        if (block.type === "order") lines.push(`ORDER BY ${quoteIdentifier(block.values.column)} ${block.values.direction}`);
        if (block.type === "limit") lines.push(`LIMIT ${Math.max(1, Math.floor(Number(block.values.count) || 1))}`);
      });
      return lines.length ? `${lines.join("\n")};` : "";
    }

    renderSqlState() {
      const state = this.buildSql();
      if (!state.sql) {
        this.elements.preview.innerHTML = '<code><span class="sql-comment">-- Thêm khối để bắt đầu</span></code>';
      } else {
        const highlighted = escapeHtml(state.sql).replace(SQL_KEYWORDS, '<span class="sql-keyword">$1</span>');
        this.elements.preview.innerHTML = `<code>${highlighted}</code>`;
      }
      this.elements.validation.className = `validation-message ${state.valid ? "valid" : this.blocks.length ? "invalid" : "neutral"}`;
      this.elements.validation.innerHTML = `<span aria-hidden="true">${state.valid ? "✓" : this.blocks.length ? "!" : "○"}</span><p>${escapeHtml(state.message)}</p>`;
      this.elements.run.disabled = !state.valid;
      this.elements.send.disabled = !state.valid;
    }

    save() {
      if (!this.databaseName) return;
      safeSet(`${STORAGE_PREFIX}${this.databaseName}`, JSON.stringify(this.blocks));
    }

    restore() {
      const raw = safeGet(`${STORAGE_PREFIX}${this.databaseName}`);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((block) => BLOCKS[block.type] && block.values && typeof block.values === "object")
          .map((block) => ({ id: block.id || createId(), type: block.type, values: { ...this.defaultValues(block.type), ...block.values } }));
      } catch {
        return [];
      }
    }
  }

  global.SqlBlockBuilder = SqlBlockBuilder;
})(globalThis);
