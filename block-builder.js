"use strict";

(function attachSqlBlockBuilder(global) {
  const STORAGE_PREFIX = "sqlite-scratch-blocks-v4:";
  const QUERY_TYPES = new Set(["select", "from", "join", "where", "and", "or", "order", "limit"]);
  const CONDITION_TYPES = new Set(["where", "and", "or"]);
  const DATA_TYPES = ["INTEGER", "TEXT", "REAL", "NUMERIC", "DECIMAL", "CHAR", "VARCHAR", "DATE", "BOOLEAN", "BLOB"];
  const OPERATORS = ["=", "!=", ">", ">=", "<", "<=", "LIKE", "NOT LIKE", "IS", "IS NOT"];
  const ALTER_ACTIONS = [
    { value: "add-column", label: "ADD COLUMN · thêm cột" },
    { value: "rename-column", label: "RENAME COLUMN · đổi tên cột" },
    { value: "drop-column", label: "DROP COLUMN · xóa cột" },
    { value: "rename-table", label: "RENAME TO · đổi tên bảng" },
  ];

  const BLOCKS = {
    "create-database": {
      keyword: "CREATE DATABASE",
      help: "Tạo và chuyển sang database mới",
      className: "block-create-database",
      group: "Khởi tạo",
      singleton: true,
    },
    "create-table": {
      keyword: "CREATE TABLE",
      help: "Tạo bảng, trường, kiểu, PK và FK",
      className: "block-create-table",
      group: "Khởi tạo",
    },
    "alter-table": {
      keyword: "ALTER TABLE",
      help: "Thêm, đổi tên hoặc xóa cột",
      className: "block-alter-table",
      group: "Khởi tạo",
    },
    insert: {
      keyword: "INSERT INTO",
      help: "Thêm một dòng dữ liệu",
      className: "block-insert",
      group: "Cập nhật dữ liệu",
    },
    update: {
      keyword: "UPDATE",
      help: "Sửa dữ liệu theo điều kiện",
      className: "block-update",
      group: "Cập nhật dữ liệu",
    },
    delete: {
      keyword: "DELETE FROM",
      help: "Xóa dữ liệu theo điều kiện",
      className: "block-delete-sql",
      group: "Cập nhật dữ liệu",
    },
    select: {
      keyword: "SELECT",
      help: "Chọn cột cần xem",
      className: "block-select",
      group: "Truy vấn",
      singleton: true,
    },
    from: {
      keyword: "FROM",
      help: "Chọn bảng hoặc view",
      className: "block-from",
      group: "Truy vấn",
      singleton: true,
    },
    join: {
      keyword: "INNER JOIN",
      help: "Ghép hai bảng theo cột liên quan",
      className: "block-join",
      group: "Truy vấn",
    },
    where: {
      keyword: "WHERE",
      help: "Bắt đầu điều kiện lọc",
      className: "block-where",
      group: "Truy vấn",
      singleton: true,
    },
    and: {
      keyword: "AND",
      help: "Thêm điều kiện bắt buộc",
      className: "block-and",
      group: "Truy vấn",
    },
    or: {
      keyword: "OR",
      help: "Thêm điều kiện lựa chọn",
      className: "block-or",
      group: "Truy vấn",
    },
    order: {
      keyword: "ORDER BY",
      help: "Sắp xếp kết quả",
      className: "block-order",
      group: "Truy vấn",
      singleton: true,
    },
    limit: {
      keyword: "LIMIT",
      help: "Giới hạn số dòng",
      className: "block-limit",
      group: "Truy vấn",
      singleton: true,
    },
  };

  const SQL_KEYWORDS = /\b(CREATE\s+DATABASE|CREATE\s+TABLE|ALTER\s+TABLE|ADD\s+COLUMN|RENAME\s+COLUMN|RENAME\s+TO|DROP\s+COLUMN|PRIMARY\s+KEY|FOREIGN\s+KEY|REFERENCES|INSERT\s+INTO|VALUES|UPDATE|SET|DELETE\s+FROM|SELECT|DISTINCT|FROM|INNER\s+JOIN|ON|WHERE|AND|OR|ORDER\s+BY|ASC|DESC|LIMIT|IF\s+NOT\s+EXISTS|NOT\s+NULL|LIKE|NOT\s+LIKE|IS\s+NOT|IS|NULL|TRUE|FALSE)\b/gi;

  function createId(prefix = "block") {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    const value = String(identifier || "").trim();
    if (value === "*") return "*";
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return value;
    return `"${value.replaceAll('"', '""')}"`;
  }

  function quoteQualifiedIdentifier(identifier) {
    const value = String(identifier || "").trim();
    if (value === "*") return "*";
    return value.split(".").map(quoteIdentifier).join(".");
  }

  function formatLiteral(value, operator) {
    const source = String(value ?? "").trim();
    const normalizedOperator = String(operator || "").toUpperCase();
    if (["IS", "IS NOT"].includes(normalizedOperator) && (!source || source.toUpperCase() === "NULL")) return "NULL";
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(source)) return source;
    if (/^(NULL|TRUE|FALSE|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP)$/i.test(source)) return source.toUpperCase();
    if (/^'(?:''|[^'])*'$/.test(source)) return source;
    return `'${source.replaceAll("'", "''")}'`;
  }

  function normalizeLength(value) {
    const source = String(value || "").trim();
    return /^\d+(?:\s*,\s*\d+)?$/.test(source) ? source.replace(/\s+/g, "") : "";
  }

  function columnTypeSql(column) {
    const type = DATA_TYPES.includes(String(column?.type || "").toUpperCase())
      ? String(column.type).toUpperCase()
      : "TEXT";
    const length = normalizeLength(column?.length);
    return `${type}${length ? `(${length})` : ""}`;
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

  function cloneBlocks(blocks) {
    return JSON.parse(JSON.stringify(blocks || []));
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

    setDatabase(databaseName, schema, options = {}) {
      const carriedBlocks = options.preserveBlocks ? cloneBlocks(this.blocks) : null;
      if (this.databaseName) this.save();
      this.databaseName = databaseName || "default";
      this.schema = Array.isArray(schema) ? schema : [];
      this.blocks = carriedBlocks || this.restore();
      this.normalizeForSchema();
      this.save();
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

    getSchemaObjects() {
      const createDatabase = this.blocks.find((block) => block.type === "create-database");
      const targetName = String(createDatabase?.values?.name || "").trim().toLocaleLowerCase("vi");
      if (targetName && targetName !== String(this.databaseName || "").trim().toLocaleLowerCase("vi")) return [];
      return this.schema.filter((item) => item.type === "table" || item.type === "view");
    }

    getVirtualTables() {
      return this.blocks
        .filter((block) => block.type === "create-table" && block.values?.tableName)
        .map((block) => ({
          type: "table",
          virtual: true,
          name: block.values.tableName,
          columns: (block.values.columns || []).filter((column) => column.name).map((column) => ({
            name: column.name,
            type: columnTypeSql(column),
            notNull: Boolean(column.notNull),
            primaryKey: Boolean(column.primaryKey),
          })),
        }));
    }

    getSelectableObjects() {
      const objects = this.getSchemaObjects().map((item) => ({
        ...item,
        columns: (item.columns || []).map((column) => ({ ...column })),
      }));
      const known = new Set(objects.map((item) => item.name.toLocaleLowerCase("vi")));
      this.getVirtualTables().forEach((item) => {
        if (!known.has(item.name.toLocaleLowerCase("vi"))) objects.push(item);
      });
      this.blocks.filter((block) => block.type === "alter-table" && block.values?.action === "add-column").forEach((block) => {
        const object = objects.find((item) => item.type === "table" && item.name === block.values.table);
        const columnName = String(block.values.column || "").trim();
        if (!object || !columnName || object.columns.some((column) => column.name === columnName)) return;
        object.columns.push({
          name: columnName,
          type: columnTypeSql(block.values),
          notNull: Boolean(block.values.notNull),
          primaryKey: false,
          projected: true,
        });
      });
      return objects;
    }

    getObject(tableName) {
      return this.getSelectableObjects().find((item) => item.name === tableName) || null;
    }

    getTableNames() {
      return this.getSelectableObjects().map((item) => item.name);
    }

    getPhysicalTableNames() {
      return this.getSelectableObjects().filter((item) => item.type === "table").map((item) => item.name);
    }

    getColumnsForTable(tableName) {
      return this.getObject(tableName)?.columns?.map((column) => column.name) || [];
    }

    getFromBlock() {
      return this.blocks.find((block) => block.type === "from") || null;
    }

    getQueryTables(upToBlockId = null) {
      const tables = [];
      const from = this.getFromBlock();
      if (from?.values?.table) tables.push(from.values.table);
      for (const block of this.blocks) {
        if (block.id === upToBlockId) break;
        if (block.type === "join" && block.values?.table && !tables.includes(block.values.table)) tables.push(block.values.table);
      }
      return tables;
    }

    getColumnChoices() {
      const tables = this.getQueryTables();
      if (!tables.length) return [];
      const qualify = tables.length > 1;
      return tables.flatMap((table) => this.getColumnsForTable(table).map((column) => qualify ? `${table}.${column}` : column));
    }

    createColumn(values = {}) {
      return {
        id: values.id || createId("column"),
        name: values.name ?? "id",
        type: values.type || "INTEGER",
        length: values.length || "",
        notNull: values.notNull !== false,
        primaryKey: Boolean(values.primaryKey ?? true),
        foreignKey: Boolean(values.foreignKey),
        refTable: values.refTable || "",
        refColumn: values.refColumn || "",
      };
    }

    createValueField(values = {}) {
      return {
        id: values.id || createId("value"),
        column: values.column || "",
        value: values.value ?? "",
      };
    }

    defaultValues(type) {
      const firstObject = this.getSelectableObjects()[0] || null;
      const firstTable = this.getSelectableObjects().find((item) => item.type === "table") || null;
      const table = firstObject?.name || "";
      const firstColumn = firstObject?.columns?.[0]?.name || "";
      const mutableTable = firstTable?.name || "";
      const mutableColumn = firstTable?.columns?.[0]?.name || "";
      const defaults = {
        "create-database": { name: "QuanLyHocSinh", ifNotExists: false },
        "create-table": {
          tableName: this.uniqueVirtualTableName("BangMoi"),
          ifNotExists: false,
          columns: [this.createColumn()],
        },
        "alter-table": {
          table: mutableTable,
          action: "add-column",
          column: "GhiChu",
          type: "TEXT",
          length: "",
          notNull: false,
          oldColumn: mutableColumn,
          newColumn: "TenMoi",
          newTable: mutableTable ? `${mutableTable}_moi` : "BangMoi",
        },
        insert: {
          table: mutableTable,
          fields: [this.createValueField({ column: mutableColumn })],
        },
        update: { table: mutableTable, setColumn: mutableColumn, setValue: "", whereColumn: mutableColumn, operator: "=", whereValue: "" },
        delete: { table: mutableTable, whereColumn: mutableColumn, operator: "=", whereValue: "" },
        select: { columns: ["*"], distinct: false },
        from: { table },
        join: { table: "", leftTable: table, leftColumn: firstColumn, rightColumn: "" },
        where: { column: firstColumn, operator: "=", value: "" },
        and: { column: firstColumn, operator: "=", value: "" },
        or: { column: firstColumn, operator: "=", value: "" },
        order: { column: firstColumn, direction: "ASC" },
        limit: { count: "10" },
      };
      return cloneBlocks(defaults[type] || {});
    }

    uniqueVirtualTableName(baseName) {
      const names = new Set(this.getTableNames().map((name) => name.toLocaleLowerCase("vi")));
      if (!names.has(baseName.toLocaleLowerCase("vi"))) return baseName;
      let suffix = 2;
      while (names.has(`${baseName}${suffix}`.toLocaleLowerCase("vi"))) suffix += 1;
      return `${baseName}${suffix}`;
    }

    renderPalette() {
      const groups = [];
      Object.entries(BLOCKS).forEach(([type, definition]) => {
        let group = groups.find((item) => item.name === definition.group);
        if (!group) {
          group = { name: definition.group, blocks: [] };
          groups.push(group);
        }
        group.blocks.push([type, definition]);
      });
      this.elements.palette.innerHTML = groups.map((group) => `
        <section class="palette-group" aria-label="${escapeHtml(group.name)}">
          <h3>${escapeHtml(group.name)}</h3>
          <div class="palette-group-blocks">
            ${group.blocks.map(([type, block]) => `
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
            `).join("")}
          </div>
        </section>
      `).join("");
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
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (!article || !action) return;
        const blockId = article.dataset.blockId;
        if (action === "delete") this.removeBlock(blockId);
        if (action === "add-column") this.addTableColumn(blockId);
        if (action === "remove-column") this.removeTableColumn(blockId, event.target.closest("[data-column-id]")?.dataset.columnId);
        if (action === "add-value") this.addValueField(blockId);
        if (action === "remove-value") this.removeValueField(blockId, event.target.closest("[data-value-id]")?.dataset.valueId);
      });

      this.elements.workspaceBlocks.addEventListener("change", (event) => {
        const article = event.target.closest("[data-block-id]");
        if (!article) return;
        const control = event.target;
        if (control.matches("[data-column-field]")) this.updateColumnValue(article.dataset.blockId, control, true);
        else if (control.matches("[data-value-field]")) this.updateInsertValue(article.dataset.blockId, control, true);
        else if (control.matches("[data-field]")) this.updateValue(article.dataset.blockId, control, true);
      });

      this.elements.workspaceBlocks.addEventListener("input", (event) => {
        const article = event.target.closest("[data-block-id]");
        const control = event.target;
        if (!article || !control.matches("input:not([type='checkbox'])")) return;
        if (control.matches("[data-column-field]")) this.updateColumnValue(article.dataset.blockId, control, false);
        else if (control.matches("[data-value-field]")) this.updateInsertValue(article.dataset.blockId, control, false);
        else if (control.matches("[data-field]")) this.updateValue(article.dataset.blockId, control, false);
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
        const id = event.dataTransfer?.getData("application/x-sql-workspace-block") || this.draggingId || (!BLOCKS[plain] ? plain : "");
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

      this.bindPointerDrag(this.elements.palette, "[data-palette-type]", (element) => ({ type: "palette", value: element.dataset.paletteType }));
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
      if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 7) return;
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
      if (drag.ghost) drag.ghost.style.transform = `translate3d(${drag.x + 14}px, ${drag.y + 14}px, 0)`;
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
        this.onToast(`Chỉ cần một khối ${definition.keyword} trong tệp lệnh.`, "error");
        return;
      }
      if (["and", "or"].includes(type) && !this.blocks.some((block) => block.type === "where")) {
        this.onToast(`Hãy thêm WHERE trước khi dùng ${definition.keyword}.`, "error");
        return;
      }
      if (type === "join" && !this.blocks.some((block) => block.type === "from")) {
        this.onToast("Hãy thêm FROM trước khi dùng INNER JOIN.", "error");
        return;
      }
      const block = { id: createId(), type, values: this.defaultValues(type) };
      this.blocks.splice(Math.max(0, Math.min(index, this.blocks.length)), 0, block);
      this.normalizeForSchema();
      this.save();
      this.render();
    }

    removeBlock(id) {
      const removed = this.blocks.find((block) => block.id === id);
      this.blocks = this.blocks.filter((block) => block.id !== id);
      if (removed?.type === "where") this.blocks = this.blocks.filter((block) => !["and", "or"].includes(block.type));
      if (removed?.type === "from") this.blocks = this.blocks.filter((block) => block.type !== "join");
      this.normalizeForSchema();
      this.save();
      this.render();
    }

    moveBlock(id, targetIndex) {
      const currentIndex = this.blocks.findIndex((block) => block.id === id);
      if (currentIndex < 0) return;
      const [block] = this.blocks.splice(currentIndex, 1);
      this.blocks.splice(Math.max(0, Math.min(targetIndex, this.blocks.length)), 0, block);
      this.normalizeForSchema();
      this.save();
      this.render();
    }

    addTableColumn(blockId) {
      const block = this.blocks.find((item) => item.id === blockId && item.type === "create-table");
      if (!block) return;
      block.values.columns.push(this.createColumn({ name: `cot_${block.values.columns.length + 1}`, type: "TEXT", notNull: false, primaryKey: false }));
      this.save();
      this.render();
    }

    removeTableColumn(blockId, columnId) {
      const block = this.blocks.find((item) => item.id === blockId && item.type === "create-table");
      if (!block || !columnId || block.values.columns.length <= 1) {
        if (block?.values.columns.length <= 1) this.onToast("Bảng cần có ít nhất một cột.", "error");
        return;
      }
      block.values.columns = block.values.columns.filter((column) => column.id !== columnId);
      this.normalizeForSchema();
      this.save();
      this.render();
    }

    addValueField(blockId) {
      const block = this.blocks.find((item) => item.id === blockId && item.type === "insert");
      if (!block) return;
      const used = new Set(block.values.fields.map((field) => field.column));
      const nextColumn = this.getColumnsForTable(block.values.table).find((column) => !used.has(column)) || "";
      block.values.fields.push(this.createValueField({ column: nextColumn }));
      this.save();
      this.render();
    }

    removeValueField(blockId, valueId) {
      const block = this.blocks.find((item) => item.id === blockId && item.type === "insert");
      if (!block || !valueId || block.values.fields.length <= 1) {
        if (block?.values.fields.length <= 1) this.onToast("INSERT cần có ít nhất một cột và giá trị.", "error");
        return;
      }
      block.values.fields = block.values.fields.filter((field) => field.id !== valueId);
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
      } else if (["distinct", "ifNotExists", "notNull"].includes(field)) {
        block.values[field] = control.checked;
      } else {
        block.values[field] = control.value;
      }

      const affectsChoices = ["name", "table", "tableName", "action"].includes(field);
      if (affectsChoices && shouldRender) {
        this.normalizeForSchema();
      }
      this.save();
      if (shouldRender) this.render();
      else this.renderSqlState();
    }

    updateColumnValue(blockId, control, shouldRender = true) {
      const block = this.blocks.find((item) => item.id === blockId && item.type === "create-table");
      const row = control.closest("[data-column-id]");
      const column = block?.values?.columns?.find((item) => item.id === row?.dataset.columnId);
      if (!column) return;
      const field = control.dataset.columnField;
      column[field] = ["notNull", "primaryKey", "foreignKey"].includes(field) ? control.checked : control.value;
      if (field === "foreignKey" && column.foreignKey && !column.refTable) {
        column.refTable = this.getPhysicalTableNames().find((table) => table !== block.values.tableName) || "";
      }
      if (["foreignKey", "refTable"].includes(field) && column.foreignKey) {
        const refColumns = this.getColumnsForTable(column.refTable);
        if (!refColumns.includes(column.refColumn)) column.refColumn = refColumns[0] || "";
      }
      if (shouldRender && ["name", "foreignKey", "refTable"].includes(field)) this.normalizeForSchema();
      this.save();
      if (shouldRender) this.render();
      else this.renderSqlState();
    }

    updateInsertValue(blockId, control, shouldRender = true) {
      const block = this.blocks.find((item) => item.id === blockId && item.type === "insert");
      const row = control.closest("[data-value-id]");
      const field = block?.values?.fields?.find((item) => item.id === row?.dataset.valueId);
      if (!field) return;
      field[control.dataset.valueField] = control.value;
      this.save();
      if (shouldRender) this.render();
      else this.renderSqlState();
    }

    normalizeForSchema() {
      const tableNames = this.getTableNames();
      const tableSet = new Set(tableNames);
      const physicalTableNames = this.getPhysicalTableNames();
      const physicalTableSet = new Set(physicalTableNames);
      this.blocks.forEach((block) => {
        if (block.type === "from") {
          if (!tableSet.has(block.values.table)) block.values.table = tableNames[0] || "";
        }
        if (["alter-table", "insert", "update", "delete"].includes(block.type)) {
          if (!physicalTableSet.has(block.values.table)) block.values.table = physicalTableNames[0] || "";
        }

        if (block.type === "create-table") {
          block.values.columns = (block.values.columns || []).map((column, index) => this.createColumn({
            ...column,
            primaryKey: Boolean(column.primaryKey ?? index === 0),
            notNull: Boolean(column.notNull ?? index === 0),
          }));
          block.values.columns.forEach((column) => {
            if (!column.foreignKey) return;
            const referenceTables = physicalTableNames.filter((table) => table !== block.values.tableName);
            if (!referenceTables.includes(column.refTable)) column.refTable = referenceTables[0] || "";
            const referenceColumns = this.getColumnsForTable(column.refTable);
            if (!referenceColumns.includes(column.refColumn)) column.refColumn = referenceColumns[0] || "";
          });
        }

        if (block.type === "insert") {
          const columns = this.getColumnsForTable(block.values.table);
          block.values.fields = (block.values.fields || []).map((field) => this.createValueField(field));
          if (!block.values.fields.length) block.values.fields = [this.createValueField({ column: columns[0] || "" })];
          block.values.fields.forEach((field) => {
            if (!columns.includes(field.column)) field.column = columns[0] || "";
          });
        }

        if (["update", "delete", "alter-table"].includes(block.type)) {
          const columns = this.getColumnsForTable(block.values.table);
          ["setColumn", "whereColumn", "oldColumn"].forEach((field) => {
            if (field in block.values && !columns.includes(block.values[field])) block.values[field] = columns[0] || "";
          });
        }
      });

      this.blocks.filter((block) => block.type === "join").forEach((block) => {
        const availableLeftTables = this.getQueryTables(block.id);
        if (!availableLeftTables.includes(block.values.leftTable)) block.values.leftTable = availableLeftTables[0] || "";
        const candidates = tableNames.filter((table) => !availableLeftTables.includes(table));
        if (!candidates.includes(block.values.table)) block.values.table = candidates[0] || "";
        const leftColumns = this.getColumnsForTable(block.values.leftTable);
        const rightColumns = this.getColumnsForTable(block.values.table);
        if (!leftColumns.includes(block.values.leftColumn)) block.values.leftColumn = leftColumns[0] || "";
        if (!rightColumns.includes(block.values.rightColumn)) {
          block.values.rightColumn = rightColumns.find((column) => column === block.values.leftColumn) || rightColumns[0] || "";
        }
      });

      const queryTables = this.getQueryTables();
      const queryColumns = this.getColumnChoices();
      const queryColumnSet = new Set(queryColumns);
      this.blocks.forEach((block) => {
        if (block.type === "select") {
          const valid = (block.values.columns || []).map((column) => {
            if (column === "*" || queryColumnSet.has(column)) return column;
            const qualified = queryTables.map((table) => `${table}.${column}`).find((candidate) => queryColumnSet.has(candidate));
            return qualified || "";
          }).filter(Boolean);
          block.values.columns = valid.length ? valid : ["*"];
          block.values.distinct = Boolean(block.values.distinct);
        }
        if (CONDITION_TYPES.has(block.type) || block.type === "order") {
          if (!queryColumnSet.has(block.values.column)) {
            const qualified = queryTables.map((table) => `${table}.${block.values.column}`).find((candidate) => queryColumnSet.has(candidate));
            block.values.column = qualified || queryColumns[0] || "";
          }
        }
      });
    }

    render() {
      this.elements.emptyWorkspace.hidden = this.blocks.length > 0;
      this.elements.blockCount.textContent = `${this.blocks.length} khối`;
      this.elements.workspaceBlocks.innerHTML = this.blocks.map((block) => this.renderBlock(block)).join("");
      this.renderSqlState();
    }

    renderBlock(block) {
      const definition = BLOCKS[block.type];
      const controls = this.renderControls(block);
      return `
        <article class="workspace-block ${definition.className} ${["create-table", "insert"].includes(block.type) ? "workspace-block-wide" : ""}" data-block-id="${escapeHtml(block.id)}">
          <button class="block-handle" type="button" draggable="true" title="Kéo để đổi vị trí" aria-label="Kéo khối ${definition.keyword}">⠿</button>
          <div class="block-content">
            <div class="block-label-row">
              <span class="block-keyword">${definition.keyword}</span>
              <small>${escapeHtml(definition.help)}</small>
            </div>
            <div class="block-controls ${["create-table", "insert"].includes(block.type) ? "block-controls-stack" : ""}">${controls}</div>
          </div>
          <button class="block-delete" type="button" data-action="delete" aria-label="Xóa khối ${definition.keyword}">×</button>
        </article>`;
    }

    renderControls(block) {
      const values = block.values;
      const tableOptions = this.getSelectableObjects().map((item) => ({
        value: item.name,
        label: `${item.name}${item.type === "view" ? " · view" : item.virtual ? " · sắp tạo" : ""}`,
      }));

      if (block.type === "create-database") {
        return `
          <input class="block-input block-name-input" data-field="name" value="${escapeHtml(values.name)}" placeholder="Tên database" aria-label="Tên database" />
          ${this.createCheck("ifNotExists", "IF NOT EXISTS", values.ifNotExists)}`;
      }

      if (block.type === "create-table") return this.renderCreateTableControls(block);

      if (block.type === "alter-table") {
        const columns = this.getColumnsForTable(values.table);
        let actionControls = "";
        if (values.action === "add-column") {
          actionControls = `
            <input class="block-input" data-field="column" value="${escapeHtml(values.column)}" placeholder="Tên cột mới" aria-label="Tên cột mới" />
            ${this.createSelect("type", DATA_TYPES.map((type) => ({ value: type, label: type })), values.type, "Kiểu dữ liệu")}
            <input class="block-input length-input" data-field="length" value="${escapeHtml(values.length)}" placeholder="Độ dài" aria-label="Độ dài kiểu dữ liệu" />
            ${this.createCheck("notNull", "NOT NULL", values.notNull)}`;
        }
        if (values.action === "rename-column") {
          actionControls = `${this.createSelect("oldColumn", columns.map((column) => ({ value: column, label: column })), values.oldColumn, "Cột hiện tại")}
            <span class="block-arrow">→</span><input class="block-input" data-field="newColumn" value="${escapeHtml(values.newColumn)}" placeholder="Tên cột mới" aria-label="Tên cột mới" />`;
        }
        if (values.action === "drop-column") {
          actionControls = this.createSelect("oldColumn", columns.map((column) => ({ value: column, label: column })), values.oldColumn, "Cột cần xóa");
        }
        if (values.action === "rename-table") {
          actionControls = `<input class="block-input" data-field="newTable" value="${escapeHtml(values.newTable)}" placeholder="Tên bảng mới" aria-label="Tên bảng mới" />`;
        }
        return `${this.createSelect("table", tableOptions.filter((item) => this.getObject(item.value)?.type === "table"), values.table, "Bảng cần sửa")}
          ${this.createSelect("action", ALTER_ACTIONS, values.action, "Thao tác ALTER TABLE")}${actionControls}`;
      }

      if (block.type === "insert") return this.renderInsertControls(block, tableOptions);

      if (block.type === "update") {
        const columns = this.getColumnsForTable(values.table);
        const columnOptions = columns.map((column) => ({ value: column, label: column }));
        return `${this.createSelect("table", tableOptions.filter((item) => this.getObject(item.value)?.type === "table"), values.table, "Bảng cần sửa")}
          <span class="inline-keyword">SET</span>${this.createSelect("setColumn", columnOptions, values.setColumn, "Cột cần sửa")}
          <input class="block-input" data-field="setValue" value="${escapeHtml(values.setValue)}" placeholder="Giá trị mới" aria-label="Giá trị mới" />
          <span class="inline-keyword">WHERE</span>${this.createSelect("whereColumn", columnOptions, values.whereColumn, "Cột điều kiện")}
          ${this.createSelect("operator", OPERATORS.map((operator) => ({ value: operator, label: operator })), values.operator, "Toán tử")}
          <input class="block-input" data-field="whereValue" value="${escapeHtml(values.whereValue)}" placeholder="Giá trị lọc" aria-label="Giá trị điều kiện" />`;
      }

      if (block.type === "delete") {
        const columns = this.getColumnsForTable(values.table);
        const columnOptions = columns.map((column) => ({ value: column, label: column }));
        return `${this.createSelect("table", tableOptions.filter((item) => this.getObject(item.value)?.type === "table"), values.table, "Bảng cần xóa dữ liệu")}
          <span class="inline-keyword">WHERE</span>${this.createSelect("whereColumn", columnOptions, values.whereColumn, "Cột điều kiện")}
          ${this.createSelect("operator", OPERATORS.map((operator) => ({ value: operator, label: operator })), values.operator, "Toán tử")}
          <input class="block-input" data-field="whereValue" value="${escapeHtml(values.whereValue)}" placeholder="Giá trị lọc" aria-label="Giá trị điều kiện" />`;
      }

      if (block.type === "select") {
        const choices = ["*", ...this.getColumnChoices()];
        return `
          ${this.createCheck("distinct", "DISTINCT", values.distinct, "distinct-check")}
          <div class="column-picker" aria-label="Chọn các cột">
            ${choices.map((column) => `
              <label class="column-chip">
                <input type="checkbox" data-field="columns" value="${escapeHtml(column)}" ${(values.columns || []).includes(column) ? "checked" : ""} />
                <span>${escapeHtml(column)}</span>
              </label>`).join("") || '<span class="empty-control">Thêm FROM để chọn cột</span>'}
          </div>`;
      }

      if (block.type === "from") return this.createSelect("table", tableOptions, values.table, "Chọn bảng hoặc view");

      if (block.type === "join") {
        const leftTables = this.getQueryTables(block.id);
        const joinTables = tableOptions.filter((item) => !leftTables.includes(item.value));
        const leftColumns = this.getColumnsForTable(values.leftTable);
        const rightColumns = this.getColumnsForTable(values.table);
        return `${this.createSelect("table", joinTables, values.table, "Bảng cần ghép")}
          <span class="inline-keyword">ON</span>
          ${this.createSelect("leftTable", leftTables.map((table) => ({ value: table, label: table })), values.leftTable, "Bảng bên trái")}
          ${this.createSelect("leftColumn", leftColumns.map((column) => ({ value: column, label: column })), values.leftColumn, "Cột bên trái")}
          <span class="block-equals">=</span>
          ${this.createSelect("rightColumn", rightColumns.map((column) => ({ value: column, label: column })), values.rightColumn, "Cột bảng ghép")}`;
      }

      if (CONDITION_TYPES.has(block.type)) {
        const columns = this.getColumnChoices();
        return `${this.createSelect("column", columns.map((column) => ({ value: column, label: column })), values.column, "Chọn cột")}
          ${this.createSelect("operator", OPERATORS.map((operator) => ({ value: operator, label: operator })), values.operator, "Chọn toán tử")}
          <input class="block-input" data-field="value" value="${escapeHtml(values.value)}" placeholder="Giá trị" aria-label="Giá trị so sánh" />`;
      }

      if (block.type === "order") {
        const columns = this.getColumnChoices();
        return `${this.createSelect("column", columns.map((column) => ({ value: column, label: column })), values.column, "Cột sắp xếp")}
          ${this.createSelect("direction", [{ value: "ASC", label: "ASC · tăng dần" }, { value: "DESC", label: "DESC · giảm dần" }], values.direction, "Chiều sắp xếp")}`;
      }

      if (block.type === "limit") {
        return `<input class="block-input limit-input" type="number" min="1" max="10000" step="1" data-field="count" value="${escapeHtml(values.count)}" aria-label="Số dòng tối đa" />`;
      }
      return "";
    }

    renderCreateTableControls(block) {
      const values = block.values;
      const tables = this.getPhysicalTableNames().filter((table) => table !== values.tableName);
      return `
        <div class="block-form-row table-name-row">
          <input class="block-input block-name-input" data-field="tableName" value="${escapeHtml(values.tableName)}" placeholder="Tên bảng" aria-label="Tên bảng" />
          ${this.createCheck("ifNotExists", "IF NOT EXISTS", values.ifNotExists)}
        </div>
        <div class="schema-column-list">
          ${(values.columns || []).map((column, index) => {
            const refColumns = this.getColumnsForTable(column.refTable);
            return `
              <div class="schema-column-row" data-column-id="${escapeHtml(column.id)}">
                <span class="column-number">${index + 1}</span>
                <input class="block-input column-name-input" data-column-field="name" value="${escapeHtml(column.name)}" placeholder="Tên trường" aria-label="Tên trường ${index + 1}" />
                ${this.createNestedSelect("column", "type", DATA_TYPES.map((type) => ({ value: type, label: type })), column.type, "Kiểu dữ liệu")}
                <input class="block-input length-input" data-column-field="length" value="${escapeHtml(column.length)}" placeholder="Độ dài" aria-label="Độ dài kiểu dữ liệu" />
                ${this.createNestedCheck("column", "notNull", "NOT NULL", column.notNull)}
                ${this.createNestedCheck("column", "primaryKey", "PK", column.primaryKey)}
                ${this.createNestedCheck("column", "foreignKey", "FK", column.foreignKey)}
                ${this.createNestedSelect("column", "refTable", tables.map((table) => ({ value: table, label: `↳ ${table}` })), column.refTable, "Bảng tham chiếu", !column.foreignKey)}
                ${this.createNestedSelect("column", "refColumn", refColumns.map((name) => ({ value: name, label: name })), column.refColumn, "Cột tham chiếu", !column.foreignKey)}
                <button class="mini-action mini-action-danger" type="button" data-action="remove-column" title="Xóa trường" aria-label="Xóa trường ${index + 1}">×</button>
              </div>`;
          }).join("")}
        </div>
        <button class="mini-add-button" type="button" data-action="add-column"><span aria-hidden="true">＋</span> Thêm trường</button>`;
    }

    renderInsertControls(block, tableOptions) {
      const values = block.values;
      const columns = this.getColumnsForTable(values.table);
      const columnOptions = columns.map((column) => ({ value: column, label: column }));
      return `
        <div class="block-form-row">
          ${this.createSelect("table", tableOptions.filter((item) => this.getObject(item.value)?.type === "table"), values.table, "Bảng nhận dữ liệu")}
          <span class="inline-note">Mỗi dòng dưới đây là một cột và giá trị</span>
        </div>
        <div class="insert-value-list">
          ${(values.fields || []).map((field, index) => `
            <div class="insert-value-row" data-value-id="${escapeHtml(field.id)}">
              <span class="column-number">${index + 1}</span>
              ${this.createNestedSelect("value", "column", columnOptions, field.column, "Cột nhận dữ liệu")}
              <span class="block-equals">=</span>
              <input class="block-input" data-value-field="value" value="${escapeHtml(field.value)}" placeholder="Giá trị" aria-label="Giá trị cho ${escapeHtml(field.column || `cột ${index + 1}`)}" />
              <button class="mini-action mini-action-danger" type="button" data-action="remove-value" title="Xóa giá trị" aria-label="Xóa giá trị ${index + 1}">×</button>
            </div>`).join("")}
        </div>
        <button class="mini-add-button" type="button" data-action="add-value"><span aria-hidden="true">＋</span> Thêm cột và giá trị</button>`;
    }

    createSelect(field, options, selected, label, disabled = false) {
      const normalized = options || [];
      if (!normalized.length) return `<select class="block-control" ${disabled ? "disabled" : "disabled"} aria-label="${escapeHtml(label)}"><option>Chưa có dữ liệu</option></select>`;
      return `
        <select class="block-control" data-field="${escapeHtml(field)}" aria-label="${escapeHtml(label)}" ${disabled ? "disabled" : ""}>
          ${normalized.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>`;
    }

    createNestedSelect(kind, field, options, selected, label, disabled = false) {
      const attribute = kind === "column" ? "data-column-field" : "data-value-field";
      const normalized = options || [];
      if (!normalized.length) return `<select class="block-control" disabled aria-label="${escapeHtml(label)}"><option>—</option></select>`;
      return `
        <select class="block-control" ${attribute}="${escapeHtml(field)}" aria-label="${escapeHtml(label)}" ${disabled ? "disabled" : ""}>
          ${normalized.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>`;
    }

    createCheck(field, label, checked, extraClass = "") {
      return `<label class="block-check ${extraClass}"><input type="checkbox" data-field="${escapeHtml(field)}" ${checked ? "checked" : ""} /><span>${escapeHtml(label)}</span></label>`;
    }

    createNestedCheck(kind, field, label, checked) {
      const attribute = kind === "column" ? "data-column-field" : "data-value-field";
      return `<label class="block-check"><input type="checkbox" ${attribute}="${escapeHtml(field)}" ${checked ? "checked" : ""} /><span>${escapeHtml(label)}</span></label>`;
    }

    validateStandalone(block) {
      const values = block.values;
      if (block.type === "create-database") {
        if (!String(values.name || "").trim()) return "CREATE DATABASE cần có tên database.";
      }

      if (block.type === "create-table") {
        if (!String(values.tableName || "").trim()) return "CREATE TABLE cần có tên bảng.";
        if (!values.columns?.length) return `Bảng ${values.tableName} cần có ít nhất một trường.`;
        const names = values.columns.map((column) => String(column.name || "").trim());
        if (names.some((name) => !name)) return `Bảng ${values.tableName} có trường chưa được đặt tên.`;
        if (new Set(names.map((name) => name.toLocaleLowerCase("vi"))).size !== names.length) return `Bảng ${values.tableName} đang có tên trường bị trùng.`;
        const badLength = values.columns.find((column) => column.length && !normalizeLength(column.length));
        if (badLength) return `Độ dài kiểu của trường ${badLength.name} phải có dạng 10 hoặc 10,2.`;
        const incompleteForeignKey = values.columns.find((column) => column.foreignKey && (!column.refTable || !column.refColumn));
        if (incompleteForeignKey) return `Khóa ngoài ${incompleteForeignKey.name} cần chọn đủ bảng và trường tham chiếu.`;
      }

      if (block.type === "alter-table") {
        if (!values.table) return "ALTER TABLE cần chọn một bảng.";
        if (values.action === "add-column" && !String(values.column || "").trim()) return "ADD COLUMN cần tên cột mới.";
        if (values.action === "add-column" && values.length && !normalizeLength(values.length)) return "Độ dài kiểu dữ liệu phải có dạng 10 hoặc 10,2.";
        if (["rename-column", "drop-column"].includes(values.action) && !values.oldColumn) return "Hãy chọn cột cần thay đổi.";
        if (values.action === "rename-column" && !String(values.newColumn || "").trim()) return "RENAME COLUMN cần tên cột mới.";
        if (values.action === "rename-table" && !String(values.newTable || "").trim()) return "RENAME TO cần tên bảng mới.";
      }

      if (block.type === "insert") {
        if (!values.table) return "INSERT INTO cần chọn một bảng.";
        if (!values.fields?.length || values.fields.some((field) => !field.column)) return "INSERT cần chọn ít nhất một cột.";
        const names = values.fields.map((field) => field.column);
        if (new Set(names).size !== names.length) return "Mỗi cột trong INSERT chỉ được chọn một lần.";
      }

      if (block.type === "update") {
        if (!values.table || !values.setColumn) return "UPDATE cần chọn bảng và cột cần sửa.";
        if (!values.whereColumn) return "UPDATE cần điều kiện WHERE để tránh sửa toàn bộ bảng.";
      }

      if (block.type === "delete") {
        if (!values.table) return "DELETE FROM cần chọn một bảng.";
        if (!values.whereColumn) return "DELETE cần điều kiện WHERE để tránh xóa toàn bộ bảng.";
      }
      return "";
    }

    validateQuery() {
      const queryBlocks = this.blocks.filter((block) => QUERY_TYPES.has(block.type));
      if (!queryBlocks.length) return "";
      const firstIndex = this.blocks.findIndex((block) => QUERY_TYPES.has(block.type));
      const lastIndex = this.blocks.length - 1 - [...this.blocks].reverse().findIndex((block) => QUERY_TYPES.has(block.type));
      if (this.blocks.slice(firstIndex, lastIndex + 1).some((block) => !QUERY_TYPES.has(block.type))) {
        return "Các khối của một truy vấn phải nằm liền nhau; hãy đưa DDL/DML ra trước hoặc sau truy vấn.";
      }
      if (queryBlocks[0]?.type !== "select") return "Truy vấn cần bắt đầu bằng SELECT.";
      if (queryBlocks[1]?.type !== "from") return "FROM cần nằm ngay sau SELECT.";
      const order = { select: 1, from: 2, join: 3, where: 4, and: 4, or: 4, order: 5, limit: 6 };
      for (let index = 1; index < queryBlocks.length; index += 1) {
        if (order[queryBlocks[index].type] < order[queryBlocks[index - 1].type]) {
          return `Khối ${BLOCKS[queryBlocks[index].type].keyword} đang sai vị trí. Thứ tự: SELECT → FROM → INNER JOIN → WHERE → ORDER BY → LIMIT.`;
        }
      }
      const whereIndex = queryBlocks.findIndex((block) => block.type === "where");
      if (queryBlocks.some((block) => ["and", "or"].includes(block.type)) && whereIndex < 0) return "AND/OR chỉ dùng sau WHERE.";
      if (!queryBlocks.find((block) => block.type === "from")?.values?.table) return "FROM chưa chọn bảng dữ liệu.";
      const badJoin = queryBlocks.find((block) => block.type === "join" && (!block.values.table || !block.values.leftTable || !block.values.leftColumn || !block.values.rightColumn));
      if (badJoin) return "INNER JOIN cần đủ hai bảng và hai cột liên kết.";
      const badCondition = queryBlocks.find((block) => CONDITION_TYPES.has(block.type) && !block.values.column);
      if (badCondition) return "Một điều kiện chưa có cột để so sánh.";
      const limit = queryBlocks.find((block) => block.type === "limit");
      if (limit && (!Number.isInteger(Number(limit.values.count)) || Number(limit.values.count) < 1)) return "LIMIT phải là số nguyên lớn hơn 0.";
      return "";
    }

    buildSql() {
      if (!this.blocks.length) return { sql: "", valid: false, message: "Kéo hoặc bấm một khối để bắt đầu tạo SQL." };
      const createDatabaseIndex = this.blocks.findIndex((block) => block.type === "create-database");
      if (createDatabaseIndex > 0) {
        return { sql: this.composeSql(), valid: false, message: "CREATE DATABASE phải là khối đầu tiên để các lệnh sau chạy trong database mới." };
      }
      for (const block of this.blocks) {
        if (QUERY_TYPES.has(block.type)) continue;
        const message = this.validateStandalone(block);
        if (message) return { sql: this.composeSql(), valid: false, message };
      }
      const queryMessage = this.validateQuery();
      if (queryMessage) return { sql: this.composeSql(), valid: false, message: queryMessage };
      return { sql: this.composeSql(), valid: true, message: "Tệp lệnh hợp lệ và sẵn sàng chạy bằng SQLite." };
    }

    composeStandalone(block) {
      const values = block.values;
      if (block.type === "create-database") {
        return `CREATE DATABASE${values.ifNotExists ? " IF NOT EXISTS" : ""} ${quoteIdentifier(values.name)};`;
      }
      if (block.type === "create-table") {
        const definitions = (values.columns || []).map((column) => {
          const parts = [quoteIdentifier(column.name), columnTypeSql(column)];
          if (column.notNull) parts.push("NOT NULL");
          return `  ${parts.join(" ")}`;
        });
        const primaryColumns = values.columns.filter((column) => column.primaryKey).map((column) => quoteIdentifier(column.name));
        if (primaryColumns.length) definitions.push(`  PRIMARY KEY (${primaryColumns.join(", ")})`);
        values.columns.filter((column) => column.foreignKey).forEach((column) => {
          definitions.push(`  FOREIGN KEY (${quoteIdentifier(column.name)}) REFERENCES ${quoteIdentifier(column.refTable)} (${quoteIdentifier(column.refColumn)})`);
        });
        return `CREATE TABLE${values.ifNotExists ? " IF NOT EXISTS" : ""} ${quoteIdentifier(values.tableName)} (\n${definitions.join(",\n")}\n);`;
      }
      if (block.type === "alter-table") {
        const prefix = `ALTER TABLE ${quoteIdentifier(values.table)}`;
        if (values.action === "add-column") return `${prefix}\nADD COLUMN ${quoteIdentifier(values.column)} ${columnTypeSql(values)}${values.notNull ? " NOT NULL" : ""};`;
        if (values.action === "rename-column") return `${prefix}\nRENAME COLUMN ${quoteIdentifier(values.oldColumn)} TO ${quoteIdentifier(values.newColumn)};`;
        if (values.action === "drop-column") return `${prefix}\nDROP COLUMN ${quoteIdentifier(values.oldColumn)};`;
        return `${prefix}\nRENAME TO ${quoteIdentifier(values.newTable)};`;
      }
      if (block.type === "insert") {
        const columns = values.fields.map((field) => quoteIdentifier(field.column));
        const literals = values.fields.map((field) => formatLiteral(field.value));
        return `INSERT INTO ${quoteIdentifier(values.table)} (${columns.join(", ")})\nVALUES (${literals.join(", ")});`;
      }
      if (block.type === "update") {
        return `UPDATE ${quoteIdentifier(values.table)}\nSET ${quoteIdentifier(values.setColumn)} = ${formatLiteral(values.setValue)}\nWHERE ${quoteIdentifier(values.whereColumn)} ${values.operator} ${formatLiteral(values.whereValue, values.operator)};`;
      }
      if (block.type === "delete") {
        return `DELETE FROM ${quoteIdentifier(values.table)}\nWHERE ${quoteIdentifier(values.whereColumn)} ${values.operator} ${formatLiteral(values.whereValue, values.operator)};`;
      }
      return "";
    }

    composeQuery(blocks) {
      const lines = [];
      blocks.forEach((block) => {
        const values = block.values;
        if (block.type === "select") {
          const columns = (values.columns || ["*"]).map(quoteQualifiedIdentifier).join(", ");
          lines.push(`SELECT${values.distinct ? " DISTINCT" : ""} ${columns || "*"}`);
        }
        if (block.type === "from") lines.push(`FROM ${quoteIdentifier(values.table)}`);
        if (block.type === "join") {
          lines.push(`INNER JOIN ${quoteIdentifier(values.table)} ON ${quoteIdentifier(values.leftTable)}.${quoteIdentifier(values.leftColumn)} = ${quoteIdentifier(values.table)}.${quoteIdentifier(values.rightColumn)}`);
        }
        if (CONDITION_TYPES.has(block.type)) {
          lines.push(`${BLOCKS[block.type].keyword} ${quoteQualifiedIdentifier(values.column)} ${values.operator} ${formatLiteral(values.value, values.operator)}`);
        }
        if (block.type === "order") lines.push(`ORDER BY ${quoteQualifiedIdentifier(values.column)} ${values.direction}`);
        if (block.type === "limit") lines.push(`LIMIT ${Math.max(1, Math.floor(Number(values.count) || 1))}`);
      });
      return lines.length ? `${lines.join("\n")};` : "";
    }

    composeSql() {
      const statements = [];
      let query = [];
      const flushQuery = () => {
        if (!query.length) return;
        statements.push(this.composeQuery(query));
        query = [];
      };
      this.blocks.forEach((block) => {
        if (QUERY_TYPES.has(block.type)) query.push(block);
        else {
          flushQuery();
          const statement = this.composeStandalone(block);
          if (statement) statements.push(statement);
        }
      });
      flushQuery();
      return statements.filter(Boolean).join("\n\n");
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
          .map((block) => {
            const defaults = this.defaultValues(block.type);
            const values = { ...defaults, ...block.values };
            if (block.type === "create-table") values.columns = (block.values.columns || defaults.columns).map((column) => this.createColumn(column));
            if (block.type === "insert") values.fields = (block.values.fields || defaults.fields).map((field) => this.createValueField(field));
            return { id: block.id || createId(), type: block.type, values };
          });
      } catch {
        return [];
      }
    }
  }

  global.SqlBlockBuilder = SqlBlockBuilder;
})(globalThis);
