// 테이블 탭: 지금 올라와 있는 테이블의 이름 · 행 수 · 컬럼 이름 · 타입 (기본 테이블은 데이터 사전의 뜻도 함께)
import { liveTables, baseTableNames } from "./db.js";
import { loadSchema } from "./why.js";
import { el } from "./table.js";
import { uploaded } from "./upload.js";

export async function renderTables() {
  const box = document.getElementById("tables");
  box.replaceChildren(el("p", "불러오는 중…", "todo"));
  const [live, schema] = await Promise.all([liveTables(), loadSchema()]);
  box.replaceChildren(el("h3", `테이블 ${live.length}개`));
  for (const t of live) {
    const def = schema.tables.find((x) => x.name === t.name);
    const sameCols = def && def.columns.length === t.columns.length && def.columns.every((c) => t.columns.some((k) => k.name === c.name));
    const up = uploaded.get(t.name);
    const c = el("div", undefined, "card");
    c.dataset.table = t.name;
    const h = el("h4", t.name);
    h.append(el("span", up ? `올린 파일: ${up.file}` : baseTableNames.includes(t.name) ? "기본 데이터" : "", up ? "tag up" : "tag"));
    c.append(h);
    c.append(el("p", `${t.rows.toLocaleString()}행${sameCols ? " · 한 행 = " + def.grain : ""}`, "todo"));
    if (def && !sameCols) c.append(el("p", "컬럼 구성이 기본 데이터와 달라 데이터 사전의 뜻은 붙이지 않습니다.", "warn"));
    const tb = el("div", undefined, "tbl");
    const tab = el("table");
    const head = el("tr");
    ["컬럼", "타입", "뜻 (데이터 사전)"].forEach((x) => head.append(el("th", x)));
    tab.append(head);
    for (const k of t.columns) {
      const d = sameCols ? def.columns.find((x) => x.name === k.name) : null;
      const tr = el("tr");
      tr.append(el("td", k.name), el("td", k.type), el("td", d ? d.desc : ""));
      tab.append(tr);
    }
    tb.append(tab);
    c.append(tb);
    box.append(c);
  }
}
