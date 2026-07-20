"use strict";

const DATABASE = {
  students: {
    label: "Học viên",
    columns: {
      id: "number",
      name: "text",
      city: "text",
      age: "number",
      score: "number",
    },
    rows: [
      { id: 1, name: "An", city: "Hà Nội", age: 19, score: 8.5 },
      { id: 2, name: "Bình", city: "Đà Nẵng", age: 21, score: 7.2 },
      { id: 3, name: "Chi", city: "Hà Nội", age: 20, score: 9.1 },
      { id: 4, name: "Dũng", city: "Huế", age: 22, score: 6.8 },
      { id: 5, name: "Giang", city: "TP.HCM", age: 20, score: 8.0 },
      { id: 6, name: "Hà", city: "Đà Nẵng", age: 18, score: 7.8 },
      { id: 7, name: "Khôi", city: "Cần Thơ", age: 23, score: 9.4 },
      { id: 8, name: "Lan", city: "TP.HCM", age: 19, score: 8.7 },
    ],
  },
  courses: {
    label: "Khóa học",
    columns: {
      id: "number",
      title: "text",
      category: "text",
      fee: "number",
      seats: "number",
    },
    rows: [
      { id: 1, title: "SQL nhập môn", category: "Dữ liệu", fee: 450000, seats: 24 },
      { id: 2, title: "HTML & CSS", category: "Web", fee: 350000, seats: 30 },
      { id: 3, title: "JavaScript cơ bản", category: "Web", fee: 550000, seats: 18 },
      { id: 4, title: "Thiết kế CSDL", category: "Dữ liệu", fee: 650000, seats: 15 },
      { id: 5, title: "Phân tích dữ liệu", category: "Dữ liệu", fee: 750000, seats: 12 },
      { id: 6, title: "Git thực hành", category: "Công cụ", fee: 300000, seats: 35 },
    ],
  },
};

const BLOCKS = {
  select: { keyword: "SELECT", help: "Chọn cột cần xem", className: "block-select", singleton: true },
  from: { keyword: "FROM", help: "Chọn bảng dữ liệu", className: "block-from", singleton: true },
  where: { keyword: "WHERE", help: "Tạo điều kiện lọc", className: "block-where", singleton: true },
  and: { keyword: "AND", help: "Thêm điều kiện bắt buộc", className: "block-and", singleton: false },
  or: { keyword: "OR", help: "Thêm điều kiện lựa chọn", className: "block-or", singleton: false },
  order: { keyword: "ORDER BY", help: "Sắp xếp kết quả", className: "block-order", singleton: true },
  limit: { keyword: "LIMIT", help: "Giới hạn số dòng", className: "block-limit", singleton: true },
};

const LESSONS = [
  {
    title: "Làm quen với SELECT",
    description: "Tạo câu lệnh lấy toàn bộ dữ liệu trong bảng học viên.",
    goal: "Hiển thị tất cả học viên",
    hint: "Bắt đầu với SELECT *, sau đó chỉ ra bảng students bằng FROM.",
    solution: [
      { type: "select", values: { columns: ["*"] } },
      { type: "from", values: { table: "students" } },
    ],
  },
  {
    title: "Lọc dữ liệu với WHERE",
    description: "Tìm tên và điểm của những học viên đạt từ 8 điểm.",
    goal: "name, score • score >= 8",
    hint: "Sau FROM students, thêm WHERE và đặt cột score, toán tử >=, giá trị 8.",
    solution: [
      { type: "select", values: { columns: ["name", "score"] } },
      { type: "from", values: { table: "students" } },
      { type: "where", values: { column: "score", operator: ">=", value: "8" } },
    ],
  },
  {
    title: "Tạo bảng xếp hạng",
    description: "Lấy top 3 học viên từ 7 điểm, sắp xếp điểm từ cao xuống thấp.",
    goal: "score >= 7 • ORDER BY score DESC • LIMIT 3",
    hint: "Thứ tự đúng là SELECT → FROM → WHERE → ORDER BY → LIMIT.",
    solution: [
      { type: "select", values: { columns: ["name", "city", "score"] } },
      { type: "from", values: { table: "students" } },
      { type: "where", values: { column: "score", operator: ">=", value: "7" } },
      { type: "order", values: { column: "score", direction: "DESC" } },
      { type: "limit", values: { count: "3" } },
    ],
  },
  {
    title: "Thử thách khóa học",
    description: "Tìm các khóa thuộc nhóm Dữ liệu và xếp học phí từ thấp đến cao.",
    goal: "title, fee • category = Dữ liệu • fee ASC",
    hint: "Đổi bảng thành courses. Chuỗi văn bản sẽ tự được đặt trong dấu nháy đơn.",
    solution: [
      { type: "select", values: { columns: ["title", "fee"] } },
      { type: "from", values: { table: "courses" } },
      { type: "where", values: { column: "category", operator: "=", value: "Dữ liệu" } },
      { type: "order", values: { column: "fee", direction: "ASC" } },
    ],
  },
];

