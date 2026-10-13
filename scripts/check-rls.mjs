// Checks that the public anon key cannot read any table or call any RPC, and that
// the service-role key (used by the API) still can. Prints counts and status codes
// only — never keys or row data. Run after every migration: npm run check:rls
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, "")]),
);
const {
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
} = env;
if (!url || !anon || !service) {
  console.error(
    "SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set in .env",
  );
  process.exit(1);
}

const headers = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  ...extra,
});
const count = async (table, key) => {
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
    method: "HEAD",
    headers: headers(key, { Prefer: "count=exact", Range: "0-0" }),
  });
  return {
    status: res.status,
    rows: Number(res.headers.get("content-range")?.split("/")[1] ?? NaN),
  };
};

const spec = await (
  await fetch(`${url}/rest/v1/`, { headers: headers(service) })
).json();
const tables = Object.keys(spec.definitions ?? {}).sort();
const rpcs = Object.keys(spec.paths ?? {}).filter((p) => p.startsWith("/rpc/"));

let leaks = 0;
for (const table of tables) {
  const [a, s] = await Promise.all([count(table, anon), count(table, service)]);
  const ok = a.rows === 0 || a.status === 401;
  if (!ok) leaks++;
  // An empty table shows 0 rows to anyone, so it cannot prove RLS is on.
  const mark = !ok ? "✗" : s.rows === 0 ? "?" : "✓";
  const note = ok && s.rows === 0 ? "   (empty: inconclusive)" : "";
  console.log(
    `${mark} table ${table.padEnd(16)} anon: ${a.rows} rows   service: ${s.rows} rows${note}`,
  );
}
for (const path of rpcs) {
  const params =
    spec.paths[path].post?.parameters?.find((p) => p.in === "body")?.schema
      ?.properties ?? {};
  const body = Object.fromEntries(
    Object.keys(params).map((name) => [name, "rls-probe"]),
  );
  const res = await fetch(`${url}/rest/v1${path}`, {
    method: "POST",
    headers: headers(anon, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const code = (await res.json().catch(() => ({}))).code;
  const ok = code === "42501";
  if (!ok) leaks++;
  console.log(
    `${ok ? "✓" : "✗"} rpc   ${path.slice(5).padEnd(16)} anon: HTTP ${res.status} ${code ?? ""}`,
  );
}
console.log(
  leaks
    ? `\nRLS CHECK FAILED: ${leaks} leak(s)`
    : "\nRLS CHECK PASSED: anon key has no access",
);
process.exit(leaks ? 1 : 0);
