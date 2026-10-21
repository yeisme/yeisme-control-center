// Minimal ambient types for bun:sqlite, used only when the server runs under Bun.
// The Node test runtime never loads this module; the shape mirrors what
// drizzle-orm/bun-sqlite expects from its client.
declare module "bun:sqlite" {
  export type SqliteRow = Record<string, string | number | bigint | boolean | null>;
  export class Statement {
    run(...params: unknown[]): void;
    all(...params: unknown[]): SqliteRow[];
    get(...params: unknown[]): SqliteRow | undefined;
  }
  export class Database {
    constructor(
      path: string,
      options?: { readonly?: boolean; create?: boolean; readwrite?: boolean },
    );
    exec(sql: string): void;
    prepare(sql: string): Statement;
    run(sql: string, ...params: unknown[]): void;
    close(): void;
  }
}