const state = {
  blocks: [],
  activeSchema: "students",
  currentLesson: 0,
  completedLessons: new Set(),
  draggedBlockId: null,
};

const elements = {};

function cacheElements() {
  [
    "blockPalette", "workspace", "workspaceBlocks", "emptyWorkspace", "blockCount",
    "sqlPreview", "validationMessage", "runButton", "copyButton", "clearButton",
    "resultPlaceholder", "resultTableWrap", "resultMeta", "schemaTabs", "schemaContent",
    "lessonStep", "lessonTitle", "lessonDescription", "lessonGoal", "lessonProgressBar", "resultsTitle",
    "hintButton", "checkButton", "previousLessonButton", "nextLessonButton", "lessonDots",
    "toastRegion", "helpDialog", "openHelpButton", "saveState",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
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

function getCurrentTable() {
  return state.blocks.find((block) => block.type === "from")?.values.table || "students";
}

function getColumns(tableName = getCurrentTable()) {
  return Object.keys(DATABASE[tableName]?.columns || DATABASE.students.columns);
}

function defaultValues(type) {
  const columns = getColumns();
  const defaults = {
    select: { columns: ["*"] },
    from: { table: getCurrentTable() },
    where: { column: columns[0], operator: "=", value: "" },
    and: { column: columns[0], operator: "=", value: "" },
    or: { column: columns[0], operator: "=", value: "" },
    order: { column: columns[0], direction: "ASC" },
    limit: { count: "5" },
  };
  return structuredClone(defaults[type]);
}

function renderPalette() {
  elements.blockPalette.innerHTML = Object.entries(BLOCKS)
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

  elements.blockPalette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-palette-type]");
    if (button) addBlock(button.dataset.paletteType);
  });

  elements.blockPalette.addEventListener("dragstart", (event) => {
    const button = event.target.closest("[data-palette-type]");
    if (!button) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/sql-block-type", button.dataset.paletteType);
    event.dataTransfer.setData("text/plain", button.dataset.paletteType);
  });
}

function addBlock(type, index = state.blocks.length, suppliedValues = null) {
  const definition = BLOCKS[type];
  if (!definition) return;

  if (definition.singleton && state.blocks.some((block) => block.type === type)) {
    showToast(`Mỗi câu lệnh chỉ cần một khối ${definition.keyword}.`, "error");
    return;
  }

  if (["and", "or"].includes(type) && !state.blocks.some((block) => block.type === "where")) {
    showToast(`Hãy thêm WHERE trước khi dùng ${definition.keyword}.`, "error");
    return;
  }

  const block = {
    id: createId(),
    type,
    values: { ...defaultValues(type), ...(suppliedValues || {}) },
  };
  state.blocks.splice(Math.max(0, Math.min(index, state.blocks.length)), 0, block);
  renderWorkspace();
  markSaved();
}

