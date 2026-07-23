# M0A.5a Formal Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在暂时保留旧开发认证入口的前提下，建立可供 API、测试和后续 TUI 复用的正式认证基础：安全网络边界、注册开关、认证状态接口、登录防枚举、TUI 7 天 Session，以及共享的正式认证测试客户端。

**Architecture:** 本阶段只扩展 password 认证契约，不删除 dev 分支。API 配置负责一次性验证公共 URL、邮件模式与 Cookie 安全属性；AuthService 负责注册策略和 Session 生命周期；路由只负责解析客户端类型并传递策略。所有需要 HTTP 身份的脚本通过一个共享测试客户端完成注册、验证、登录、Cookie 与 CSRF，不再各自拼装认证。

**Tech Stack:** TypeScript、Node.js 22、原生 `fetch`、Node test runner、Argon2、现有 API/AuthService、SQLite Metadata。

---

## Execution baseline

- 从包含设计提交 `c56ab35`、`fae07b6` 的分支开始；M0A.5a 不依赖 PR #82。
- 本计划结束时 `DATAFOUNDRY_AUTH_MODE=dev` 仍可临时运行；删除工作属于 M0A.5c。
- 每个任务按红—绿—重构执行；不要先批量修改生产代码再补测试。
- 不新增旧数据库迁移、旧数据清理或兼容代码。

### Task 1: 建立共享正式认证测试客户端

**Files:**

- Create: `scripts/lib/authenticated-test-client.mjs`
- Create: `scripts/lib/authenticated-test-client.test.mjs`
- Modify: `scripts/smoke-auth.mjs`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：

- 从多个 `Set-Cookie` 响应中保存 `df_session`、`df_csrf`；
- unsafe method 自动添加 `X-CSRF-Token`；
- 401/403 响应不泄漏 Cookie；
- `registerAndLogin()` 严格执行注册、读取 test 邮件令牌、验证、登录、`/me`；
- 每个测试生成唯一邮箱，不依赖固定用户。

测试应直接构造假响应：

```js
test("adds cookie and csrf to unsafe requests", async () => {
  const calls = [];
  const client = createAuthenticatedTestClient({
    baseUrl: "http://127.0.0.1:8787",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    },
  });
  client.cookies.replace({
    df_session: "session-secret",
    df_csrf: "csrf-secret",
  });

  await client.fetch("/api/v1/config", { method: "POST", body: "{}" });

  assert.equal(calls[0].init.headers.get("cookie"), "df_session=session-secret; df_csrf=csrf-secret");
  assert.equal(calls[0].init.headers.get("x-csrf-token"), "csrf-secret");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node --test scripts/lib/authenticated-test-client.test.mjs
```

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现最小客户端**

公开接口保持小而明确：

```js
export function createAuthenticatedTestClient({ baseUrl, fetchImpl = fetch }) {
  return {
    cookies,
    fetch: authenticatedFetch,
    registerAndLogin,
    verifyCurrentUser,
    logout,
  };
}

export function resolveApiUrl(baseUrl, relativePath) {
  const base = new URL(baseUrl);
  base.pathname = `${base.pathname.replace(/\/?$/, "/")}${relativePath.replace(/^\/+/, "")}`;
  base.search = "";
  base.hash = "";
  return base;
}
```

实现要求：

- URL 使用 `resolveApiUrl()` 构造，必须保留 base URL 的部署路径前缀；
- 测试覆盖 `https://example.com/datafoundry` + `api/v1/me` 得到
  `https://example.com/datafoundry/api/v1/me`；
- Cookie Jar 只保存 cookie name/value，不保存无关属性；
- unsafe method 为 `POST/PATCH/PUT/DELETE`；
- 错误对象只包含状态码、稳定错误码和脱敏消息；
- 不记录密码、Cookie、CSRF、验证令牌或 `Set-Cookie`。

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
node --test scripts/lib/authenticated-test-client.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 重构现有认证 smoke**

将 `scripts/smoke-auth.mjs` 内部 Cookie Jar 和重复请求代码替换为共享客户端；保持原有完整认证 smoke 的断言。

- [ ] **Step 6: 提交**

