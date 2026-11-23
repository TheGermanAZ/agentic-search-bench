// A thin wrapper over Node's built-in SQLite (node:sqlite, with FTS5) that keeps the small query API the code was
// written against: db.query(sql).all/get/iterate(...params), db.prepare(sql).run(...params), db.exec, db.close.
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

type Params = SQLInputValue[];

export class Statement {
  constructor(private readonly s: StatementSync) {}
  all(...params: Params): unknown[] {
    return this.s.all(...params);
  }
  get(...params: Params): unknown {
    return this.s.get(...params) ?? null;
  }
  iterate(...params: Params): Iterable<unknown> {
    return this.s.iterate(...params);
  }
  run(...params: Params) {
    return this.s.run(...params);
  }
}

export class Database {
  private readonly db: DatabaseSync;
  private readonly cache = new Map<string, Statement>();
  constructor(path: string, opts: { readonly?: boolean } = {}) {
    this.db = new DatabaseSync(path, { readOnly: !!opts.readonly });
  }
  /** Cached prepared statement, like bun:sqlite's query(). */
  query(sql: string): Statement {
    let s = this.cache.get(sql);
    if (!s) {
      s = new Statement(this.db.prepare(sql));
      this.cache.set(sql, s);
    }
    return s;
  }
  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
  close(): void {
    this.db.close();
  }
}