function removeBlock(id) {
  state.blocks = state.blocks.filter((block) => block.id !== id);
  renderWorkspace();
  markSaved();
}

function renderWorkspace() {
  elements.emptyWorkspace.hidden = state.blocks.length > 0;
  elements.blockCount.textContent = `${state.blocks.length} khối`;
  elements.workspaceBlocks.innerHTML = state.blocks.map(renderWorkspaceBlock).join("");
  bindWorkspaceBlockEvents();
  renderSqlState();
}

function renderWorkspaceBlock(block) {
  const definition = BLOCKS[block.type];
  let controls = "";

  if (block.type === "select") {
    const options = ["*", ...getColumns()];
    controls = `
      <div class="column-picker" aria-label="Chọn các cột">
        ${options.map((column) => `
          <label class="column-chip">
            <input
              type="checkbox"
              data-field="columns"
              value="${escapeHtml(column)}"
              ${block.values.columns.includes(column) ? "checked" : ""}
            />
            <span>${escapeHtml(column)}</span>
          </label>
        `).join("")}
      </div>`;
  }

  if (block.type === "from") {
    controls = createSelectControl(
      "table",
      Object.entries(DATABASE).map(([value, table]) => ({ value, label: `${value} · ${table.label}` })),
      block.values.table,
      "Chọn bảng",
    );
  }

  if (["where", "and", "or"].includes(block.type)) {
    controls = [
      createSelectControl("column", getColumns().map((column) => ({ value: column, label: column })), block.values.column, "Chọn cột"),
      createSelectControl("operator", ["=", "!=", ">", ">=", "<", "<=", "LIKE"].map((operator) => ({ value: operator, label: operator })), block.values.operator, "Chọn toán tử"),
      `<input class="block-input" data-field="value" value="${escapeHtml(block.values.value)}" placeholder="Giá trị" aria-label="Giá trị so sánh" />`,
    ].join("");
  }

  if (block.type === "order") {
    controls = [
      createSelectControl("column", getColumns().map((column) => ({ value: column, label: column })), block.values.column, "Cột sắp xếp"),
      createSelectControl("direction", [
        { value: "ASC", label: "ASC · tăng dần" },
        { value: "DESC", label: "DESC · giảm dần" },
      ], block.values.direction, "Chiều sắp xếp"),
    ].join("");
  }

  if (block.type === "limit") {
    controls = `<input class="block-input" type="number" min="1" max="100" step="1" data-field="count" value="${escapeHtml(block.values.count)}" aria-label="Số dòng tối đa" />`;
  }

  return `
    <article class="workspace-block ${definition.className}" data-block-id="${block.id}">
      <button class="block-handle" type="button" draggable="true" title="Kéo để đổi vị trí" aria-label="Kéo khối ${definition.keyword} để đổi vị trí">⠿</button>
      <div class="block-content">
        <span class="block-keyword">${definition.keyword}</span>
        ${controls}
      </div>
      <button class="block-delete" type="button" data-action="delete" aria-label="Xóa khối ${definition.keyword}">×</button>
    </article>
  `;
}

function createSelectControl(field, options, selected, label) {
  return `
    <select class="block-control" data-field="${field}" aria-label="${label}">
      ${options.map((option) => `
        <option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? "selected" : ""}>
          ${escapeHtml(option.label)}
        </option>
      `).join("")}
    </select>
  `;
}

function bindWorkspaceBlockEvents() {
  elements.workspaceBlocks.querySelectorAll("[data-block-id]").forEach((blockElement) => {
    const blockId = blockElement.dataset.blockId;

    blockElement.querySelector("[data-action='delete']").addEventListener("click", () => removeBlock(blockId));

    blockElement.querySelectorAll("[data-field]").forEach((control) => {
      const eventName = control.matches("input:not([type='checkbox'])") ? "input" : "change";
      control.addEventListener(eventName, (event) => updateBlockValue(blockId, event.target));
    });

    const handle = blockElement.querySelector(".block-handle");
    handle.addEventListener("dragstart", (event) => {
      state.draggedBlockId = blockId;
      blockElement.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/sql-workspace-block", blockId);
      event.dataTransfer.setData("text/plain", blockId);
    });
    handle.addEventListener("dragend", () => {
      state.draggedBlockId = null;
      blockElement.classList.remove("is-dragging");
    });
  });
}

