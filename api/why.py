"""POST /api/why  {question, sql, columns, rows(<=50)} -> {cause_sql, cause_note, chunk_label}.
원인 한 단계: 원래 결과를 한 번 더 쪼개는 SQL 을 쓴다. 보내는 것은 질문 · SQL · 집계 결과 50행 이하뿐."""
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gemini import call_gemini, cap_rows, schema_text  # noqa: E402

SYSTEM = """당신은 DuckDB SQL 작성자입니다. 사용자의 질문, 이미 실행한 SQL, 그 집계 결과(최대 50행)가 주어집니다.
그 결과를 '한 번 더 쪼개는' SQL 한 개(cause_sql)를 씁니다. 질문이 쪼갤 기준을 말했으면(예: 시험 항목별, 식각 설비별) 그 순서와 기준을 그대로 따르고,
말하지 않았으면 fail률은 시험 항목별 → 로트가 거친 설비별 순으로 쪼갭니다.
규칙:
- SELECT 또는 WITH 로 시작하는 읽기 전용 SQL 한 문장. 세미콜론·주석·쓰기 문장 금지. 테이블·컬럼은 아래 설명에 있는 것만 쓴다.
- 테이블·컬럼 이름이 한글이거나 밑줄·영문자·숫자 외 글자가 있으면 큰따옴표로 감싼다. 올린 테이블은 컬럼 뜻 정보가 없으니 이름과 타입으로만 추정하고, 추정이면 note 에 적는다.
- 문자열 값은 설명의 '예'와 글자 그대로 쓴다(앞뒤 공백 금지, 예: step = '식각').
- 날짜 비교는 test_date >= DATE '2025-10-01' AND test_date < DATE '2025-11-01' 처럼 범위로 쓴다.
- 원래 SQL 과 같은 기간·같은 조건(예: attempt = 1)을 그대로 건다. 지표는 [지표 정의]를 따른다.
- 쪼갠 조각이 서로 겹치지 않게 한다: 설비별로 쪼갤 때는 process_runs 를 질문이 말한 공정(step) 하나로 먼저 거른다(로트당 공정 1건이라 행이 늘지 않는다). test_results 와 process_runs 를 step 없이 조인하지 않는다.
- 결과 컬럼: 쪼갠 기준 컬럼들(문자), 조각의 건수 total_cnt, 비율 fail_pct 같은 *_pct, 그리고 반드시 chunk_value(= 그 조각의 fail 건수처럼 '쪼개지는 양'의 정수 값. 모든 조각의 합이 원래 결과의 분자와 같아야 한다).
- 조각이 많아도 LIMIT 으로 자르지 않는다(합이 틀어진다). 단 결과는 chunk_value 큰 순으로 정렬한다.
- chunk_label: chunk_value 가 무엇인지 짧은 한국어(예: "fail 건수"). cause_note: 어떻게 쪼갰는지 한 문장.

"""

RESP = {
    "type": "OBJECT",
    "properties": {
        "cause_sql": {"type": "STRING"},
        "cause_note": {"type": "STRING"},
        "chunk_label": {"type": "STRING"},
    },
    "required": ["cause_sql", "cause_note", "chunk_label"],
}


def run(body):
    body = body or {}
    q = str(body.get("question", "")).strip()
    sql = str(body.get("sql", "")).strip()
    if not q or not sql:
        return 400, {"error": "question 과 sql 이 필요합니다."}
    try:
        rows = cap_rows(body.get("rows"))
    except ValueError as e:
        return 400, {"error": str(e)}
    cols = body.get("columns") or []
    user = (
        f"[질문]\n{q}\n\n[실행한 SQL]\n{sql}\n\n[집계 결과 컬럼]\n{json.dumps(cols, ensure_ascii=False)}\n"
        f"[집계 결과 {len(rows)}행]\n{json.dumps(rows, ensure_ascii=False)}"
    )
    try:
        out = call_gemini(SYSTEM + schema_text(live=(body or {}).get("tables")), user, RESP)
    except RuntimeError as e:
        return 502, {"error": str(e)}
    return 200, {k: str(out.get(k, "")).strip() for k in ("cause_sql", "cause_note", "chunk_label")}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            body = {}
        status, payload = run(body)
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
