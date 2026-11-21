"""공용: Gemini 호출 + schema.json 기반 프롬프트. 표준 라이브러리만 사용."""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = "gemini-3.5-flash-lite"
MAX_ROWS = 50


def cap_rows(rows):
    """AI 로 보내는 집계 결과는 MAX_ROWS(50)행 이하만 허용한다."""
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise ValueError("rows 는 목록이어야 합니다.")
    if len(rows) > MAX_ROWS:
        raise ValueError(f"AI에는 집계 결과 {MAX_ROWS}행 이하만 보낼 수 있습니다(받은 행: {len(rows)}).")
    return rows


def load_schema():
    return json.loads((ROOT / "schema.json").read_text(encoding="utf-8"))


def clean_live(live):
    """브라우저가 보낸 '지금 올라와 있는 테이블' 목록(이름 · 행 수 · 컬럼 이름/타입)을 검증한다. 이상하면 무시."""
    out = []
    if not isinstance(live, list):
        return out
    for t in live[:50]:
        try:
            name = str(t["name"])[:80]
            cols = [(str(c["name"])[:80], str(c["type"])[:40]) for c in t["columns"][:300]]
            rows = int(t["rows"])
        except (KeyError, TypeError, ValueError):
            continue
        if name and cols:
            out.append({"name": name, "rows": rows, "columns": cols})
    return out


def schema_text(schema=None, live=None):
    """AI에 보내는 테이블 설명. 기본 테이블은 schema.json, 올린 테이블은 이름 · 컬럼 이름 · 타입 · 행 수만(데이터 행 없음)."""
    s = schema or load_schema()
    live = {t["name"].lower(): t for t in clean_live(live)}
    out = [f"[회사] {s['company']}", f"[기간] {s['period']}", f"[SQL] {s['sql_dialect']}", "", "[테이블]"]
    base = set()
    for t in s["tables"]:
        base.add(t["name"].lower())
        lv = live.get(t["name"].lower())
        if lv and {c[0].lower() for c in lv["columns"]} != {c["name"].lower() for c in t["columns"]}:
            continue  # 파일로 바뀌어 컬럼 구성이 달라졌다 → 아래에서 '올린 테이블'로 설명
        rows = lv["rows"] if lv else t["rows"]
        out.append(f"- {t['name']}  (한 행 = {t['grain']}, 약 {rows:,}행)")
        for c in t["columns"]:
            ex = ", ".join(str(e) for e in c["examples"])
            out.append(f"    {c['name']} {c['type']} — {c['desc']} (예: {ex})")
    for key, lv in live.items():
        if key in base and {c[0].lower() for c in lv["columns"]} == {c["name"].lower() for t in s["tables"] if t["name"].lower() == key for c in t["columns"]}:
            continue
        out.append(f"- \"{lv['name']}\"  (사용자가 올린 파일, {lv['rows']:,}행. 컬럼 뜻 정보는 없음)")
        for n, ty in lv["columns"]:
            out.append(f"    \"{n}\" {ty}")
    out += ["", "[관계]"] + [f"- {r}" for r in s["relations"]]
    out += ["", "[지표 정의]"]
    for m in s["metrics"]:
        out.append(f"- {m['name']}: {m['definition']}" + (f" 힌트: {m['sql_hint']}" if m["sql_hint"] else ""))
    out += ["", "[회사 규칙]"] + [f"- {r}" for r in s["rules"]]
    return "\n".join(out)


def call_gemini(system, user, response_schema):
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY 가 설정되어 있지 않습니다(.env 또는 환경 변수).")
    model = os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": response_schema,
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"Gemini 호출 실패 (HTTP {e.code}): {detail}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Gemini 에 연결하지 못했습니다: {e.reason}")
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
    except (KeyError, IndexError, ValueError):
        raise RuntimeError("Gemini 응답을 해석하지 못했습니다.")