function updateBlockValue(blockId, control) {
  const block = state.blocks.find((item) => item.id === blockId);
  if (!block) return;

  const field = control.dataset.field;
  if (field === "columns") {
    const picker = control.closest(".column-picker");
    let selected = [...picker.querySelectorAll("input:checked")].map((input) => input.value);
    const changedValue = control.value;

    if (changedValue === "*" && control.checked) {
      selected = ["*"];
    } else if (changedValue !== "*" && control.checked) {
      selected = selected.filter((column) => column !== "*");
    }
    if (selected.length === 0) selected = ["*"];
    block.values.columns = selected;
    renderWorkspace();
  } else {
    block.values[field] = control.value;

    if (block.type === "from" && field === "table") {
      normalizeColumnsForTable(control.value);
      state.activeSchema = control.value;
      renderSchema();
      renderWorkspace();
    } else {
      renderSqlState();
    }
  }
  markSaved();
}

function normalizeColumnsForTable(tableName) {
  const validColumns = getColumns(tableName);
  state.blocks.forEach((block) => {
    if (block.type === "select") {
      const selected = block.values.columns.filter((column) => column === "*" || validColumns.includes(column));
      block.values.columns = selected.length ? selected : ["*"];
    }
    if (["where", "and", "or", "order"].includes(block.type) && !validColumns.includes(block.values.column)) {
      block.values.column = validColumns[0];
    }
  });
}

function getDropIndex(event) {
  const blockElements = [...elements.workspaceBlocks.querySelectorAll("[data-block-id]:not(.is-dragging)")];
  const nextBlock = blockElements.find((element) => {
    const box = element.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2;
  });
  if (!nextBlock) return state.blocks.length;
  return state.blocks.findIndex((block) => block.id === nextBlock.dataset.blockId);
}

function setupWorkspaceDropZone() {
  elements.workspace.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.workspace.classList.add("is-dragging-over");
    event.dataTransfer.dropEffect = state.draggedBlockId ? "move" : "copy";
  });

  elements.workspace.addEventListener("dragleave", (event) => {
    if (!elements.workspace.contains(event.relatedTarget)) {
      elements.workspace.classList.remove("is-dragging-over");
    }
  });

  elements.workspace.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.workspace.classList.remove("is-dragging-over");
    const dropIndex = getDropIndex(event);
    const workspaceId = event.dataTransfer.getData("text/sql-workspace-block");
    const paletteType = event.dataTransfer.getData("text/sql-block-type");

    if (workspaceId) {
      const oldIndex = state.blocks.findIndex((block) => block.id === workspaceId);
      if (oldIndex < 0) return;
      const [movedBlock] = state.blocks.splice(oldIndex, 1);
      const adjustedIndex = oldIndex < dropIndex ? dropIndex - 1 : dropIndex;
      state.blocks.splice(Math.max(0, adjustedIndex), 0, movedBlock);
      renderWorkspace();
      markSaved();
    } else if (paletteType) {
      addBlock(paletteType, dropIndex);
    }
  });
}

