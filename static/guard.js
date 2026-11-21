// SQL 읽기 전용 검사. 브라우저와 node 양쪽에서 쓴다. AI 가 쓴 SQL 이든 내가 쓴 SQL 이든 같은 검사를 거친다.
const BLOCKED = [
  "insert", "update", "delete", "drop", "create", "alter", "truncate", "copy", "attach", "detach",
  "install", "load", "pragma", "set", "reset", "call", "export", "import", "checkpoint", "vacuum",
  "use", "begin", "commit", "rollback", "merge", "grant", "revoke", "summarize", "describe", "show", "explain",
];

function stripComments(sql) {
  let out = "", i = 0, q = null;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (q) {
      out += c;
      if (c === q) { if (n === q) { out += n; i += 2; continue; } q = null; }
      i++; continue;
    }
    if (c === "'" || c === '"') { q = c; out += c; i++; continue; }
    if (c === "-" && n === "-") { while (i < sql.length && sql[i] !== "\n") i++; out += " "; continue; }
    if (c === "/" && n === "*") {
      const e = sql.indexOf("*/", i + 2);
      if (e < 0) return null; // 닫히지 않은 주석
      i = e + 2; out += " "; continue;
    }
    out += c; i++;
  }
  return q ? null : out; // 닫히지 않은 따옴표
}

// 주석을 걷고 문자열·따옴표 식별자 내용을 지운 SQL (테이블 이름 대조 등 검사용). 따옴표가 깨졌으면 null.
export function stripSql(sql) {
  const noComment = stripComments(String(sql));
  if (noComment === null) return null;
  return noComment
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
}

export function checkReadOnly(sql) {
  if (typeof sql !== "string" || !sql.trim()) return { ok: false, reason: "SQL이 비어 있습니다." };
  const noComment = stripComments(sql);
  if (noComment === null) return { ok: false, reason: "따옴표나 주석이 닫혀 있지 않습니다." };
  if (/\b(from|join)\s*'/i.test(noComment)) return { ok: false, reason: "파일 경로를 직접 읽는 SQL은 실행할 수 없습니다." };
  // 문자열·따옴표 식별자 내용을 지운 뒤 키워드를 본다
  const bare = noComment
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '"x"')
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  if (bare.includes(";")) return { ok: false, reason: "한 번에 한 문장만 실행할 수 있습니다." };
  const first = ((bare.match(/^\(*\s*([a-z_]+)/i) || [])[1] || "").toLowerCase();
  if (first !== "select" && first !== "with") return { ok: false, reason: "읽기(SELECT · WITH)만 실행할 수 있습니다." };
  const words = bare.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || [];
  const hit = words.find((w) => BLOCKED.includes(w));
  if (hit) return { ok: false, reason: `읽기만 가능합니다. '${hit.toUpperCase()}' 는 쓸 수 없습니다.` };
  const fn = words.find((w) => /^read_/.test(w) || /_scan$/.test(w) || w === "glob" || w === "sniff_csv");
  if (fn) return { ok: false, reason: `파일을 읽는 함수(${fn})는 쓸 수 없습니다.` };
  // 실행할 SQL = 주석과 끝 세미콜론만 걷은 원문(문자열 값은 그대로)
  return { ok: true, sql: noComment.trim().replace(/;+\s*$/, "").trim() };
}
