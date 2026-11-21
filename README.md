# 품질·설비 SQL 앱 (반도체 후공정)

한국어로 묻고, AI가 DuckDB SQL을 쓰고, 브라우저에서 실행해 결과 · 산출 근거 · 원인 한 단계를 보여 줍니다.

## 쓰기 전에

1. 이 앱은 데이터를 브라우저 안에서 읽는다. 올린 파일은 서버에 저장되지 않는다.
2. AI에는 질문 · 테이블 설명 · 집계 결과(최대 50행)만 간다. 원본 행은 가지 않는다.
3. AI가 쓴 SQL은 실행 전에 읽어 보고, 결과 숫자 하나는 직접 검산한다.
4. 올린 파일의 «읽은 행 수»와 «올라간 행 수»가 다르면(✕) 그 결과를 믿지 않는다.
5. 파일 이름이 같으면 나중에 올린 파일이 앞의 것을 대신한다.
6. 시험은 투입 5~6일 뒤에 하므로, 월말에 투입한 로트의 시험 결과는 다음 달 파일에서 채워진다.

## 내 PC에서 실행

1. `.env.example` 을 `.env` 로 복사하고 `GEMINI_API_KEY` 를 넣는다(`GEMINI_MODEL` 은 비워 두면 gemini-3.5-flash-lite).
2. `python tools/serve.py` → http://localhost:8780/

## Vercel 배포

- 정적 파일(`index.html`, `static/`, `data/`, `presets/`, `schema.json`)과 `api/` 의 Python 함수(`sql.py`, `why.py`)가 그대로 배포된다. 빌드 단계 · npm 설치는 없다.
- Vercel 프로젝트의 환경 변수에 `GEMINI_API_KEY`(필수), `GEMINI_MODEL`(선택)을 넣는다.
- `tools/`, `.env`, `다음달/` 은 `.vercelignore` 로 올리지 않는다. `data/` 는 가상 데이터라 포함한다.
- 배포 주소는 누구나 열 수 있으므로, AI 호출 비용이 걱정되면 Vercel의 접근 보호를 켠다.