function validateBlocks() {
  if (state.blocks.length === 0) {
    return { valid: false, neutral: true, message: "Hãy thêm khối SELECT và FROM để bắt đầu." };
  }

  const types = state.blocks.map((block) => block.type);
  if (!types.includes("select")) return { valid: false, message: "Câu lệnh cần bắt đầu bằng khối SELECT." };
  if (!types.includes("from")) return { valid: false, message: "Hãy thêm khối FROM để chọn bảng dữ liệu." };
  if (types[0] !== "select") return { valid: false, message: "SELECT phải là khối đầu tiên." };

  const ranks = { select: 0, from: 1, where: 2, and: 2, or: 2, order: 3, limit: 4 };
  for (let index = 1; index < types.length; index += 1) {
    if (ranks[types[index]] < ranks[types[index - 1]]) {
      return { valid: false, message: `${BLOCKS[types[index]].keyword} đang đặt sai vị trí. Hãy thử kéo lại các khối.` };
    }
  }

  const fromIndex = types.indexOf("from");
  if (fromIndex !== 1) return { valid: false, message: "FROM nên nằm ngay sau SELECT." };

  const whereIndex = types.indexOf("where");
  const connectors = state.blocks.filter((block) => ["and", "or"].includes(block.type));
  if (connectors.length && whereIndex === -1) return { valid: false, message: "AND hoặc OR cần đi sau một khối WHERE." };
  if (connectors.some((block) => state.blocks.indexOf(block) < whereIndex)) {
    return { valid: false, message: "AND và OR phải được đặt sau WHERE." };
  }

  const conditionBlocks = state.blocks.filter((block) => ["where", "and", "or"].includes(block.type));
  if (conditionBlocks.some((block) => String(block.values.value).trim() === "")) {
    return { valid: false, message: "Hãy nhập giá trị cho tất cả điều kiện lọc." };
  }

  const limit = state.blocks.find((block) => block.type === "limit");
  if (limit && (!Number.isInteger(Number(limit.values.count)) || Number(limit.values.count) < 1)) {
    return { valid: false, message: "LIMIT phải là một số nguyên lớn hơn 0." };
  }

  return { valid: true, message: "Cú pháp hợp lệ — bạn có thể chạy câu lệnh." };
}

function buildSql() {
  return state.blocks.map((block) => {
    switch (block.type) {
      case "select":
        return `SELECT ${block.values.columns.join(", ")}`;
      case "from":
        return `FROM ${block.values.table}`;
      case "where":
      case "and":
      case "or":
        return `${BLOCKS[block.type].keyword} ${block.values.column} ${block.values.operator} ${formatSqlValue(block.values.value)}`;
      case "order":
        return `ORDER BY ${block.values.column} ${block.values.direction}`;
      case "limit":
        return `LIMIT ${block.values.count}`;
      default:
        return "";
    }
  }).filter(Boolean).join("\n") + (state.blocks.length ? ";" : "");
}

function formatSqlValue(rawValue) {
  const value = String(rawValue).trim();
  if (value === "") return "?";
  if (!Number.isNaN(Number(value))) return value;
  return `'${value.replaceAll("'", "''")}'`;
}

function highlightSql(sql) {
  if (!sql) return '<span class="sql-comment">-- Hãy thêm khối để bắt đầu</span>';
  const tokenPattern = /'(?:''|[^'])*'|\b(?:ORDER BY|SELECT|FROM|WHERE|AND|OR|LIMIT|ASC|DESC|LIKE)\b|>=|<=|!=|=|>|<|\b\d+(?:\.\d+)?\b/g;
  let highlighted = "";
  let lastIndex = 0;

  for (const match of sql.matchAll(tokenPattern)) {
    const token = match[0];
    highlighted += escapeHtml(sql.slice(lastIndex, match.index));

    let className = "sql-keyword";
    if (token.startsWith("'")) className = "sql-string";
    else if (/^(?:>=|<=|!=|=|>|<)$/.test(token)) className = "sql-operator";
    else if (/^\d/.test(token)) className = "sql-number";

    highlighted += `<span class="${className}">${escapeHtml(token)}</span>`;
    lastIndex = match.index + token.length;
  }

  return highlighted + escapeHtml(sql.slice(lastIndex));
}