```bash
git add scripts/lib/authenticated-test-client.mjs scripts/lib/authenticated-test-client.test.mjs scripts/smoke-auth.mjs
git commit -m "test(auth): add formal authenticated test client"
```

### Task 2: 固化公共 URL、Cookie 和邮件安全边界

**Files:**

- Modify: `apps/api/src/auth/config.ts`
- Modify: `apps/api/src/auth/cookies.ts`
- Create: `scripts/auth-foundation.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写配置矩阵失败测试**

表驱动覆盖：

| Public URL | Email delivery | 结果 |
| --- | --- | --- |
| `http://127.0.0.1:3000` | `test` | 允许，Cookie 非 Secure |
| `http://localhost:3000` | `test` | 允许，Cookie 非 Secure |
| `http://[::1]:3000` | `test` | 允许，Cookie 非 Secure |
| `http://192.168.1.10:3000` | 任意 | 拒绝启动 |
| `https://example.com/datafoundry` | `smtp` | 允许，保留 path，Cookie Secure |
| `https://example.com` | `test` | 拒绝启动 |

同时覆盖非法 scheme、用户名密码、fragment 和无效 `AUTH_REGISTRATION_MODE`。

- [ ] **Step 2: 运行并确认失败**

```bash
npm run build && node --test scripts/auth-foundation.test.mjs
```

Expected: FAIL，现有配置仍按 `NODE_ENV` 决定 Cookie。

- [ ] **Step 3: 实现经过验证的配置模型**

在 password 配置中新增：

```ts
type RegistrationMode = "open" | "closed";

interface PasswordAuthConfig {
  publicBaseUrl: string;
  registrationMode: RegistrationMode;
  cookieSecure: boolean;
  sessionSecret: string;
  emailDelivery: "smtp" | "test";
}
```

新增纯函数：

```ts
export function validateAuthPublicUrl(raw: string): {
  publicBaseUrl: string;
  loopback: boolean;
  cookieSecure: boolean;
}
```

规则：

- 仅接受 HTTP/HTTPS；
- HTTP 只接受 `localhost`、`127.0.0.1`、`::1`；
- HTTPS 强制 `cookieSecure=true`；
- `test` 邮件只允许 loopback；
- Cookie 安全属性不得再读 `NODE_ENV`。

修改 Cookie helper，显式接收 `secure`：

```ts
appendSessionCookie(headers, value, { secure, maxAgeSeconds });
appendCsrfCookie(headers, value, { secure, maxAgeSeconds });
```

- [ ] **Step 4: 运行测试**

```bash
npm run build && node --test scripts/auth-foundation.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 增加稳定聚合命令**

此时两个测试文件均已存在，在 `package.json` 增加：

```json
"test:auth-foundation": "npm run build && node --test scripts/lib/authenticated-test-client.test.mjs scripts/auth-foundation.test.mjs"
```

立即运行：

```bash
npm run test:auth-foundation
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/auth/config.ts apps/api/src/auth/cookies.ts scripts/auth-foundation.test.mjs package.json
git commit -m "feat(auth): enforce public URL and cookie security"
```

### Task 3: 实现注册开关与公开认证状态

**Files:**

- Modify: `apps/api/src/auth/service.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `scripts/auth-foundation.test.mjs`

- [ ] **Step 1: 添加失败的路由测试**

启动真实 API，覆盖：

- `GET /api/v1/auth/status` 未登录返回 200；
- 响应只包含 `publicBaseUrl`、`registrationEnabled`；
- `open` 允许注册；
- `closed` 返回稳定错误码 `REGISTRATION_CLOSED`；
- status 不返回 secret、SMTP、内部 API 地址；
- 关闭注册不能只隐藏 UI。

期望响应：

```json
{
  "publicBaseUrl": "http://127.0.0.1:3000",
  "registrationEnabled": true
}
```

- [ ] **Step 2: 运行并确认失败**

```bash
npm run test:auth-foundation
```

Expected: FAIL，status 路由和注册策略尚不存在。

- [ ] **Step 3: 实现服务和路由**

