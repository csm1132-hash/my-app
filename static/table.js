// 화면 공용: DOM 만들기, 결과 표
export const MAX_SHOW = 200; // 화면에 보이는 최대 행

export function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

export function renderTable(box, { columns, rows }) {
  box.replaceChildren();
  const t = el("table");
  const head = el("tr");
  columns.forEach((c) => head.append(el("th", c)));
  t.append(head);
  rows.slice(0, MAX_SHOW).forEach((r) => {
    const tr = el("tr");
    columns.forEach((c) => {
      const v = r[c];
      tr.append(el("td", v === null || v === undefined ? "" : String(v), typeof v === "number" ? "num" : ""));
    });
    t.append(tr);
  });
  box.append(t);
}