function renderSqlState() {
  const sql = buildSql();
  const validation = validateBlocks();
  elements.sqlPreview.innerHTML = `<code>${highlightSql(sql)}</code>`;
  elements.validationMessage.className = `validation-message ${validation.valid ? "success" : validation.neutral ? "neutral" : "error"}`;
  elements.validationMessage.innerHTML = `
    <span aria-hidden="true">${validation.valid ? "✓" : validation.neutral ? "○" : "!"}</span>
    <p>${escapeHtml(validation.message)}</p>
  `;
  elements.runButton.disabled = !validation.valid;
}

function coerceConditionValue(rawValue, columnType) {
  const trimmed = String(rawValue).trim();
  return columnType === "number" && trimmed !== "" ? Number(trimmed) : trimmed;
}

function compareValue(actual, operator, expected) {
  const left = typeof actual === "string" ? actual.toLocaleLowerCase("vi") : actual;
  const right = typeof expected === "string" ? expected.toLocaleLowerCase("vi") : expected;
  switch (operator) {
    case "=": return left === right;
    case "!=": return left !== right;
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
    case "LIKE": {
      const escaped = String(right).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = `^${escaped.replaceAll("%", ".*").replaceAll("_", ".")}$`;
      return new RegExp(pattern, "iu").test(String(left));
    }
    default: return false;
  }
}

function evaluateConditions(row, tableName, conditionBlocks) {
  if (!conditionBlocks.length) return true;
  const groups = [[]];
  conditionBlocks.forEach((block, index) => {
    if (block.type === "or" && index > 0) groups.push([]);
    groups.at(-1).push(block);
  });

  return groups.some((group) => group.every((block) => {
    const type = DATABASE[tableName].columns[block.values.column];
    const expected = coerceConditionValue(block.values.value, type);
    return compareValue(row[block.values.column], block.values.operator, expected);
  }));
}

function executeQuery() {
  const validation = validateBlocks();
  if (!validation.valid) {
    showToast(validation.message, "error");
    return;
  }

  const tableName = state.blocks.find((block) => block.type === "from").values.table;
  const table = DATABASE[tableName];
  const selectBlock = state.blocks.find((block) => block.type === "select");
  const selectedColumns = selectBlock.values.columns.includes("*") ? Object.keys(table.columns) : selectBlock.values.columns;
  const conditionBlocks = state.blocks.filter((block) => ["where", "and", "or"].includes(block.type));
  const orderBlock = state.blocks.find((block) => block.type === "order");
  const limitBlock = state.blocks.find((block) => block.type === "limit");

  let rows = table.rows.filter((row) => evaluateConditions(row, tableName, conditionBlocks));
  if (orderBlock) {
    const direction = orderBlock.values.direction === "DESC" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const left = a[orderBlock.values.column];
      const right = b[orderBlock.values.column];
      if (typeof left === "string" && typeof right === "string") return left.localeCompare(right, "vi") * direction;
      return (left === right ? 0 : left > right ? 1 : -1) * direction;
    });
  }
  if (limitBlock) rows = rows.slice(0, Number(limitBlock.values.count));

  const projectedRows = rows.map((row) => Object.fromEntries(selectedColumns.map((column) => [column, row[column]])));
  renderResults(selectedColumns, projectedRows);
  showToast(`Truy vấn thành công: ${projectedRows.length} dòng.`, "success");
}

