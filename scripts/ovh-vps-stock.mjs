// Operations tool: where each OVHcloud VPS model can be ordered now, from OVHcloud's public order API (no
// account, no key: the catalog and GET /vps/order/rule/datacenter/aggregated, the stock the order funnel
// shows). With --watch it asks again every minute, prints what changed and says when a model gets stock in a
// watched datacenter (a macOS notification, the terminal bell and, with --email, an e-mail through Resend).
// See docs/deploy.md, "One server".
//
// Usage: node [--env-file=.env.notifier] scripts/ovh-vps-stock.mjs [--all] [--windows] [--plans <planCode,…>]
//          [--watch] [--every <seconds>] [--email <address>] [--test-email]
//   default        the latest VPS range, the datacenters in France (the privacy policy says the server is
//                  there), Linux
//   --all          every datacenter
//   --windows      the stock for Windows instead of Linux
//   --plans        only these plan codes (e.g. vps-2027-model1,vps-2027-model2)
//   --watch        ask again every --every seconds (default 60, at least 15) until stopped (Ctrl-C); keep the
//                  Mac awake with `caffeinate -i node …`
//   --email        also e-mail this address when stock comes back (at most once an hour per model and
//                  datacenter), with RESEND_API_KEY and EMAIL_FROM (default BehyndMe <alertes@behyndme.com>)
//                  from the environment: --env-file=.env.notifier gives the notifier's
//   --test-email   send one e-mail at once, to check that it arrives
// Exit code without --watch: 0 when a watched datacenter has stock, 1 when none has, 2 when the API failed.
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const API = "https://eu.api.ovh.com/v1";
const SUBSIDIARY = "FR";

/** The order API's datacenter codes, with their place. */
export const DATACENTERS = {
  GRA: "Gravelines",
  SBG: "Strasbourg",
  "EU-WEST-RBX": "Roubaix",
  BHS: "Beauharnois (CA)",
  DE: "Limburg (DE)",
  "EU-SOUTH-MIL": "Milan (IT)",
  UK: "London (UK)",
  WAW: "Warsaw (PL)",
  SGP: "Singapore",
  SYD: "Sydney (AU)",
  YNM: "Mumbai (IN)",
};
export const FRANCE = ["GRA", "SBG", "EU-WEST-RBX"];

/** The models of the latest range in the public catalog (`vps-<year>-model<n>`), cheapest first. */
export function latestRange(catalog) {
  const models = catalog.plans
    .map((plan) => ({ plan, match: /^vps-(\d{4})-model(\d+)$/.exec(plan.planCode) }))
    .filter(({ match }) => match);
  const year = Math.max(...models.map(({ match }) => Number(match[1])));
  return models
    .filter(({ match }) => Number(match[1]) === year)
    .sort((a, b) => Number(a.match[2]) - Number(b.match[2]))
    .map(({ plan }) => describePlan(catalog, plan));
}

/** Name, sizes and monthly price without commitment (excl. VAT) of a catalog plan. */
export function describePlan(catalog, plan) {
  const product = catalog.products.find((p) => p.name === plan.product);
  const monthly = plan.pricings.find(
    (p) =>
      p.mode === "default" && p.commitment === 0 && p.intervalUnit === "month" && p.capacities.includes("renew"),
  );
  return {
    planCode: plan.planCode,
    name: plan.invoiceName ?? plan.planCode,
    sizes: product?.description?.replace(/^VPS /, "") ?? "",
    monthly: monthly ? monthly.price / 1e8 : null,
  };
}

/** "available", "preorder" or "out", with the announced delivery delay in days. */
export function stockOf(datacenter, os) {
  const status = os === "windows" ? datacenter.windowsStatus : datacenter.linuxStatus;
  const stock = status === "available" ? "available" : status === "out-of-stock-preorder-allowed" ? "preorder" : "out";
  return { stock, days: datacenter.daysBeforeDelivery ?? 0 };
}

export function stockLabel({ stock, days }) {
  if (stock === "available") return days > 0 ? `AVAILABLE (${days} d)` : "AVAILABLE";
  if (stock === "preorder") return `pre-order (${days} d)`;
  return "out of stock";
}

