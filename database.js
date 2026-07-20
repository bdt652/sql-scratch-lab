"use strict";

(function attachDatabaseLayer(global) {
  const DB_NAME = "sqlite-scratch-lab";
  const DB_VERSION = 1;
  const DATABASE_STORE = "databases";
  const ACTIVE_DATABASE_KEY = "sqlite-scratch-active-database";

  const SAMPLE_DATABASE_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 0),
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 10),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  seats INTEGER NOT NULL DEFAULT 0 CHECK (seats >= 0)
);

CREATE TABLE enrollments (
  student_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  PRIMARY KEY (student_id, course_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

INSERT INTO students (name, city, age, score) VALUES
  ('An', 'Hà Nội', 19, 8.5),
  ('Bình', 'Đà Nẵng', 21, 7.2),
  ('Chi', 'Hà Nội', 20, 9.1),
  ('Dũng', 'Huế', 22, 6.8),
  ('Giang', 'TP.HCM', 20, 8.0),
  ('Hà', 'Đà Nẵng', 18, 7.8),
  ('Khôi', 'Cần Thơ', 23, 9.4),
  ('Lan', 'TP.HCM', 19, 8.7);

INSERT INTO courses (title, category, fee, seats) VALUES
  ('SQL nhập môn', 'Dữ liệu', 450000, 24),
  ('HTML & CSS', 'Web', 350000, 30),
  ('JavaScript cơ bản', 'Web', 550000, 18),
  ('Thiết kế CSDL', 'Dữ liệu', 650000, 15),
  ('Phân tích dữ liệu', 'Dữ liệu', 750000, 12),
  ('Git thực hành', 'Công cụ', 300000, 35);

INSERT INTO enrollments (student_id, course_id, status) VALUES
  (1, 1, 'completed'), (1, 4, 'active'),
  (2, 2, 'completed'), (2, 3, 'active'),
  (3, 1, 'completed'), (3, 5, 'active'),
  (4, 6, 'active'), (5, 3, 'active'),
  (6, 2, 'completed'), (7, 4, 'completed'),
  (7, 5, 'active'), (8, 1, 'active');

CREATE INDEX idx_students_score ON students(score DESC);
CREATE INDEX idx_courses_category ON courses(category);

CREATE VIEW high_score_students AS
SELECT id, name, city, score
FROM students
WHERE score >= 8;
`;

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function transactionToPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  function cloneBuffer(buffer) {
    if (buffer instanceof Uint8Array) {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    return buffer.slice(0);
  }

  function safeLocalStorageGet(key) {
    try {
      return global.localStorage?.getItem(key) || null;
    } catch {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      global.localStorage?.setItem(key, value);
    } catch {
      // IndexedDB remains the source of truth when localStorage is unavailable.
    }
  }

  class DatabaseStorage {
    constructor() {
      this.database = null;
      this.mode = "indexeddb";
      this.memoryRecords = new Map();
    }

    async open() {
      if (!global.indexedDB) {
        this.mode = "memory";
        return;
      }

      try {
        const request = global.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(DATABASE_STORE)) {
            database.createObjectStore(DATABASE_STORE, { keyPath: "name" });
          }
        };
        this.database = await requestToPromise(request);
        this.database.onversionchange = () => this.database.close();
      } catch (error) {
        console.warn("IndexedDB unavailable; using memory storage.", error);
        this.mode = "memory";
        this.database = null;
      }
    }

    async list() {
      if (this.mode === "memory") {
        return [...this.memoryRecords.values()]
          .map((record) => ({ ...record, data: cloneBuffer(record.data) }))
          .sort((a, b) => a.name.localeCompare(b.name, "vi"));
      }

      const transaction = this.database.transaction(DATABASE_STORE, "readonly");
      const records = await requestToPromise(transaction.objectStore(DATABASE_STORE).getAll());
      return records.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    }

    async get(name) {
      if (this.mode === "memory") {
        const record = this.memoryRecords.get(name);
        return record ? { ...record, data: cloneBuffer(record.data) } : null;
      }

      const transaction = this.database.transaction(DATABASE_STORE, "readonly");
      return requestToPromise(transaction.objectStore(DATABASE_STORE).get(name));
    }

    async put(record) {
      const normalized = { ...record, data: cloneBuffer(record.data) };
      if (this.mode === "memory") {
        this.memoryRecords.set(record.name, normalized);
        return;
      }

      const transaction = this.database.transaction(DATABASE_STORE, "readwrite");
      transaction.objectStore(DATABASE_STORE).put(normalized);
      await transactionToPromise(transaction);
    }

    async delete(name) {
      if (this.mode === "memory") {
        this.memoryRecords.delete(name);
        return;
      }

      const transaction = this.database.transaction(DATABASE_STORE, "readwrite");
      transaction.objectStore(DATABASE_STORE).delete(name);
      await transactionToPromise(transaction);
    }

    async rename(oldName, newName) {
      const record = await this.get(oldName);
      if (!record) throw new Error(`Không tìm thấy database “${oldName}”.`);
      const renamed = { ...record, name: newName, updatedAt: new Date().toISOString() };

      if (this.mode === "memory") {
        this.memoryRecords.delete(oldName);
        this.memoryRecords.set(newName, renamed);
        return renamed;
      }

      const transaction = this.database.transaction(DATABASE_STORE, "readwrite");
      const store = transaction.objectStore(DATABASE_STORE);
      store.delete(oldName);
      store.put(renamed);
      await transactionToPromise(transaction);
      return renamed;
    }
  }

  function normalizeDatabaseName(value) {
    const name = String(value || "").trim().replace(/\s+/g, " ");
    if (!name) throw new Error("Tên database không được để trống.");
    if (name.length > 40) throw new Error("Tên database tối đa 40 ký tự.");
    if (/[/\\\0]/.test(name)) throw new Error("Tên database không được chứa /, \\ hoặc ký tự rỗng.");
    return name;
  }

  function firstKeyword(sql) {
    const withoutComments = String(sql)
      .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, "")
      .trim();
    return withoutComments.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() || "";
  }

  function isSchemaOrDataMutation(sql, changedRows) {
    if (changedRows > 0) return true;
    return /^(CREATE|ALTER|DROP|VACUUM|REINDEX|ANALYZE|ATTACH|DETACH|PRAGMA)$/i.test(firstKeyword(sql));
  }

  function quoteSqlString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
  }

  function arrayBufferFromBytes(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  function skipSqlWhitespaceAndComments(source, startIndex = 0) {
    let index = startIndex;
    while (index < source.length) {
      const whitespace = source.slice(index).match(/^\s+/);
      if (whitespace) {
        index += whitespace[0].length;
        continue;
      }
      if (source.startsWith("--", index)) {
        const newline = source.indexOf("\n", index + 2);
        index = newline < 0 ? source.length : newline + 1;
        continue;
      }
      if (source.startsWith("/*", index)) {
        const end = source.indexOf("*/", index + 2);
        index = end < 0 ? source.length : end + 2;
        continue;
      }
      break;
    }
    return index;
  }

  function unquoteDatabaseIdentifier(value) {
    const identifier = String(value || "").trim();
    if ((identifier.startsWith("`") && identifier.endsWith("`"))
      || (identifier.startsWith('"') && identifier.endsWith('"'))
      || (identifier.startsWith("[") && identifier.endsWith("]"))) {
      const inner = identifier.slice(1, -1);
      if (identifier.startsWith("`")) return inner.replaceAll("``", "`");
      if (identifier.startsWith('"')) return inner.replaceAll('""', '"');
      return inner.replaceAll("]]", "]");
    }
    return identifier;
  }

  function parseLeadingDatabaseCommands(source) {
    const commands = [];
    let index = 0;

    while (index < source.length) {
      const commandStart = skipSqlWhitespaceAndComments(source, index);
      const remaining = source.slice(commandStart);
      let match = remaining.match(/^CREATE\s+(?:DATABASE|SCHEMA)\s+(IF\s+NOT\s+EXISTS\s+)?((?:`(?:``|[^`])+`|"(?:""|[^"])+"|\[(?:\]\]|[^\]])+\]|[^;\s]+))\s*(?:;|$)/i);
      if (match) {
        commands.push({
          type: "create-database",
          name: unquoteDatabaseIdentifier(match[2]),
          ifNotExists: Boolean(match[1]),
          sql: match[0].trim(),
        });
        index = commandStart + match[0].length;
        continue;
      }

      match = remaining.match(/^USE\s+((?:`(?:``|[^`])+`|"(?:""|[^"])+"|\[(?:\]\]|[^\]])+\]|[^;\s]+))\s*(?:;|$)/i);
      if (match) {
        commands.push({ type: "use-database", name: unquoteDatabaseIdentifier(match[1]), sql: match[0].trim() });
        index = commandStart + match[0].length;
        continue;
      }

      match = remaining.match(/^DROP\s+(?:DATABASE|SCHEMA)\s+(IF\s+EXISTS\s+)?((?:`(?:``|[^`])+`|"(?:""|[^"])+"|\[(?:\]\]|[^\]])+\]|[^;\s]+))\s*(?:;|$)/i);
      if (match) {
        commands.push({
          type: "drop-database",
          name: unquoteDatabaseIdentifier(match[2]),
          ifExists: Boolean(match[1]),
          sql: match[0].trim(),
        });
        index = commandStart + match[0].length;
        continue;
      }

      match = remaining.match(/^SHOW\s+DATABASES\s*(?:;|$)/i);
      if (match) {
        commands.push({ type: "show-databases", sql: match[0].trim() });
        index = commandStart + match[0].length;
        continue;
      }
      break;
    }

    return {
      commands,
      remainingSql: source.slice(skipSqlWhitespaceAndComments(source, index)).trim(),
    };
  }

  class SQLiteWorkspace {
    constructor(options = {}) {
      this.wasmPath = options.wasmPath || "vendor/";
      this.storage = new DatabaseStorage();
      this.SQL = null;
      this.database = null;
      this.currentName = null;
      this.currentRecord = null;
      this.transactionDepth = 0;
      this.dirty = false;
      this.sqliteVersion = "";
    }

    async initialize() {
      if (typeof global.initSqlJs !== "function") {
        throw new Error("Không tải được SQLite WebAssembly. Hãy kiểm tra kết nối rồi tải lại trang.");
      }

      await this.storage.open();
      this.SQL = await global.initSqlJs({
        locateFile: (file) => `${this.wasmPath}${file}?v=1.14.1`,
      });

      let databases = await this.storage.list();
      if (databases.length === 0) {
        await this.createDatabase("school", { sample: true });
        databases = await this.storage.list();
      }

      const preferredName = safeLocalStorageGet(ACTIVE_DATABASE_KEY);
      const target = databases.some((item) => item.name === preferredName)
        ? preferredName
        : databases[0].name;
      await this.switchDatabase(target);
      return this.getStatus();
    }

    async listDatabases() {
      const records = await this.storage.list();
      return records.map((record) => ({
        name: record.name,
        size: record.data?.byteLength || 0,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
    }

    async resolveDatabaseName(name) {
      const normalized = normalizeDatabaseName(name);
      const databases = await this.listDatabases();
      return databases.find((item) => item.name.toLocaleLowerCase("vi") === normalized.toLocaleLowerCase("vi"))?.name || null;
    }

    async hasDatabase(name) {
      const normalized = normalizeDatabaseName(name);
      const records = await this.storage.list();
      return records.some((record) => record.name.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0);
    }

    async uniqueName(baseName) {
      const normalized = normalizeDatabaseName(baseName);
      const databases = await this.listDatabases();
      const names = new Set(databases.map((item) => item.name.toLocaleLowerCase("vi")));
      if (!names.has(normalized.toLocaleLowerCase("vi"))) return normalized;
      let index = 2;
      while (names.has(`${normalized} ${index}`.toLocaleLowerCase("vi"))) index += 1;
      return `${normalized} ${index}`;
    }

    async createDatabase(name, options = {}) {
      const normalized = normalizeDatabaseName(name);
      if (await this.hasDatabase(normalized)) {
        throw new Error(`Database “${normalized}” đã tồn tại.`);
      }

      const database = options.bytes
        ? new this.SQL.Database(new Uint8Array(options.bytes))
        : new this.SQL.Database();

      try {
        database.run("PRAGMA foreign_keys = ON;");
        if (options.sample) database.run(SAMPLE_DATABASE_SQL);
        const quickCheck = database.exec("PRAGMA quick_check;");
        const result = quickCheck[0]?.values?.[0]?.[0];
        if (result !== "ok") throw new Error(`SQLite quick_check thất bại: ${String(result)}`);
        const exported = database.export();
        const now = new Date().toISOString();
        await this.storage.put({
          name: normalized,
          data: arrayBufferFromBytes(exported),
          createdAt: now,
          updatedAt: now,
        });
      } finally {
        database.close();
      }

      return normalized;
    }

    async switchDatabase(name) {
      const normalized = normalizeDatabaseName(name);
      if (normalized === this.currentName && this.database) return this.getStatus();
      if (this.transactionDepth > 0) {
        const error = new Error("Database hiện có transaction chưa kết thúc.");
        error.code = "TRANSACTION_OPEN";
        throw error;
      }

      if (this.database && this.dirty) await this.saveCurrent();
      const record = await this.storage.get(normalized);
      if (!record) throw new Error(`Không tìm thấy database “${normalized}”.`);

      this.database?.close();
      this.database = new this.SQL.Database(new Uint8Array(record.data));
      this.database.run("PRAGMA foreign_keys = ON;");
      this.currentName = normalized;
      this.currentRecord = record;
      this.transactionDepth = 0;
      this.dirty = false;
      this.sqliteVersion = this.scalar("SELECT sqlite_version();") || "";
      safeLocalStorageSet(ACTIVE_DATABASE_KEY, normalized);
      return this.getStatus();
    }

    scalar(sql) {
      const result = this.database.exec(sql);
      return result[0]?.values?.[0]?.[0] ?? null;
    }

    getTotalChanges() {
      return Number(this.scalar("SELECT total_changes();") || 0);
    }

    updateTransactionState(statementSql) {
      const normalized = statementSql
        .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, "")
        .trim()
        .toUpperCase();

      if (/^(BEGIN\b|START\s+TRANSACTION\b)/.test(normalized)) {
        this.transactionDepth = Math.max(1, this.transactionDepth + 1);
        return;
      }
      if (/^SAVEPOINT\b/.test(normalized)) {
        this.transactionDepth += 1;
        return;
      }
      if (/^RELEASE\b/.test(normalized)) {
        this.transactionDepth = Math.max(0, this.transactionDepth - 1);
        return;
      }
      if (/^ROLLBACK\s+TO\b/.test(normalized)) return;
      if (/^ROLLBACK\b/.test(normalized)) {
        this.transactionDepth = 0;
        this.dirty = false;
        return;
      }
      if (/^(COMMIT\b|END\b)/.test(normalized)) {
        this.transactionDepth = 0;
      }
    }

    async execute(sql) {
      const source = String(sql || "").trim();
      if (!source) throw new Error("Hãy nhập một câu lệnh SQL trước khi chạy.");

      const parsed = parseLeadingDatabaseCommands(source);
      if (parsed.commands.length === 0) return this.executeSQLite(source);

      const startedAt = global.performance?.now?.() ?? Date.now();
      const aggregate = {
        sql: source,
        results: [],
        statements: 0,
        affectedRows: 0,
        durationMs: 0,
        transactionOpen: this.transactionDepth > 0,
      };

      try {
        for (const command of parsed.commands) {
          if (command.type !== "show-databases" && this.transactionDepth > 0) {
            throw new Error("Hãy COMMIT hoặc ROLLBACK transaction trước khi chuyển database.");
          }

          if (command.type === "create-database") {
            const existingName = await this.resolveDatabaseName(command.name);
            if (existingName && !command.ifNotExists) {
              throw new Error(`Database “${existingName}” đã tồn tại.`);
            }
            const databaseName = existingName || await this.createDatabase(command.name, { sample: false });
            await this.switchDatabase(databaseName);
            aggregate.results.push({
              columns: ["database", "status"],
              values: [[databaseName, existingName ? "đã tồn tại · đã chọn" : "đã tạo · đã chọn"]],
              sql: command.sql,
            });
          }

          if (command.type === "use-database") {
            const databaseName = await this.resolveDatabaseName(command.name);
            if (!databaseName) throw new Error(`Không tìm thấy database “${command.name}”.`);
            await this.switchDatabase(databaseName);
            aggregate.results.push({
              columns: ["database", "status"],
              values: [[databaseName, "đang sử dụng"]],
              sql: command.sql,
            });
          }

          if (command.type === "drop-database") {
            const databaseName = await this.resolveDatabaseName(command.name);
            if (!databaseName && !command.ifExists) throw new Error(`Không tìm thấy database “${command.name}”.`);
            if (databaseName) await this.deleteDatabase(databaseName);
            aggregate.results.push({
              columns: ["database", "status"],
              values: [[databaseName || command.name, databaseName ? "đã xóa" : "không tồn tại"]],
              sql: command.sql,
            });
          }

          if (command.type === "show-databases") {
            const databases = await this.listDatabases();
            aggregate.results.push({
              columns: ["database", "size_bytes", "current"],
              values: databases.map((item) => [item.name, item.size, item.name === this.currentName ? 1 : 0]),
              sql: command.sql,
            });
          }
          aggregate.statements += 1;
        }

        if (parsed.remainingSql) {
          const sqliteExecution = await this.executeSQLite(parsed.remainingSql);
          aggregate.results.push(...sqliteExecution.results);
          aggregate.statements += sqliteExecution.statements;
          aggregate.affectedRows += sqliteExecution.affectedRows;
          aggregate.transactionOpen = sqliteExecution.transactionOpen;
        }

        const endedAt = global.performance?.now?.() ?? Date.now();
        aggregate.durationMs = Math.max(0, endedAt - startedAt);
        aggregate.transactionOpen = this.transactionDepth > 0;
        return aggregate;
      } catch (error) {
        const innerExecution = error.execution;
        if (innerExecution) {
          aggregate.statements += innerExecution.statements || 0;
          aggregate.affectedRows += innerExecution.affectedRows || 0;
        }
        const endedAt = global.performance?.now?.() ?? Date.now();
        error.execution = {
          sql: source,
          statements: aggregate.statements,
          affectedRows: aggregate.affectedRows,
          durationMs: Math.max(0, endedAt - startedAt),
          transactionOpen: this.transactionDepth > 0,
        };
        throw error;
      }
    }

    async executeSQLite(sql) {
      const source = String(sql || "").trim();
      if (!source) throw new Error("Hãy nhập một câu lệnh SQL trước khi chạy.");

      const startedAt = global.performance?.now?.() ?? Date.now();
      const results = [];
      let statements = 0;
      let affectedRows = 0;

      try {
        for (const statement of this.database.iterateStatements(source)) {
          const statementSql = statement.getSQL().trim();
          const columns = statement.getColumnNames();
          const values = [];
          const changesBefore = this.getTotalChanges();

          try {
            while (statement.step()) values.push(statement.get());
          } finally {
            statement.free();
          }

          const changesAfter = this.getTotalChanges();
          const statementChanges = Math.max(0, changesAfter - changesBefore);
          affectedRows += statementChanges;
          statements += 1;

          if (columns.length > 0) {
            results.push({ columns, values, sql: statementSql });
          }
          if (isSchemaOrDataMutation(statementSql, statementChanges)) this.dirty = true;
          this.updateTransactionState(statementSql);
        }

        if (statements === 0) throw new Error("Không tìm thấy câu lệnh SQL có thể thực thi.");
        if (this.transactionDepth === 0 && this.dirty) await this.saveCurrent();

        const endedAt = global.performance?.now?.() ?? Date.now();
        return {
          sql: source,
          results,
          statements,
          affectedRows,
          durationMs: Math.max(0, endedAt - startedAt),
          transactionOpen: this.transactionDepth > 0,
        };
      } catch (error) {
        if (this.transactionDepth === 0 && this.dirty) await this.saveCurrent();
        const endedAt = global.performance?.now?.() ?? Date.now();
        error.execution = {
          sql: source,
          statements,
          affectedRows,
          durationMs: Math.max(0, endedAt - startedAt),
          transactionOpen: this.transactionDepth > 0,
        };
        throw error;
      }
    }

    async saveCurrent() {
      if (!this.database || !this.currentName || this.transactionDepth > 0) return false;
      const exported = this.database.export();
      const now = new Date().toISOString();
      this.currentRecord = {
        name: this.currentName,
        data: arrayBufferFromBytes(exported),
        createdAt: this.currentRecord?.createdAt || now,
        updatedAt: now,
      };
      await this.storage.put(this.currentRecord);
      this.database.run("PRAGMA foreign_keys = ON;");
      this.dirty = false;
      return true;
    }

    async rollbackOpenTransaction() {
      if (this.transactionDepth === 0) return;
      this.database.run("ROLLBACK;");
      this.transactionDepth = 0;
      this.dirty = false;
    }

    async renameDatabase(newName) {
      const normalized = normalizeDatabaseName(newName);
      if (normalized === this.currentName) return normalized;
      if (this.transactionDepth > 0) throw new Error("Hãy COMMIT hoặc ROLLBACK trước khi đổi tên database.");
      if (await this.hasDatabase(normalized)) throw new Error(`Database “${normalized}” đã tồn tại.`);
      if (this.dirty) await this.saveCurrent();
      this.currentRecord = await this.storage.rename(this.currentName, normalized);
      this.currentName = normalized;
      safeLocalStorageSet(ACTIVE_DATABASE_KEY, normalized);
      return normalized;
    }

    async deleteDatabase(name) {
      const normalized = normalizeDatabaseName(name);
      if (normalized === this.currentName && this.transactionDepth > 0) {
        throw new Error("Hãy COMMIT hoặc ROLLBACK trước khi xóa database.");
      }

      if (normalized === this.currentName) {
        this.database?.close();
        this.database = null;
        this.currentName = null;
        this.currentRecord = null;
      }
      await this.storage.delete(normalized);

      let remaining = await this.storage.list();
      if (remaining.length === 0) {
        await this.createDatabase("main", { sample: false });
        remaining = await this.storage.list();
      }
      if (!this.database) await this.switchDatabase(remaining[0].name);
      return this.currentName;
    }

    async importDatabase(fileName, bytes) {
      const baseName = String(fileName || "imported")
        .replace(/\.(sqlite3?|db)$/i, "")
        .trim() || "imported";
      const name = await this.uniqueName(baseName);
      await this.createDatabase(name, { bytes });
      return name;
    }

    async exportCurrent() {
      if (this.transactionDepth > 0) throw new Error("Hãy COMMIT hoặc ROLLBACK trước khi xuất database.");
      if (this.dirty) await this.saveCurrent();
      const record = await this.storage.get(this.currentName);
      return new Uint8Array(record.data);
    }

    getSchema() {
      const master = this.database.exec(`
        SELECT type, name, tbl_name, sql
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY CASE type
          WHEN 'table' THEN 1
          WHEN 'view' THEN 2
          WHEN 'index' THEN 3
          WHEN 'trigger' THEN 4
          ELSE 5
        END, name COLLATE NOCASE;
      `);
      const rows = master[0]?.values || [];

      return rows.map(([type, name, tableName, sql]) => {
        const object = { type, name, tableName, sql: sql || "", columns: [], foreignKeys: [] };
        if (type === "table" || type === "view") {
          const columnResult = this.database.exec(`PRAGMA table_info(${quoteSqlString(name)});`);
          object.columns = (columnResult[0]?.values || []).map((column) => ({
            cid: column[0],
            name: column[1],
            type: column[2] || "ANY",
            notNull: Boolean(column[3]),
            defaultValue: column[4],
            primaryKey: Boolean(column[5]),
          }));
          if (type === "table") {
            const foreignKeyResult = this.database.exec(`PRAGMA foreign_key_list(${quoteSqlString(name)});`);
            object.foreignKeys = (foreignKeyResult[0]?.values || []).map((key) => ({
              table: key[2],
              from: key[3],
              to: key[4],
              onUpdate: key[5],
              onDelete: key[6],
            }));
          }
        }
        return object;
      });
    }

    getStatus() {
      return {
        name: this.currentName,
        size: this.currentRecord?.data?.byteLength || 0,
        sqliteVersion: this.sqliteVersion,
        storageMode: this.storage.mode,
        transactionOpen: this.transactionDepth > 0,
      };
    }
  }

  global.SQLiteLab = {
    DatabaseStorage,
    SQLiteWorkspace,
    SAMPLE_DATABASE_SQL,
    normalizeDatabaseName,
  };
})(globalThis);
