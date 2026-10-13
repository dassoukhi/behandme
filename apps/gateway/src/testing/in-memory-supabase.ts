/**
 * Minimal in-memory stand-in for the supabase-js query builder, covering the
 * subset the services use (select/insert/update/delete with eq, in, or, order,
 * limit, single, maybeSingle). Lets access-control specs run the real service
 * code without a database. Test-only.
 */
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
type Predicate = (row: Row) => boolean;

/** Parses the `col.op.value` comma list produced by participantFilter. */
function parseOr(filter: string): Predicate {
  const clauses = filter.split(/,(?![^{]*})/).map((clause) => {
    const [column, op, ...rest] = clause.split(".");
    const value = rest.join(".");
    if (op === "eq") return (row: Row) => row[column] === value;
    if (op === "cs") {
      const items = value.replace(/^{|}$/g, "").split(",");
      return (row: Row) =>
        items.every((item) => (row[column] ?? []).includes(item));
    }
    throw new Error(`Unsupported or() operator: ${op}`);
  });
  return (row) => clauses.some((matches) => matches(row));
}

/**
 * Column list of a select: plain columns and embedded relations ("alias:table!fk(*)").
 * Embedded relations are kept from the seeded row under their alias.
 */
function parseColumns(select: string): string[] | null {
  const parts = select
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.includes("*")) return null;
  return parts.map((part) => part.split(":")[0].split("(")[0].trim());
}

function project(row: Row, columns: string[] | null): Row {
  if (!columns) return row;
  return Object.fromEntries(
    columns.filter((c) => c in row).map((c) => [c, row[c]]),
  );
}

class Query implements PromiseLike<{ data: any; error: null }> {
  private filters: Predicate[] = [];
  private action: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row[] | Row | undefined;
  private returning = false;
  private mode: "many" | "single" | "maybeSingle" = "many";
  private max = Infinity;
  private columns: string[] | null = null; // null = every column

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
  ) {}

  select(columns = "*") {
    if (this.action !== "select") this.returning = true;
    this.columns = parseColumns(columns);
    return this;
  }
  insert(rows: Row[]) {
    this.action = "insert";
    this.payload = rows;
    return this;
  }
  update(values: Row) {
    this.action = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  or(filter: string) {
    this.filters.push(parseOr(filter));
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  private run(): Row[] {
    const rows = (this.tables[this.table] ??= []);
    const matches = (row: Row) => this.filters.every((f) => f(row));
    switch (this.action) {
      case "insert": {
        const inserted = (this.payload as Row[]).map((r) => ({ ...r }));
        rows.push(...inserted);
        return inserted;
      }
      case "update": {
        const updated = rows.filter(matches);
        updated.forEach((row) => Object.assign(row, this.payload));
        return updated;
      }
      case "delete": {
        const deleted = rows.filter(matches);
        this.tables[this.table] = rows.filter((row) => !matches(row));
        return deleted;
      }
      default:
        return rows.filter(matches).slice(0, this.max);
    }
  }

  then<R1, R2>(
    onfulfilled?: (value: { data: any; error: null }) => R1 | PromiseLike<R1>,
    onrejected?: (reason: unknown) => R2 | PromiseLike<R2>,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => {
        const rows = this.run().map((r) =>
          project(structuredClone(r), this.columns),
        );
        const data =
          this.mode === "many"
            ? this.action === "select" || this.returning
              ? rows
              : null
            : (rows[0] ?? null);
        if (this.mode === "single" && !data) {
          throw new Error("single() returned no rows");
        }
        return { data, error: null as null };
      })
      .then(onfulfilled, onrejected);
  }
}

export class InMemorySupabase {
  constructor(readonly tables: Tables) {}

  from(table: string) {
    return new Query(this.tables, table);
  }

  rpc(): never {
    throw new Error("rpc is not supported by InMemorySupabase");
  }
}

/** Shape of SupabaseService expected by the services. */
export function fakeSupabaseService(tables: Tables) {
  const client = new InMemorySupabase(tables);
  return { getClient: () => client } as any;
}