/** Map "planCode datacenter" → stock, for the datacenters asked for (all when `datacenters` is null). */
export function snapshot(aggregated, { datacenters, os }) {
  const result = new Map();
  for (const model of aggregated.models) {
    for (const dc of model.datacenters) {
      if (datacenters && !datacenters.includes(dc.datacenter)) continue;
      result.set(`${model.planCode} ${dc.datacenter}`, stockOf(dc, os));
    }
  }
  return result;
}

/** What changed between two snapshots (a key missing from `before` counts as out of stock). */
export function changes(before, after) {
  const out = [];
  for (const [key, now] of after) {
    const was = before.get(key) ?? { stock: "out", days: 0 };
    if (was.stock !== now.stock || was.days !== now.days) out.push({ key, was, now });
  }
  return out;
}

/** The keys of a snapshot that can be ordered (available, or pre-order). */
export function openings(snap) {
  return [...snap].filter(([, s]) => s.stock !== "out").map(([key]) => key);
}

export function placeOf(key) {
  const dc = key.split(" ")[1];
  return DATACENTERS[dc] ?? dc;
}

/** The datacenters of a snapshot: those of France first, then in the order of DATACENTERS, then the others. */
export function datacentersOf(snap) {
  const known = Object.keys(DATACENTERS);
  const rank = (dc) => (known.includes(dc) ? known.indexOf(dc) : known.length);
  return [...new Set([...snap.keys()].map((key) => key.split(" ")[1]))].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
}

/** The models (name, price, sizes), then one row per datacenter and one column per model. */
export function table(plans, snap, datacenters) {
  const align = (rows) => {
    const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
    return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("   ").trimEnd());
  };
  const legend = align(
    plans.map((p) => [p.name, `${p.monthly === null ? "?" : p.monthly.toFixed(2)} €/mo`, p.sizes]),
  );
  const grid = align([
    ["", ...plans.map((p) => p.name)],
    ...datacenters.map((dc) => [
      DATACENTERS[dc] ?? dc,
      ...plans.map((p) => {
        const s = snap.get(`${p.planCode} ${dc}`);
        return s ? stockLabel(s) : "—";
      }),
    ]),
  ]);
  return [...legend, "", ...grid].join("\n");
}