- `AuthService.getPublicStatus()` 返回安全 DTO；
- `AuthService.register()` 在任何数据库写入前检查 `registrationMode`；
- `handleAuthRoute()` 将 status 作为公开 GET；
- `server.ts` 继续仅在 password 分支挂载这些路由，等待 M0A.5c 删除模式判断；
- 所有认证 Cookie 使用已验证的 `cookieSecure`。

- [ ] **Step 4: 运行测试**

```bash
npm run test:auth-foundation
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/auth/service.ts apps/api/src/auth/routes.ts apps/api/src/server.ts scripts/auth-foundation.test.mjs
git commit -m "feat(auth): add registration policy and public status"
```

### Task 4: 修复登录枚举并区分 Web/TUI Session

**Files:**

- Modify: `apps/api/src/auth/crypto.ts`
- Modify: `apps/api/src/auth/service.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `scripts/auth-foundation.test.mjs`

- [ ] **Step 1: 写失败测试**

覆盖：

- 不存在用户和错误密码都返回 `Invalid email or password`；
- 未验证用户输入错误密码仍返回通用错误；
- 只有未验证用户输入正确密码才返回 `EMAIL_NOT_VERIFIED`；
- `client: "tui"` Session 过期时间约 7 天；
- 缺省或 `client: "web"` 保持约 30 天；
- 登录响应返回服务端计算的 `session.expiresAt`，与数据库记录及 Cookie Max-Age 一致；
- 非法 client 返回 400，不静默降级。

时间断言使用容差，不以微秒级时序判断防枚举。

- [ ] **Step 2: 运行并确认失败**

```bash
npm run test:auth-foundation
```

Expected: FAIL，当前服务先暴露邮箱验证状态。

- [ ] **Step 3: 实现最小安全流程**

在服务初始化一个进程内伪密码哈希 Promise：

```ts
private readonly dummyPasswordHash = hashPassword(createSecretToken())
  .then((result) => result.hash);
```

登录顺序必须使用现有 repository 和 snake_case 字段：

```ts
const user = this.metadataStore.users.findByEmail({ email });
const credential = user
  ? this.metadataStore.userPasswordCredentials.find({ user_id: user.id })
  : undefined;
if (!user || user.disabled_at || !credential) {
  await verifyPassword(await this.dummyPasswordHash, password);
  throw invalidCredentials();
}
if (!(await verifyPassword(credential.password_hash, password))) {
  throw invalidCredentials();
}
if (!user.email_verified_at) {
  throw emailNotVerified();
}
```

定义常量：

```ts
const WEB_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const TUI_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
```

路由仅接受 `client?: "web" | "tui"` 并传给 service。`AuthService.login()` 返回值增加：

```ts
expiresAt: session.expires_at,
```

路由响应增加：

```ts
session: {
  expiresAt: result.expiresAt,
},
```

不得让 TUI 根据本地时间自行推算服务端过期时间。

- [ ] **Step 4: 运行测试**

```bash
npm run test:auth-foundation
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/auth/crypto.ts apps/api/src/auth/service.ts apps/api/src/auth/routes.ts scripts/auth-foundation.test.mjs
git commit -m "fix(auth): harden login and add tui session lifetime"
```

### Task 5: 增加可恢复的 CSRF 契约

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/metadata/src/index.ts`
- Modify: `apps/api/src/auth/service.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/auth/cookies.ts`
- Modify: `scripts/auth-foundation.test.mjs`

- [ ] **Step 1: 写失败测试**

覆盖：

- 缺少或不匹配的 CSRF 返回稳定错误码 `CSRF_INVALID`；
- 有效 Session 可以调用 `POST /api/v1/auth/csrf/refresh` 轮换 CSRF；
- 轮换同时更新数据库哈希、响应 Cookie 和响应 DTO；
- 旧 CSRF 立即失效，新 CSRF 可用于一次 unsafe 请求；
- 无 Session 不能轮换；
- 普通权限 403 继续返回 `FORBIDDEN`，不能触发客户端重放。

- [ ] **Step 2: 运行并确认失败**

```bash
npm run test:auth-foundation
```

Expected: FAIL，当前 contract 没有 `CSRF_INVALID`，csrf 路由只回显 Cookie。

- [ ] **Step 3: 实现服务端轮换**

在 contracts 的 `AppErrorCode` 增加：

```ts
| "CSRF_INVALID"
```

