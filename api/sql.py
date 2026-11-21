"""POST /api/sql  {question} -> {sql, note, basis}.  질문과 테이블 설명만 AI로 보낸다."""
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gemini import call_gemini, load_schema, schema_text  # noqa: E402

SYSTEM = """당신은 DuckDB SQL 작성자입니다. 아래 테이블 설명만 근거로 한국어 질문에 답하는 SQL 한 개를 씁니다.
규칙:
- SELECT 또는 WITH 로 시작하는 읽기 전용 SQL 한 문장만 쓴다. 세미콜론, 주석, 쓰기 문장(INSERT/UPDATE/DELETE/DROP/CREATE 등)은 쓰지 않는다.
- 테이블·컬럼 이름은 아래 설명에 있는 것만 쓴다. 지표는 [지표 정의]의 회사 기준을 따른다(예: fail률은 별말이 없으면 attempt = 1 기준).
- 테이블·컬럼 이름이 한글이거나 밑줄·영문자·숫자 외 글자가 있으면 큰따옴표로 감싼다. 올린 테이블은 컬럼 뜻 정보가 없으니 이름과 타입으로만 추정하고, 추정이면 note 에 적는다.
- 문자열 값은 설명의 '예'와 글자 그대로 쓴다(앞뒤 공백 금지, 예: step = '식각').
- 날짜 비교는 test_date >= DATE '2025-10-01' AND test_date < DATE '2025-11-01' 처럼 범위로 쓴다.
- 조인으로 행이 늘어나 분모가 부풀지 않게 한다(필요하면 먼저 집계한 뒤 조인).
- 비율은 round(100.0 * ..., 2) 처럼 % 값으로 내고 컬럼 이름 끝에 _pct 를 붙인다.
- 결과 컬럼 이름은 영어 snake_case. 결과 행은 200행 이내가 되게 한다.
- note 에는 어떤 기준으로 셌는지 한 문장(한국어)으로 쓴다.
- basis 는 이 SQL 이 실제로 한 일을 있는 그대로 적는다:
  · tables: SQL 이 읽는 테이블 이름 전부(CTE 이름 제외)
  · conditions: 걸러 낸 조건을 사람이 읽는 문장으로(예: "첫 시도(attempt = 1)만", "test_date 가 2025-12")
  · metric: 쓴 지표 정의의 이름. [지표 정의]의 이름 중 하나, 해당하는 것이 없으면 "해당 없음"
  · metric_note: 그 정의를 어떻게 적용했는지 한 문장

"""


def build_resp():
    names = [m["name"] for m in load_schema()["metrics"]] + ["해당 없음"]
    return {
        "type": "OBJECT",
        "properties": {
            "sql": {"type": "STRING"},
            "note": {"type": "STRING"},
            "basis": {
                "type": "OBJECT",
                "properties": {
                    "tables": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "conditions": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "metric": {"type": "STRING", "enum": names},
                    "metric_note": {"type": "STRING"},
                },
                "required": ["tables", "conditions", "metric", "metric_note"],
            },
        },
        "required": ["sql", "note", "basis"],
    }


def run(body):
    q = str((body or {}).get("question", "")).strip()
    if not q:
        return 400, {"error": "질문이 비어 있습니다."}
    if len(q) > 500:
        return 400, {"error": "질문은 500자 이내로 써 주세요."}
    try:
        out = call_gemini(SYSTEM + schema_text(live=(body or {}).get("tables")), q, build_resp())
    except RuntimeError as e:
        return 502, {"error": str(e)}
    return 200, {
        "sql": str(out.get("sql", "")).strip(),
        "note": str(out.get("note", "")).strip(),
        "basis": out.get("basis"),
    }


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