/** The AppleScript of a notification, with the text's quotes and backslashes escaped. */
export function notificationScript(text) {
  const escaped = text.replace(/[\\"]/g, (c) => `\\${c}`);
  return `display notification "${escaped}" with title "OVHcloud VPS" sound name "Glass"`;
}

function notify(text) {
  process.stdout.write("\x07");
  if (process.platform === "darwin") execFile("osascript", ["-e", notificationScript(text)], () => {});
}

export const EMAIL_COOLDOWN_MS = 3_600_000;

/** The keys to e-mail about now: not e-mailed within the cooldown. Records them in `lastMailed`. */
export function dueForEmail(keys, lastMailed, nowMs, cooldownMs = EMAIL_COOLDOWN_MS) {
  const due = keys.filter((key) => !(nowMs - (lastMailed.get(key) ?? -Infinity) < cooldownMs));
  for (const key of due) lastMailed.set(key, nowMs);
  return due;
}

/** Subject and text of the e-mail saying where stock came back. */
export function openingEmail(lines) {
  return {
    subject: lines.length === 1 ? `OVHcloud VPS: ${lines[0]}` : `OVHcloud VPS: ${lines.length} models can be ordered`,
    text: [
      "Can be ordered now:",
      ...lines.map((line) => `- ${line}`),
      "",
      "Order: https://www.ovhcloud.com/fr/vps/",
      "Stock can go again within minutes.",
      "",
      "Sent by scripts/ovh-vps-stock.mjs (behandme).",
    ].join("\n"),
  };
}

/** Resend's request for one plain-text e-mail. */
export function emailRequest({ key, from, to, subject, text }) {
  return {
    url: "https://api.resend.com/emails",
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(20_000),
    },
  };
}

export async function sendEmail(mail) {
  const { url, init } = emailRequest(mail);
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Resend: HTTP ${response.status} ${await response.text()}`);
}

async function getJson(path) {
  const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

async function withRetries(work, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await work();
    } catch (error) {
      if (i >= attempts) throw error;
    }
  }
}

const time = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      all: { type: "boolean", default: false },
      windows: { type: "boolean", default: false },
      plans: { type: "string" },
      watch: { type: "boolean", default: false },
      every: { type: "string", default: "60" },
      email: { type: "string" },
      "test-email": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "node [--env-file=.env.notifier] scripts/ovh-vps-stock.mjs [--all] [--windows] [--plans <planCode,…>] " +
        "[--watch] [--every <s>] [--email <address>] [--test-email]",
    );
    return 0;
  }
  const os = values.windows ? "windows" : "linux";
  let mail = null;
  if (values.email || values["test-email"]) {
    if (!values.email?.includes("@")) throw new Error("--email <address> is needed to send an e-mail");
    if (!values.watch && !values["test-email"]) throw new Error("--email works with --watch");
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set: node --env-file=.env.notifier scripts/ovh-vps-stock.mjs …");
    }
    mail = {
      key: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM || "BehyndMe <alertes@behyndme.com>",
      to: values.email,
    };
  }
  if (values["test-email"]) {
    await sendEmail({
      ...mail,
      subject: "OVHcloud VPS: test of the stock alert",
      text: "The stock alert can e-mail you.\n\nSent by scripts/ovh-vps-stock.mjs (behandme).",
    });
    console.log(`Test e-mail sent to ${mail.to}.\n`);
  }
  const catalog = await withRetries(() => getJson(`/order/catalog/public/vps?ovhSubsidiary=${SUBSIDIARY}`));
  const plans = values.plans
    ? values.plans.split(",").map((code) => {
        const plan = catalog.plans.find((p) => p.planCode === code.trim());
        if (!plan) throw new Error(`Unknown plan code ${code} (see the public catalog)`);
        return describePlan(catalog, plan);
      })
    : latestRange(catalog);
  const stockPath = `/vps/order/rule/datacenter/aggregated?ovhSubsidiary=${SUBSIDIARY}&planCodes=${plans
    .map((p) => p.planCode)
    .join(",")}`;
  const watched = values.all ? null : FRANCE;

  let snap = snapshot(await withRetries(() => getJson(stockPath)), { datacenters: watched, os });
  const shown = watched ?? datacentersOf(snap);
  console.log(`OVHcloud VPS, ${time()}, ${os === "windows" ? "Windows" : "Linux"}, prices excl. VAT without commitment\n`);
  console.log(table(plans, snap, shown));
  if (!values.watch) return openings(snap).length > 0 ? 0 : 1;

  const everyMs = Math.max(15, Number(values.every) || 60) * 1000;
  const names = new Map(plans.map((p) => [p.planCode, p.name]));
  const prices = new Map(plans.map((p) => [p.planCode, p.monthly]));
  const describe = (key) => `${names.get(key.split(" ")[0])} at ${placeOf(key)}`;
  const lastMailed = new Map();
  const alert = async (keys) => {
    notify(`Can be ordered now: ${keys.map(describe).join(", ")}`);
    if (!mail) return;
    const due = dueForEmail(keys, lastMailed, Date.now());
    if (!due.length) return;
    const lines = due.map((key) => {
      const price = prices.get(key.split(" ")[0]);
      return `${describe(key)}${price === null ? "" : ` (${price.toFixed(2)} €/mo excl. VAT)`}`;
    });
    try {
      await sendEmail({ ...mail, ...openingEmail(lines) });
      console.log(`${time()}  e-mail sent to ${mail.to}`);
    } catch (error) {
      console.log(`${time()}  e-mail failed: ${error.message}`);
    }
  };
  const opened = openings(snap);
  if (opened.length) await alert(opened);
  console.log(`\nWatching every ${everyMs / 1000} s (Ctrl-C to stop)${mail ? `, e-mails to ${mail.to}` : ""}.`);
  for (;;) {
    await sleep(everyMs);
    let next;
    try {
      next = snapshot(await getJson(stockPath), { datacenters: watched, os });
    } catch (error) {
      console.log(`${time()}  API unreachable (${error.message}); next try in ${everyMs / 1000} s`);
      continue;
    }
    const changed = changes(snap, next);
    for (const { key, was, now } of changed) {
      console.log(`${time()}  ${describe(key)}: ${stockLabel(was)} → ${stockLabel(now)}`);
    }
    const fresh = changed.filter(({ was, now }) => was.stock === "out" && now.stock !== "out");
    if (fresh.length) await alert(fresh.map(({ key }) => key));
    if (!changed.length && process.stdout.isTTY) process.stdout.write(`${time()}  no change\r`);
    snap = next;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(2);
    },
  );
}