在 Session repository 增加：

```ts
rotateCsrf(input: { id: string; csrf_token_hash: string }): AuthSessionRecord
```

在 `AuthService` 中实现：

```ts
rotateCsrf(identity: AuthIdentity): { csrfToken: string } {
  if (!identity.session) {
    throw new AuthError(401, "UNAUTHORIZED", "Authentication required.");
  }
  const csrfToken = createSecretToken();
  this.metadataStore.authSessions.rotateCsrf({
    id: identity.session.id,
    csrf_token_hash: hashToken(csrfToken, this.config.sessionSecret),
  });
  return { csrfToken };
}
```

`POST /api/v1/auth/csrf/refresh` 是唯一免旧 CSRF 校验的认证 POST：它仍要求有效
Session Cookie，调用 `rotateCsrf()` 后用专用 Cookie helper 设置新的 CSRF Cookie，
并返回相同 Token。响应必须增加 `Cache-Control: no-store`。现有
`GET /api/v1/auth/csrf` 保持只读，不承担恢复职责。

路由顺序必须是：处理公开路由 → `requireIdentity()` →
处理 `csrf/refresh` → 对其余 unsafe method 调用 `validateCsrf()`。不得把 refresh
加入公开路由。

- [ ] **Step 4: 运行测试**

```bash
npm run test:auth-foundation
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/contracts/src/index.ts packages/metadata/src/index.ts apps/api/src/auth scripts/auth-foundation.test.mjs
git commit -m "feat(auth): add recoverable csrf rotation"
```

### Task 6: 迁移 HTTP smoke 到共享正式认证

**Files:**

- Modify:
  - `scripts/run-dacomp6-complex-case.mjs`
  - `scripts/seed-dtc-growth-demo.mjs`
  - `scripts/seed-local-fixtures.mjs`
  - `scripts/smoke-agent-protocol-deepseek.mjs`
  - `scripts/smoke-ask-user-interrupt.mjs`
  - `scripts/smoke-config-api.mjs`
  - `scripts/smoke-copilotkit-run.mjs`
  - `scripts/smoke-copilotkit.mjs`
  - `scripts/smoke-interaction-run-id.mjs`
  - `scripts/smoke-password-frontend-isolation.mjs`
  - `scripts/smoke-server-datasources-e2e.mjs`
  - `scripts/test-builtin-dtc-growth-datasource.mjs`
  - `scripts/verify-token-usage-display.mjs`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 增加一个会失败的扫描门禁**

在 `scripts/auth-foundation.test.mjs` 动态扫描所有包含 `fetch(`、`http.request`
或 `https.request` 的 `scripts/*.mjs`。每个命中必须归入：

```js
const FORMAL_HTTP_AUTH_TARGETS = [
  "run-dacomp6-complex-case.mjs",
  "seed-dtc-growth-demo.mjs",
  "seed-local-fixtures.mjs",
  "smoke-agent-protocol-deepseek.mjs",
  "smoke-ask-user-interrupt.mjs",
  "smoke-auth.mjs",
  "smoke-config-api.mjs",
  "smoke-copilotkit-run.mjs",
  "smoke-copilotkit.mjs",
  "smoke-interaction-run-id.mjs",
  "smoke-password-frontend-isolation.mjs",
  "smoke-server-datasources-e2e.mjs",
  "test-builtin-dtc-growth-datasource.mjs",
  "verify-token-usage-display.mjs",
];
const PUBLIC_HTTP_TARGETS = [];
const DIRECT_METADATA_FIXTURE_TARGETS = [];
```

任何未分类脚本使测试失败。对 `FORMAL_HTTP_AUTH_TARGETS` 禁止：

```text
X-Dev-Token
dev-token
Authorization: Bearer dev
```

允许纯 metadata 单元/集成测试暂时继续使用直接 fixture，留给 M0A.5c。

- [ ] **Step 2: 运行并确认失败**

```bash
npm run test:auth-foundation
```

Expected: FAIL，并列出仍依赖开发认证的 HTTP 脚本。

- [ ] **Step 3: 逐个迁移**

每个脚本：

