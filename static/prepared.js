// 준비된 질문 탭: presets/questions.json + 이 브라우저에 저장한 질문. 단추 하나로 지금 올라온 데이터로 다시 계산한다.
import { checkReadOnly } from "./guard.js";
import { start, runQuery } from "./db.js";
import { extractTables, loadSchema } from "./why.js";
import { el, renderTable, MAX_SHOW } from "./table.js";

const KEY = "saved_questions_v1";

export function loadSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function persist(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

// 저장도 읽기 전용 검사를 거친다. 성공하면 {ok:true}, 아니면 {ok:false, reason}
export function saveQuestion({ name, question, sql }) {
  name = String(name || "").trim();
  if (!name) return { ok: false, reason: "이름을 써 주세요." };
  const g = checkReadOnly(sql);
  if (!g.ok) return { ok: false, reason: g.reason };
  const list = loadSaved();
  const item = { id: "s" + Date.now(), name, question: question || "", sql: g.sql, saved_at: new Date().toISOString() };
  const i = list.findIndex((x) => x.name === name); // 같은 이름이면 덮어쓴다
  if (i >= 0) list[i] = item; else list.push(item);
  if (!persist(list)) return { ok: false, reason: "이 브라우저에 저장하지 못했습니다(저장소 사용 불가). 내려받기는 가능합니다." };
  render();
  return { ok: true };
}

async function recompute(item, out, btn) {
  const g = checkReadOnly(item.sql);
  if (!g.ok) { out.replaceChildren(el("p", `읽기 전용 검사: 막힘 — ${g.reason}`, "bad")); return; }
  btn.disabled = true;
  out.replaceChildren(el("p", "계산 중…", "todo"));
  try {
    await start();
    const res = await runQuery(g.sql);
    const when = new Date();
    out.replaceChildren();
    const tables = extractTables(g.sql);
    out.append(el("p", `계산한 시각: ${when.toLocaleString("ko-KR")} · ${res.rows.length}행${res.rows.length > MAX_SHOW ? ` (화면에는 ${MAX_SHOW}행)` : ""} · 읽은 테이블: ${tables.join(", ") || "없음"}`, "info"));
    const tb = el("div", undefined, "tbl");
    renderTable(tb, res);
    out.append(tb);
    if (item.metrics && item.metrics.length) {
      const s = await loadSchema();
      const ul = el("ul", undefined, "todo");
      item.metrics.forEach((n) => {
        const m = s.metrics.find((x) => x.name === n);
        if (m) ul.append(el("li", `${m.name}: ${m.definition}`));
      });
      out.append(el("p", "쓴 지표 정의 (데이터 사전):", "todo"), ul);
    }
  } catch (e) {
    out.replaceChildren(el("p", `계산 실패: ${e.message}`, "bad"));
  } finally {
    btn.disabled = false;
  }
}

function card(item, onDelete) {
  const c = el("div", undefined, "card");
  c.dataset.id = item.id;
  c.append(el("h4", item.title || item.name));
  if (item.question) c.append(el("p", item.question, "todo"));
  const d = el("details");
  d.append(el("summary", "SQL 보기"), el("pre", item.sql));
  c.append(d);
  const row = el("div", undefined, "row");
  const btn = el("button", "다시 계산");
  btn.className = "recalc";
  const out = el("div", undefined, "cardout");
  btn.addEventListener("click", () => recompute(item, out, btn));
  row.append(btn);
  if (onDelete) {
    const del = el("button", "삭제", "ghost");
    del.addEventListener("click", () => onDelete(item));
    row.append(del);
  }
  c.append(row, out);
  return c;
}

let presets = [];
let stale = null; // 올린 파일로 데이터가 바뀐 뒤 안내 문구

export function markStale(names) {
  stale = `${new Date().toLocaleTimeString("ko-KR")}에 올린 파일로 테이블이 바뀌었습니다(${names.join(", ")}). 아래 결과는 이전 데이터 기준입니다. '다시 계산'을 누르면 지금 데이터로 계산합니다.`;
  const b = document.getElementById("stale");
  if (b) { b.textContent = stale; b.hidden = false; }
}

export function render() {
  const box = document.getElementById("prepared");
  box.replaceChildren();
  const banner = el("p", stale || "", "stale");
  banner.id = "stale";
  banner.hidden = !stale;
  box.append(banner);
  box.append(el("h3", "준비된 질문"));
  if (!presets.length) box.append(el("p", "presets/questions.json 을 읽지 못했습니다.", "bad"));
  presets.forEach((q) => box.append(card(q)));

  box.append(el("h3", "내가 저장한 질문"));
  const saved = loadSaved();
  const bar = el("div", undefined, "row");
  const dl = el("button", "내려받기 (JSON)", "ghost");
  dl.disabled = !saved.length;
  dl.addEventListener("click", download);
  const imp = el("button", "가져오기 (JSON)", "ghost");
  const file = el("input");
  file.type = "file"; file.accept = ".json,application/json"; file.hidden = true;
  imp.addEventListener("click", () => file.click());
  file.addEventListener("change", () => importFile(file.files[0], msg));
  const msg = el("span", "", "todo");
  bar.append(dl, imp, file, msg);
  box.append(bar);
  if (!saved.length) box.append(el("p", "묻기 탭에서 나온 SQL 아래 '저장' 단추로 이름을 붙여 저장하면 여기에 나타납니다.", "todo"));
  saved.forEach((q) => box.append(card({ ...q, title: q.name }, (it) => {
    persist(loadSaved().filter((x) => x.id !== it.id));
    render();
  })));
}

function download() {
  const data = { version: 1, questions: loadSaved().map(({ name, question, sql, saved_at }) => ({ name, question, sql, saved_at })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = el("a");
  a.href = url; a.download = "saved_questions.json";
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function importFile(f, msg) {
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const items = Array.isArray(data) ? data : data.questions;
    if (!Array.isArray(items)) throw new Error("questions 목록이 없습니다.");
    let ok = 0; const bad = [];
    for (const it of items) {
      const r = saveQuestion({ name: it.name, question: it.question, sql: it.sql }); // 가져올 때도 같은 검사
      if (r.ok) ok++; else bad.push(`${it.name || "(이름 없음)"}: ${r.reason}`);
    }
    render();
    const m = document.querySelector("#prepared .row span");
    if (m) { m.textContent = `${ok}개 가져옴${bad.length ? `, ${bad.length}개 건너뜀 — ${bad.join(" / ")}` : ""}`; m.className = bad.length ? "bad" : "ok"; }
  } catch (e) {
    msg.textContent = `가져오지 못했습니다: ${e.message}`; msg.className = "bad";
  }
}

export async function init() {
  try {
    const d = await (await fetch("presets/questions.json")).json();
    presets = d.questions || [];
  } catch { presets = []; }
  render();
}
