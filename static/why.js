// 왜 붙이기: ① 산출 근거 대조 ② 원인 단계의 '가장 큰 덩어리' 계산. 순수 함수라 node 에서도 시험한다.
import { stripSql } from "./guard.js";

let schemaCache = null;
export async function loadSchema() {
  if (!schemaCache) schemaCache = await (await fetch("schema.json")).json();
  return schemaCache;
}

const norm = (s) => String(s).replace(/"/g, "").trim().toLowerCase();

// SQL 이 실제로 읽는 테이블 이름(FROM · JOIN 뒤, CTE 이름 제외)
export function extractTables(sql) {
  let s = stripSql(sql) || "";
  const fn = /\b(extract|substring|trim|position|overlay)\s*\((?:[^()]|\([^()]*\))*\)/gi;
  s = s.replace(fn, " "); // EXTRACT(MONTH FROM col) 의 FROM 은 테이블이 아니다
  const ctes = new Set();
  for (const m of s.matchAll(/(?:\bwith\s+(?:recursive\s+)?|,\s*)("?[\w가-힣]+"?)\s+as\s*(?:not\s+materialized\s*)?\(/gi)) ctes.add(norm(m[1]));
  const tables = new Set();
  for (const m of s.matchAll(/\b(?:from|join)\s+("?[\w가-힣.]+"?)/gi)) {
    const t = norm(m[1]);
    if (!ctes.has(t)) tables.add(t);
  }
  return [...tables];
}

// basis = AI 가 돌려준 {tables, conditions, metric, metric_note}.  어긋나면 issues 에 이유를 담는다.
export function checkBasis(basis, sql, { known = [], metrics = [] } = {}) {
  const issues = [];
  if (!basis || typeof basis !== "object") return { ok: false, issues: ["AI가 산출 근거를 돌려주지 않았습니다."], sqlTables: extractTables(sql) };
  const sqlTables = extractTables(sql);
  const claimed = (Array.isArray(basis.tables) ? basis.tables : []).map(norm);
  const knownSet = new Set(known.map(norm));
  for (const t of claimed) if (!sqlTables.includes(t)) issues.push(`AI는 '${t}'를 읽었다고 했지만 SQL에는 없습니다.`);
  for (const t of sqlTables) if (!claimed.includes(t)) issues.push(`SQL이 읽는 '${t}'가 AI의 근거 설명에 빠져 있습니다.`);
  for (const t of sqlTables) if (knownSet.size && !knownSet.has(t)) issues.push(`'${t}'는 지금 올라와 있는 테이블이 아닙니다.`);

  const names = metrics.map((m) => m.name);
  const metric = basis.metric;
  if (metric && metric !== "해당 없음" && !names.includes(metric)) issues.push(`'${metric}'는 데이터 사전에 없는 지표 이름입니다.`);
  const condText = (Array.isArray(basis.conditions) ? basis.conditions : []).join(" ");
  const sqlText = stripSql(sql) || "";
  if (metric === "fail률" && !/\battempt\b/i.test(sqlText)) issues.push("fail률은 시도 차수(attempt) 기준인데 SQL에 attempt 조건이 없습니다.");
  if (/첫\s*시도|attempt\s*=\s*1/i.test(condText) && !/attempt\s*=\s*1/i.test(sqlText)) issues.push("근거 설명은 '첫 시도'라고 했지만 SQL에 attempt = 1 이 없습니다.");
  return { ok: issues.length === 0, issues, sqlTables };
}

// 결과 테이블에서 chunk_value 가 가장 큰 행과 그 비중. 라벨 = 숫자가 아닌 컬럼들.
export function biggestChunk(rows, valueCol = "chunk_value") {
  if (!rows || !rows.length) return { error: "쪼갠 결과가 비어 있습니다." };
  if (!(valueCol in rows[0])) return { error: `${valueCol} 컬럼이 없어 가장 큰 덩어리를 계산하지 못했습니다.` };
  const cols = Object.keys(rows[0]);
  const labelCols = cols.filter((c) => c !== valueCol && rows.some((r) => r[c] !== null && typeof r[c] === "string"));
  let total = 0, top = null, tie = 0;
  for (const r of rows) {
    const v = Number(r[valueCol]);
    if (!Number.isFinite(v)) continue;
    total += v;
    if (top === null || v > top.v) { top = { r, v }; tie = 1; } else if (v === top.v) tie++;
  }
  if (!top || total <= 0) return { error: "쪼갠 값의 합이 0이라 비중을 계산할 수 없습니다." };
  return {
    labels: labelCols.map((c) => String(top.r[c])),
    labelCols,
    value: top.v,
    total,
    pct: Math.round((1000 * top.v) / total) / 10,
    n: rows.length,
    tie,
  };
}
