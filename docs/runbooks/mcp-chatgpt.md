# 런북: brewdial MCP를 ChatGPT 커넥터로 연결

이 문서는 API 서비스(`brewdial-api`)가 `/mcp`(Streamable HTTP)를 서빙하도록 한 뒤, Cloudflare Access Managed OAuth로 보호해 ChatGPT 커넥터에 연결하는 절차다. 설계 근거는 hk `decision/2026-11-08/brewdial-mcp-dots`다.

이 문서는 플레이스홀더만 쓴다. 실제 호스트 이름, 이메일, 계정 ID, 터널 ID, IP는 호스트의 환경 파일과 Cloudflare 대시보드에만 둔다.

| 플레이스홀더 | 뜻 |
|---|---|
| `<mcp-hostname>` | `/mcp`를 노출할 공개 호스트 이름 |
| `<team-domain>` | Cloudflare Access 팀 도메인(스킴 없이) |
| `<aud>` | Access 애플리케이션의 Audience 태그 |
| `<operator-email>` | 허용할 운영자 이메일(쉼표로 여러 개 가능) |
| `<api-loopback-port>` | `brewdial-api`가 루프백(loopback)에서 듣는 포트 |

## 동작 요약

- `POST /mcp`는 루트 앱에 있으며 `/api` 접두사를 쓰지 않는다. CORS와 identity 미들웨어를 거치지 않는다.
- 인증은 `Cf-Access-Jwt-Assertion` 헤더의 Access 사용자 어서션으로만 한다. RS256, `iss`, `aud`, `exp`를 검증하고 `email` 클레임을 허용 목록과 대조한다. Bearer 경로는 `/mcp`에 없다.
- 설정 변수 3개(`BREWDIAL_MCP_CF_TEAM_DOMAIN`, `BREWDIAL_MCP_CF_AUD`, `BREWDIAL_MCP_ALLOWED_EMAILS`) 중 하나라도 비어 있으면 `/mcp`는 `503 {"error":"mcp auth not configured"}`를 돌려준다.
- 도구 호출은 프로세스 안에서 같은 라우트, 검증, `agentAuth`를 거친다. 네트워크 홉은 없다.
- 상태를 들고 있지 않으므로(stateless) blue/green 전환에 안전하다.

## 롤아웃

1. **Access 애플리케이션 만들기.** Cloudflare Zero Trust에서 `<mcp-hostname>`용 Access 애플리케이션을 만들고, 정책은 운영자 한 명만 허용(Allow)하는 것으로 한다.
2. **Managed OAuth 켜기.** 같은 애플리케이션에서 Managed OAuth를 켜고 다음 리다이렉트 URI를 허용한다.
   - `https://chatgpt.com/connector_platform_oauth_redirect`
   - `https://chatgpt.com/connector/oauth/*`
3. **터널 ingress 추가.** 호스트의 로컬 `/etc/cloudflared/config.yml`에 `<mcp-hostname>` → `localhost:<api-loopback-port>` 규칙을 추가한다. 대시보드(원격 설정)에만 있는 규칙은 404를 낸다(hk 3430). 그 다음 설정을 검증하고 cloudflared를 재시작한다.
   ```bash
   cloudflared tunnel ingress validate
   sudo systemctl restart cloudflared
   ```
4. **DNS 추가.** `<mcp-hostname>`을 터널로 가리키는 레코드를 추가한다.
5. **환경 파일에 변수 추가 후 배포.** 호스트의 환경 파일(`/etc/shiftgate/brewdial-api.env`)에 다음 세 변수를 넣는다. 값은 `deploy/oci/api.env.example`의 설명을 따른다.
   ```
   BREWDIAL_MCP_CF_TEAM_DOMAIN=<team-domain>.cloudflareaccess.com
   BREWDIAL_MCP_CF_AUD=<aud>
   BREWDIAL_MCP_ALLOWED_EMAILS=<operator-email>
   ```
   그 다음 평소 배포 절차(`deploy-oci.yml`)로 `brewdial-api`를 배포한다. 기동 로그에서 `mcp.access enabled`가 보여야 한다. `mcp.access disabled reason=incomplete_config ...`이 보이면 어느 변수가 빠졌는지 플래그(`*_set=false`)로 확인한다.
6. **검증.**
   - `https://<mcp-hostname>/.well-known/oauth-authorization-server` → `200`
   - 인증 없이 `POST https://<mcp-hostname>/mcp` → `401`, 본문 `{"error":"unauthorized"}`
   - ChatGPT 커넥터를 추가한 뒤 도구 목록에 13개가 보인다.
7. **롤백.** 둘 중 하나로 되돌린다.
   - 터널 ingress에서 `<mcp-hostname>` 규칙을 제거하고 cloudflared를 재시작한다.
   - 또는 환경 파일에서 세 변수 중 하나를 비우고 `brewdial-api`를 재시작한다. 그러면 `/mcp`는 `503`을 낸다.

## 확인되지 않은 항목

- 이 런북의 1–5단계는 Cloudflare와 호스트 작업이며 저장소 코드로 검증할 수 없다. 실제 적용 결과는 6단계로만 확인한다.
- ChatGPT 커넥터의 OAuth 흐름은 Cloudflare 측 동작에 의존한다. 6단계의 `200`과 `401`을 본 뒤에 커넥터를 연결한다.