function renderResults(columns, rows) {
  elements.resultPlaceholder.hidden = true;
  elements.resultTableWrap.hidden = false;
  elements.resultMeta.textContent = `${rows.length} dòng • ${columns.length} cột`;

  const body = rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>`).join("")
    : `<tr><td class="empty-result-cell" colspan="${columns.length}">Không có dòng nào phù hợp điều kiện.</td></tr>`;

  elements.resultTableWrap.innerHTML = `
    <table class="result-table">
      <thead><tr>${columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
  elements.resultsTitle?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

function renderSchema() {
  elements.schemaTabs.innerHTML = Object.entries(DATABASE).map(([name, table]) => `
    <button
      class="schema-tab"
      type="button"
      role="tab"
      data-schema="${name}"
      aria-selected="${state.activeSchema === name}"
    >${name}</button>
  `).join("");

  const table = DATABASE[state.activeSchema];
  elements.schemaContent.innerHTML = `
    <dl class="schema-list">
      ${Object.entries(table.columns).map(([column, type]) => `
        <div class="schema-row"><dt>${escapeHtml(column)}</dt><dd>${escapeHtml(type)}</dd></div>
      `).join("")}
    </dl>
  `;
}

function renderLesson() {
  const lesson = LESSONS[state.currentLesson];
  elements.lessonStep.textContent = `BÀI ${state.currentLesson + 1} / ${LESSONS.length}`;
  elements.lessonTitle.textContent = lesson.title;
  elements.lessonDescription.textContent = lesson.description;
  elements.lessonGoal.innerHTML = `<span>Mục tiêu</span><code>${escapeHtml(lesson.goal)}</code>`;
  elements.lessonProgressBar.style.width = `${((state.currentLesson + 1) / LESSONS.length) * 100}%`;
  elements.previousLessonButton.disabled = state.currentLesson === 0;
  elements.nextLessonButton.disabled = state.currentLesson === LESSONS.length - 1;

  elements.lessonDots.innerHTML = LESSONS.map((_, index) => `
    <button
      class="lesson-dot ${index === state.currentLesson ? "active" : ""} ${state.completedLessons.has(index) ? "completed" : ""}"
      type="button"
      data-lesson-index="${index}"
      aria-label="Đi đến bài ${index + 1}"
      aria-current="${index === state.currentLesson ? "step" : "false"}"
    ></button>
  `).join("");
}

function normalizeComparableValue(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi");
}

function matchesLesson(actualBlocks, solution) {
  if (actualBlocks.length !== solution.length) return false;
  return solution.every((expected, index) => {
    const actual = actualBlocks[index];
    if (!actual || actual.type !== expected.type) return false;
    return Object.entries(expected.values).every(([key, expectedValue]) => {
      const actualValue = actual.values[key];
      if (Array.isArray(expectedValue)) {
        return actualValue.length === expectedValue.length && expectedValue.every((value) => actualValue.includes(value));
      }
      return normalizeComparableValue(actualValue) === normalizeComparableValue(expectedValue);
    });
  });
}

function checkLesson() {
  const lesson = LESSONS[state.currentLesson];
  const validation = validateBlocks();
  if (!validation.valid) {
    showToast(validation.message, "error");
    return;
  }

  if (matchesLesson(state.blocks, lesson.solution)) {
    state.completedLessons.add(state.currentLesson);
    renderLesson();
    executeQuery();
    showToast("Chính xác! Bạn đã hoàn thành bài học 🎉", "success");
    persistProgress();
  } else {
    showToast("Câu lệnh chạy được, nhưng chưa đúng mục tiêu. Hãy đọc lại yêu cầu hoặc xem gợi ý.", "error");
  }
}

function loadLessonSolution() {
  const lesson = LESSONS[state.currentLesson];
  state.blocks = lesson.solution.map((block) => ({
    id: createId(),
    type: block.type,
    values: structuredClone(block.values),
  }));
  const table = state.blocks.find((block) => block.type === "from")?.values.table || "students";
  state.activeSchema = table;
  renderSchema();
  renderWorkspace();
  markSaved();
  showToast("Đã nạp một câu lệnh mẫu. Hãy quan sát từng khối nhé.");
}

function changeLesson(index) {
  if (index < 0 || index >= LESSONS.length) return;
  state.currentLesson = index;
  state.blocks = [];
  renderLesson();
  renderWorkspace();
  clearResults();
  markSaved();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearResults() {
  elements.resultPlaceholder.hidden = false;
  elements.resultTableWrap.hidden = true;
  elements.resultTableWrap.innerHTML = "";
  elements.resultMeta.textContent = "Chưa chạy câu lệnh";
}

async function copySql() {
  const sql = buildSql();
  if (!sql) {
    showToast("Chưa có câu lệnh để sao chép.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(sql);
    showToast("Đã sao chép câu lệnh SQL.", "success");
    elements.copyButton.textContent = "Đã chép ✓";
    setTimeout(() => { elements.copyButton.textContent = "Sao chép"; }, 1500);
  } catch {
    showToast("Trình duyệt chưa cho phép sao chép tự động.", "error");
  }
}

function showToast(message, type = "neutral") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3500);
}

let saveTimer;
function markSaved() {
  elements.saveState.innerHTML = '<span class="save-dot"></span>Đang lưu…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistProgress();
    elements.saveState.innerHTML = '<span class="save-dot"></span>Đã lưu';
  }, 300);
}