1. 启动 password API 和 test mail；
2. 使用 `createAuthenticatedTestClient()` 创建唯一正式用户；
3. 后续 REST/AG-UI 请求复用该 client；
4. 移除开发 header 和固定 `dev-user` 假设；
5. 保留原业务断言。

每迁移 2–3 个脚本即运行对应 smoke。分为四个独立批次：

1. config/auth：config-api、password-frontend-isolation；
2. CopilotKit/AG-UI：copilotkit、interaction、ask-user；
3. datasource/eval：server-datasources、DACOMP、verify-token；
4. seed/test：两个 seed 脚本和 builtin DTC test。

- [ ] **Step 4: 运行核心 smoke**

```bash
npm run smoke:auth
npm run smoke:config-api
npm run smoke:copilotkit-run
npm run smoke:server-datasources
npm run test:auth-foundation
```

Expected: 全部 PASS。

- [ ] **Step 5: 更新 CI**

在 build 后、广泛 smoke 前运行 `npm run test:auth-foundation`。CI 环境显式使用：

```dotenv
DATAFOUNDRY_AUTH_MODE=password
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_REGISTRATION_MODE=open
AUTH_EMAIL_DELIVERY=test
```

- [ ] **Step 6: 分批提交**

```bash
git add scripts/smoke-config-api.mjs scripts/smoke-password-frontend-isolation.mjs
git commit -m "test(auth): migrate config http smoke"

git add scripts/smoke-copilotkit.mjs scripts/smoke-copilotkit-run.mjs scripts/smoke-agent-protocol-deepseek.mjs scripts/smoke-interaction-run-id.mjs scripts/smoke-ask-user-interrupt.mjs
git commit -m "test(auth): migrate agui http smoke"

git add scripts/run-dacomp6-complex-case.mjs scripts/smoke-server-datasources-e2e.mjs scripts/verify-token-usage-display.mjs
git commit -m "test(auth): migrate datasource http smoke"

git add scripts/seed-dtc-growth-demo.mjs scripts/seed-local-fixtures.mjs scripts/test-builtin-dtc-growth-datasource.mjs scripts/auth-foundation.test.mjs .github/workflows/ci.yml
git commit -m "test(auth): enforce formal http authentication"
```

### Task 7: 更新配置样例和阶段文档

**Files:**

- Modify: `.env.example`
- Modify: `apps/web/.env.example`
- Modify: `docs/superpowers/specs/2026-07-22-native-one-click-deployment-design.md`
- Modify: `docs/superpowers/specs/2026-07-23-formal-auth-and-tui-login-design.md`

- [ ] **Step 1: 更新样例**

增加并解释：

```dotenv
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_REGISTRATION_MODE=open
AUTH_EMAIL_DELIVERY=test
```

保留 dev mode 只作为 M0A.5a 到 M0A.5c 之间的临时兼容说明，并明确不得用于新增测试。

- [ ] **Step 2: 文档扫描**

```bash
rg -n "AUTH_REGISTRATION_MODE|AUTH_PUBLIC_BASE_URL|AUTH_EMAIL_DELIVERY" .env.example apps/web/.env.example docs
```

Expected: 样例和设计含义一致，无外部 HTTP + test email 的推荐。

- [ ] **Step 3: 全量验证**

```bash
npm run typecheck
npm run test:web
npm --workspace @datafoundry/tui test
npm run test:auth-foundation
npm run smoke:auth
npm run smoke:config-api
npm run smoke:copilotkit-run
npm run smoke:server-datasources
```

Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add .env.example apps/web/.env.example docs
git commit -m "docs(auth): document formal auth foundation"
```

## M0A.5a exit gate

- 所有需要 HTTP 身份的核心 smoke 能在 password 模式运行。
- 注册 open/closed、loopback HTTP、HTTPS Secure Cookie、test mail 边界均有自动化测试。
- 登录枚举顺序已修复，Web 30 天和 TUI 7 天 Session 可区分。
- 登录响应返回服务端 `session.expiresAt`；CSRF 可通过稳定的 `CSRF_INVALID` 契约轮换一次。
- `GET /api/v1/auth/status` 是真实服务端策略，不暴露敏感配置。
- 旧 dev 模式尚未删除，但新增代码和测试不得依赖它。
