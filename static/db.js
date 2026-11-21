// DuckDB-WASM: 데이터는 브라우저 안에서만 읽는다. CDN 버전 고정.
import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";

const TABLES = ["equipment", "lots", "process_runs", "test_results", "equipment_daily", "maintenance_logs"];
const MAX_ROWS = 10000;
let ready = null;

export function start(onStatus = () => {}) {
  if (!ready) ready = init(onStatus);
  return ready;
}

async function init(onStatus) {
  onStatus("DuckDB 준비 중…");
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = await db.connect();
  const counts = {};
  for (const t of TABLES) {
    onStatus(`${t} 읽는 중…`);
    const text = await (await fetch(`data/${t}.csv`)).text(); // 디코딩하면서 BOM 이 빠진다
    await db.registerFileText(`${t}.csv`, text);
    await conn.query(`CREATE OR REPLACE TABLE ${t} AS SELECT * FROM read_csv('${t}.csv', header = true)`);
    counts[t] = Number((await conn.query(`SELECT count(*) AS n FROM ${t}`)).toArray()[0].n);
  }
  return { db, conn, counts };
}

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

// 읽기 전용 검사를 이미 통과한 SQL 만 넘긴다. 결과 {columns, rows, truncated}
export async function runQuery(sql) {
  const { conn } = await start();
  const desc = (await conn.query(`DESCRIBE SELECT * FROM (${sql})`)).toArray().map((r) => r.toJSON());
  const repl = [];
  for (const d of desc) {
    const t = String(d.column_type).toUpperCase();
    if (/^(DECIMAL|HUGEINT|UHUGEINT|UBIGINT)/.test(t)) repl.push(`CAST(${q(d.column_name)} AS DOUBLE) AS ${q(d.column_name)}`);
    else if (/^(DATE|TIME|TIMESTAMP|INTERVAL)/.test(t)) repl.push(`CAST(${q(d.column_name)} AS VARCHAR) AS ${q(d.column_name)}`);
  }
  const sel = repl.length ? `* REPLACE (${repl.join(", ")})` : "*";
  const res = await conn.query(`SELECT ${sel} FROM (${sql}) LIMIT ${MAX_ROWS}`);
  const columns = res.schema.fields.map((f) => f.name);
  const rows = res.toArray().map((r) => {
    const o = r.toJSON();
    for (const k of columns) if (typeof o[k] === "bigint") o[k] = Number(o[k]);
    return o;
  });
  return { columns, rows, truncated: rows.length >= MAX_ROWS };
}

// 지금 올라와 있는 모든 테이블: [{name, rows, columns:[{name, type}]}]  (기본 6개 먼저)
export async function liveTables() {
  const { conn } = await start();
  const cols = (await conn.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' ORDER BY table_name, ordinal_position"
  )).toArray().map((r) => r.toJSON());
  const by = new Map();
  for (const c of cols) {
    if (!by.has(c.table_name)) by.set(c.table_name, []);
    by.get(c.table_name).push({ name: c.column_name, type: String(c.data_type) });
  }
  const names = [...by.keys()].sort((a, b) => {
    const ia = TABLES.indexOf(a), ib = TABLES.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const out = [];
  for (const name of names) {
    const n = Number((await conn.query(`SELECT count(*) AS n FROM ${q(name)}`)).toArray()[0].n);
    out.push({ name, rows: n, columns: by.get(name) });
  }
  return out;
}

export async function tableNames() {
  return (await liveTables()).map((t) => t.name);
}

// 올린 파일 → 테이블. 같은 이름이 있으면 바꾼다. 테이블에 올라간 행 수를 돌려준다. (브라우저 밖으로 나가지 않는다)
export async function loadCsvTable(name, csvText) {
  const { db, conn } = await start();
  const f = `__upload_${Date.now()}.csv`;
  await db.registerFileText(f, csvText);
  try {
    await conn.query(`CREATE OR REPLACE TABLE ${q(name)} AS SELECT * FROM read_csv('${f}', header = true, sample_size = -1)`);
  } finally {
    await db.dropFile(f);
  }
  return Number((await conn.query(`SELECT count(*) AS n FROM ${q(name)}`)).toArray()[0].n);
}

export const baseTableNames = TABLES;
