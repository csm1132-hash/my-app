// 내 파일 탭: CSV(UTF-8, BOM 무시) · xlsx(첫 시트, 첫 행=컬럼 이름)를 브라우저 안에서 읽어 테이블로 올린다.
// 파일 이름(확장자 뺀 것) = 테이블 이름. 같은 이름이면 바꾼다. 올린 파일은 브라우저 밖으로 나가지 않는다.
import { start, loadCsvTable, liveTables, runQuery } from "./db.js";
import { el, renderTable } from "./table.js";

const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; // 버전 고정

export const uploaded = new Map(); // 테이블 이름 → {file, at, rows}

// ---- CSV 읽기 (따옴표 · 줄바꿈 · CRLF 처리). 빈 줄은 버린다.
export function parseCsv(text) {
  text = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [], f = "", inQ = false, i = 0;
  const endRow = () => {
    row.push(f); f = "";
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } inQ = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === "") { inQ = true; i++; continue; }
    if (c === ",") { row.push(f); f = ""; i++; continue; }
    if (c === "\r") { if (text[i + 1] === "\n") i++; endRow(); i++; continue; }
    if (c === "\n") { endRow(); i++; continue; }
    f += c; i++;
  }
  if (inQ) throw new Error("따옴표가 닫히지 않았습니다.");
  if (f !== "" || row.length) endRow();
  return rows;
}

const cell = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header, data) => [header, ...data].map((r) => r.map(cell).join(",")).join("\n");

// ---- 컬럼 이름 다듬기: 공백 → 밑줄, 빈 이름 → col_N, 중복 → _2 ...
export function normalizeTable(rows) {
  if (!rows.length) throw new Error("파일이 비어 있습니다.");
  const headRaw = rows[0].map((h) => String(h ?? ""));
  const body = rows.slice(1);
  // 이름도 값도 없는 뒤쪽 열은 버린다
  let width = headRaw.length;
  while (width > 0 && headRaw[width - 1].trim() === "" && body.every((r) => (r[width - 1] ?? "") === "")) width--;
  if (width === 0) throw new Error("컬럼 이름이 하나도 없습니다.");
  const notes = [];
  const seen = new Set();
  const header = [];
  for (let j = 0; j < width; j++) {
    const raw = headRaw[j];
    let name = raw.trim().replace(/\s+/g, "_");
    if (name === "") name = `col_${j + 1}`;
    if (name !== raw) notes.push(`컬럼 '${raw}' → '${name}'`);
    let uniq = name, k = 2;
    while (seen.has(uniq.toLowerCase())) uniq = `${name}_${k++}`;
    if (uniq !== name) notes.push(`컬럼 이름이 겹쳐 '${name}' → '${uniq}'`);
    seen.add(uniq.toLowerCase());
    header.push(uniq);
  }
  const data = body.map((r, i) => {
    if (r.length > width && r.slice(width).some((v) => v !== "")) throw new Error(`${i + 2}번째 줄의 칸 수(${r.length})가 컬럼 수(${width})보다 많습니다.`);
    const o = r.slice(0, width);
    while (o.length < width) o.push("");
    return o;
  });
  return { header, data, notes };
}

// ---- 테이블 이름: 파일 이름에서 확장자를 뺀 것. SQL 에서 쓰기 편하게 글자·숫자·밑줄·한글만 남긴다.
export function tableNameFor(fileName) {
  const base = fileName.replace(/\.(csv|xlsx)$/i, "");
  let name = base.trim().replace(/[^A-Za-z0-9_가-힣]+/g, "_").replace(/^_+|_+$/g, "");
  if (!name) name = "table";
  if (/^[0-9]/.test(name)) name = "t_" + name;
  return { name, changed: name !== base };
}

function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = SHEETJS;
    s.onload = () => res(window.XLSX);
    s.onerror = () => rej(new Error("SheetJS 를 불러오지 못했습니다(인터넷 연결 확인)."));
    document.head.append(s);
  });
}

