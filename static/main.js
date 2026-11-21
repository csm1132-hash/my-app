import { checkReadOnly } from "./guard.js";
import { start, runQuery, tableNames, liveTables } from "./db.js";
import { checkBasis, biggestChunk, loadSchema } from "./why.js";
import { el, renderTable, MAX_SHOW } from "./table.js";
import { init as initPrepared, saveQuestion, markStale } from "./prepared.js";
import { initUpload } from "./upload.js";
import { renderTables } from "./tables.js";

const $ = (id) => document.getElementById(id);
const MAX_AI_ROWS = 50; // AI 로 보내는 최대 행

// 탭 전환
document.querySelectorAll("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== b.dataset.tab));
    if (b.dataset.tab === "tables") renderTables();
  })
);

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `오류 ${res.status}`);
  return data;
}

// ① 산출 근거: AI 의 설명을 SQL 속 테이블 이름과 대조한다. 지표 정의 문장은 AI 가 아니라 schema.json 에서 가져온다.
async function showBasis(basis, sql) {
  const box = $("basis");
  box.replaceChildren();
  const s = await loadSchema();
  const known = await tableNames();
  const chk = checkBasis(basis, sql, { known, metrics: s.metrics });
  box.append(el("p", chk.ok ? "대조 결과: 일치" : "확인 필요", chk.ok ? "ok" : "bad"));
  if (!chk.ok) {
    const ul = el("ul", undefined, "bad");
    chk.issues.forEach((i) => ul.append(el("li", i)));
    box.append(ul);
  }
  if (basis) {
    box.append(el("p", `읽은 테이블 (SQL 기준): ${chk.sqlTables.join(", ") || "없음"}`));
    box.append(el("p", `AI가 말한 테이블: ${(basis.tables || []).join(", ") || "없음"}`, "todo"));
    const ul = el("ul");
    (basis.conditions || []).forEach((c) => ul.append(el("li", c)));
    box.append(el("p", "조건:"), ul);
    const m = s.metrics.find((x) => x.name === basis.metric);
    box.append(el("p", `쓴 지표 정의: ${basis.metric}${m ? " — " + m.definition + " (데이터 사전)" : ""}`));
    if (basis.metric_note) box.append(el("p", `적용 방식: ${basis.metric_note}`, "todo"));
  }
}

// ② 원인 한 단계: 실패해도 ①과 원래 결과는 그대로 둔다.
async function showCause(question, sql, first) {
  const box = $("cause");
  box.replaceChildren(el("p", "원인 SQL을 쓰는 중…", "todo"));
  try {
    const why = await post("/api/why", {
      question,
      sql,
      tables: await liveTables(),
      columns: first.columns,
      rows: first.rows.slice(0, MAX_AI_ROWS), // 집계 결과 50행 이하만
    });
    const g = checkReadOnly(why.cause_sql);
    box.replaceChildren();
    box.append(el("p", why.cause_note, "todo"), el("pre", why.cause_sql));
    if (!g.ok) {
      box.append(el("p", `읽기 전용 검사: 막힘 — ${g.reason}`, "bad"));
      return;
    }
    const res = await runQuery(g.sql);
    const big = biggestChunk(res.rows);
    if (big.error) {
      box.append(el("p", big.error, "bad"));
    } else {
      const line = `가장 큰 덩어리: ${big.labels.join(" · ")} — ${why.chunk_label || "값"} ${big.value.toLocaleString()} (전체 ${big.total.toLocaleString()}의 ${big.pct}%, 덩어리 ${big.n}개 중 1위${big.tie > 1 ? `, 같은 값 ${big.tie}개` : ""})`;
      box.append(el("p", line, "hl"));
    }
    box.append(el("p", `쪼갠 결과 ${res.rows.length}행${res.rows.length > MAX_SHOW ? ` (화면에는 ${MAX_SHOW}행)` : ""}`, "todo"));
    const tb = el("div", undefined, "tbl");
    renderTable(tb, res);
    box.append(tb);
  } catch (e) {
    box.append(el("p", `원인 단계를 만들지 못했습니다: ${e.message}`, "bad"));
  }
}

let last = null; // 마지막으로 성공한 묻기 {question, sql}

$("saveBtn").addEventListener("click", () => {
  const m = $("saveMsg");
  if (!last) { m.textContent = "저장할 SQL이 없습니다."; m.className = "bad"; return; }
  const r = saveQuestion({ name: $("saveName").value, question: last.question, sql: last.sql });
  m.textContent = r.ok ? "저장했습니다. '준비된 질문' 탭의 '내가 저장한 질문'에 있습니다." : `저장하지 못했습니다: ${r.reason}`;
  m.className = r.ok ? "ok" : "bad";
  if (r.ok) $("saveName").value = "";
});

async function ask() {
  const question = $("q").value.trim();
  if (!question) return;
  $("go").disabled = true;
  $("status").textContent = "AI가 SQL을 쓰는 중…";
  $("out").hidden = true;
  last = null;
  $("saveBox").hidden = true;
  $("saveMsg").textContent = "";
  try {
    const tables = await liveTables(); // 테이블 이름 · 컬럼 이름 · 타입 · 행 수만 (데이터 행 없음)
    const data = await post("/api/sql", { question, tables }); // 질문만 보낸다. 테이블 설명은 서버가 schema.json 에서 붙인다.
    $("sql").textContent = data.sql;
    const g = checkReadOnly(data.sql);
    $("guard").textContent = g.ok ? "읽기 전용 검사: 통과" : `읽기 전용 검사: 막힘 — ${g.reason}`;
    $("guard").className = g.ok ? "ok" : "bad";
    $("out").hidden = false;
    $("resinfo").textContent = "";
    $("result").replaceChildren();
    $("basis").replaceChildren();
    $("cause").replaceChildren();
    if (!g.ok) { $("status").textContent = ""; return; }

    $("status").textContent = "실행 중…";
    await start();
    let first;
    try {
      first = await runQuery(g.sql);
    } catch (e) {
      $("resinfo").textContent = `실행 실패: ${e.message}`;
      $("resinfo").className = "bad";
      await showBasis(data.basis, g.sql); // 근거는 그래도 보여 준다
      return;
    }
    $("resinfo").className = "todo";
    $("resinfo").textContent = `${first.rows.length}행${first.rows.length > MAX_SHOW ? ` (화면에는 ${MAX_SHOW}행)` : ""}`;
    renderTable($("result"), first);
    last = { question, sql: g.sql };
    $("saveBox").hidden = false;
    await showBasis(data.basis, g.sql);
    $("status").textContent = "";
    await showCause(question, g.sql, first);
  } catch (e) {
    $("status").textContent = e.message;
  } finally {
    $("go").disabled = false;
  }
}

$("go").addEventListener("click", ask);
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) ask(); });

// 데이터 적재
start((m) => ($("dbstatus").textContent = m))
  .then(({ counts }) => {
    $("dbstatus").textContent = "데이터 적재 완료 — " + Object.entries(counts).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(" · ");
    const p = new URLSearchParams(location.search).get("q"); // 주소로 질문 바로 실행 (?q=...)
    if (p) { $("q").value = p; ask(); }
  })
  .catch((e) => { $("dbstatus").textContent = `데이터 준비 실패: ${e.message}`; $("dbstatus").className = "bad"; });

initPrepared();
initUpload({
  onChange: (names) => {
    markStale(names); // 준비된 질문은 자동으로 다시 계산하지 않는다. 안내만 띄운다.
    renderTables();
  },
});
