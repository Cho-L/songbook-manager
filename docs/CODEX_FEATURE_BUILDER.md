# 송북매니저 — ChatGPT Plus Codex 개발 방식 (추가 API 키 없음)

## 비용 기준
- ChatGPT Plus에 포함된 Codex 사용량 안에서 작업한다 (플랜 사용 제한 적용).
- OpenAI Platform API 키 및 API 별도 결제는 요구하지 않는다.
- GitHub Actions의 기본 제공 사용량/Cloudflare/Supabase의 요금제 한도는 각 플랫폼 조건에 따르며, 초과 또는 유료 기능은 별도 확인한다.
- 별도 결제나 유료 서비스 도입 전 반드시 소유자에게 알린다.

## 개발 운영 절차
1. 소유자가 ChatGPT 또는 Codex에서 원하는 기능을 설명한다.
2. Codex Cloud에서 ChatGPT 계정으로 로그인한다. GitHub `Cho-L/songbook-manager` 저장소가 있는 클라우드 환경을 연결하거나 구성한다.
3. 개발 작업은 항상 `main`이 아닌 별도 브랜치에서 진행하고, 작업 결과를 PR로 제안한다.
4. GitHub Actions의 `Safe quality check` 및 `SQL regression (isolated PGlite)` 결과를 검토한다. 외부 연동/실제 DB 권한 검증과는 다르다.
5. 요청 기능, 변경 파일, 위험도, 복구 방법 및 미검증 사항을 확인한다.
6. `main`으로 병합하면 Cloudflare 운영 사이트가 자동 배포되므로, **소유자의 명시적 배포 승인 전에는 병합하지 않는다.**
7. 배포 뒤 실제 웹/OBS/Supabase 핵심 흐름을 확인한다.

## Codex Cloud 처음 설정
- ChatGPT 계정으로 Codex에 로그인한다 (API key 로그인 불필요).
- 새 클라우드 환경에서 `Cho-L/songbook-manager` 저장소를 선택한다.
- 개발환경에서 `npm ci`, `npm run typecheck`, `npm run build`을 사용할 수 있는지 확인한다.
- 최초 요청은 비핵심 UI/문구 변경처럼 되돌리기 쉬운 작업으로 진행한다.
- Codex가 생성한 PR을 검토하고 테스트 결과를 확인한다.

## 안전 규칙
- GitHub `main` 변경은 Cloudflare 자동 운영 배포다.
- Cloudflare Worker, 비밀키, Supabase RLS/스키마, Auth, 결제 관련 수정은 별도 검토와 승인 필요.
- 실제 데이터베이스에 SQL을 자동 실행하지 않는다.
- 테스트에 운영 키/개인정보를 사용하지 않는다.
- 실패한 검사를 무시하거나 우회하여 병합하지 않는다.
- `AGENTS.md`의 별도 브랜치 및 운영 안전 규칙을 따른다.

## 현재 상태
- API 과금형 `.github/workflows/codex-feature-builder.yml`은 초안 PR에서 제거했다.
- GitHub Actions 타입 검사/빌드/로컬 단위 및 SQL 모의 테스트는 준비되어 있다.
- Codex 개발 환경 연결, 린트 오류 수정, 테스트, 별도 브랜치 푸시까지 실제 실행했으며 PR #3이 승인 후 `main`에 병합되었다.
- Codex 환경에서는 GitHub API 프록시 403으로 PR 생성이 막힌 사례가 있었다. 당시 GitHub 연결 도구로 Draft PR #3을 대신 생성했다. 향후에도 Codex 자체 PR 생성 가능 여부는 환경별로 확인해야 한다.
- ChatGPT 채팅만으로 Codex Cloud 작업이 **자동 트리거되는 연동은 아직 구성하지 않았다.** 당장은 사용자가 Codex에서 직접 작업을 시작하거나 지원되는 기능을 사용해야 한다.