const pad = (n) => String(n).padStart(2, "0");
function xlsxValue(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (isNaN(v)) return "";
    // SheetJS 는 날짜를 로컬 시각 기준 Date 로 주되 수 초 어긋날 수 있어 가까운 분으로 맞춘 뒤 로컬 구성요소를 쓴다
    const d = new Date(Math.round(v.getTime() / 60000) * 60000);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return d.getHours() || d.getMinutes() ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:00` : date;
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

async function readRows(file) {
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
  if (/\.xlsx$/i.test(file.name)) {
    const X = await loadSheetJS();
    const wb = X.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("시트가 없습니다.");
    const raw = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    return raw.map((r) => r.map(xlsxValue));
  }
  throw new Error("CSV(.csv)와 엑셀(.xlsx)만 올릴 수 있습니다.");
}

// 파일 하나를 올린다. 결과 {file, table, replaced, notes, fileRows, tableRows, ok, columns, preview}
export async function ingest(file) {
  const rows = await readRows(file);
  const { header, data, notes } = normalizeTable(rows);
  const nm = tableNameFor(file.name);
  if (nm.changed) notes.unshift(`테이블 이름 '${file.name.replace(/\.(csv|xlsx)$/i, "")}' → '${nm.name}' (글자·숫자·밑줄·한글만 사용)`);
  await start();
  const existing = (await liveTables()).find((t) => t.name.toLowerCase() === nm.name.toLowerCase());
  const table = existing ? existing.name : nm.name; // 대소문자만 다르면 기존 이름으로 바꾼다
  const tableRows = await loadCsvTable(table, toCsv(header, data));
  const live = (await liveTables()).find((t) => t.name === table);
  const preview = await runQuery(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 20`);
  uploaded.set(table, { file: file.name, at: new Date(), rows: tableRows });
  return { file: file.name, table, replaced: !!existing, notes, fileRows: data.length, tableRows, ok: data.length === tableRows, columns: live.columns, preview };
}

// ---- 화면
function resultCard(r) {
  const c = el("div", undefined, "card");
  c.dataset.table = r.table || "";
  if (r.error) {
    c.append(el("h4", r.file), el("p", `올리지 못했습니다: ${r.error}`, "bad"));
    return c;
  }
  c.append(el("h4", `${r.file} → 테이블 ${r.table}`));
  c.append(el("p", r.replaced ? "같은 이름의 테이블이 있어 새 파일로 바꿨습니다." : "새 테이블로 올렸습니다.", "todo"));
  if (r.notes.length) {
    const ul = el("ul", undefined, "warn");
    r.notes.forEach((n) => ul.append(el("li", n)));
    c.append(el("p", "알림:", "warn"), ul);
  }
  const cmp = el("p", `파일에서 읽은 행 수 ${r.fileRows.toLocaleString()}  |  테이블에 올라간 행 수 ${r.tableRows.toLocaleString()}  `, "cmp");
  cmp.append(el("span", r.ok ? "✓" : "✕", r.ok ? "ok" : "bad"));
  c.append(cmp);
  c.append(el("p", "컬럼: " + r.columns.map((k) => `${k.name} (${k.type})`).join(", "), "todo"));
  c.append(el("p", `미리보기 (처음 ${Math.min(20, r.preview.rows.length)}행)`, "todo"));
  const tb = el("div", undefined, "tbl");
  renderTable(tb, r.preview);
  c.append(tb);
  return c;
}

export function initUpload({ onChange }) {
  const sec = document.getElementById("files");
  sec.replaceChildren();
  const drop = el("div", undefined, "drop");
  drop.append(el("p", "여기에 CSV · xlsx 파일을 끌어다 놓거나 아래 단추로 고르세요. 여러 개도 됩니다."));
  drop.append(el("p", "파일 이름(확장자 뺀 것)이 테이블 이름이 되고, 같은 이름의 테이블은 새 파일로 바뀝니다. 파일은 이 브라우저 안에서만 읽으며 새로고침하면 사라집니다.", "todo"));
  const input = el("input");
  input.type = "file"; input.multiple = true; input.accept = ".csv,.xlsx";
  drop.append(input);
  const status = el("p", "", "todo");
  const list = el("div");
  sec.append(drop, status, list);

  async function handle(files) {
    files = [...files];
    if (!files.length) return;
    const changed = [];
    for (let i = 0; i < files.length; i++) {
      status.textContent = `올리는 중… (${i + 1}/${files.length}) ${files[i].name}`;
      let r;
      try { r = await ingest(files[i]); changed.push(r.table); } catch (e) { r = { file: files[i].name, error: e.message }; }
      list.prepend(resultCard(r));
    }
    status.textContent = `${files.length}개 파일 처리 완료.`;
    input.value = "";
    if (changed.length) onChange(changed);
  }
  input.addEventListener("change", () => handle(input.files));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => handle(e.dataTransfer.files));
  window.__handleFiles = handle; // 시험용
}
