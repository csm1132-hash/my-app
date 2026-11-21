import { checkReadOnly as c } from "./guard.js";
const cases = [
  ["SELECT 1", true], ["with a as (select 1) select * from a;", true],
  ["select update_date, replace(x,'a','b') from t where s='drop table x'", true],
  ["DROP TABLE equipment", false], ["select 1; drop table equipment", false],
  ["/* hi */ drop table equipment", false], ["-- x\nDELETE FROM lots", false],
  ["select * from read_csv('a.csv')", false], ["select * from 'a.csv'", false],
  ["COPY lots TO 'x.csv'", false], ["with a as (select 1) insert into t select * from a", false],
  ["select 1 /* unclosed", false], ["", false], ["PRAGMA database_list", false],
];
let bad = 0;
{
  const r = c("select strftime(d, '%Y-%m') /* x */ from t where s = '식각'; ");
  if (!r.ok || r.sql !== "select strftime(d, '%Y-%m')   from t where s = '식각'") { bad++; console.log("FAIL 원문 보존", JSON.stringify(r)); }
}
for (const [sql, want] of cases) {
  const r = c(sql);
  if (r.ok !== want) { bad++; console.log("FAIL", sql, r); }
}
console.log(bad ? `${bad}건 실패` : `guard 시험 ${cases.length}건 통과`);
process.exit(bad ? 1 : 0);