function persistProgress() {
  try {
    localStorage.setItem("sql-scratch-progress", JSON.stringify({
      completedLessons: [...state.completedLessons],
      currentLesson: state.currentLesson,
      activeSchema: state.activeSchema,
      blocks: state.blocks,
    }));
  } catch {
    // Ứng dụng vẫn hoạt động nếu trình duyệt chặn localStorage.
  }
}

function restoreProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem("sql-scratch-progress") || "{}");
    state.completedLessons = new Set(saved.completedLessons || []);
    if (Number.isInteger(saved.currentLesson) && LESSONS[saved.currentLesson]) {
      state.currentLesson = saved.currentLesson;
    }
    if (DATABASE[saved.activeSchema]) state.activeSchema = saved.activeSchema;
    if (Array.isArray(saved.blocks)) {
      state.blocks = saved.blocks
        .filter((block) => block && BLOCKS[block.type] && block.values)
        .map((block) => ({ id: block.id || createId(), type: block.type, values: block.values }));
    }
  } catch {
    state.completedLessons = new Set();
    state.blocks = [];
  }
}

function bindGlobalEvents() {
  elements.clearButton.addEventListener("click", () => {
    if (!state.blocks.length) return;
    state.blocks = [];
    renderWorkspace();
    clearResults();
    markSaved();
    showToast("Đã dọn sạch vùng lắp ghép.");
  });
  elements.runButton.addEventListener("click", executeQuery);
  elements.copyButton.addEventListener("click", copySql);
  elements.checkButton.addEventListener("click", checkLesson);
  elements.hintButton.addEventListener("click", () => {
    const lesson = LESSONS[state.currentLesson];
    showToast(`${lesson.hint} Bấm thêm lần nữa để nạp mẫu.`);
    if (elements.hintButton.dataset.armed === "true") {
      loadLessonSolution();
      elements.hintButton.dataset.armed = "false";
    } else {
      elements.hintButton.dataset.armed = "true";
      setTimeout(() => { elements.hintButton.dataset.armed = "false"; }, 5000);
    }
  });
  elements.previousLessonButton.addEventListener("click", () => changeLesson(state.currentLesson - 1));
  elements.nextLessonButton.addEventListener("click", () => changeLesson(state.currentLesson + 1));
  elements.lessonDots.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-lesson-index]");
    if (dot) changeLesson(Number(dot.dataset.lessonIndex));
  });
  elements.schemaTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-schema]");
    if (!tab) return;
    state.activeSchema = tab.dataset.schema;
    renderSchema();
  });
  elements.openHelpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.helpDialog.addEventListener("click", (event) => {
    if (event.target === elements.helpDialog) elements.helpDialog.close();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!elements.runButton.disabled) executeQuery();
    }
  });
}

function init() {
  cacheElements();
  restoreProgress();
  renderPalette();
  renderSchema();
  renderLesson();
  renderWorkspace();
  setupWorkspaceDropZone();
  bindGlobalEvents();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DATABASE,
    compareValue,
    coerceConditionValue,
    evaluateConditions,
    formatSqlValue,
    highlightSql,
    matchesLesson,
  };
}
