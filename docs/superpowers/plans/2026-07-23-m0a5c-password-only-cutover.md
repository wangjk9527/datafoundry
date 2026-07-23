# M0A.5c Password-Only Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以开发期破坏性重置方式彻底删除 API、Web、Metadata、部署脚本和测试中的 dev 身份路径，使 password Session 成为唯一可运行认证方式。

**Architecture:** 先让所有测试拥有正式 HTTP 身份或显式 metadata fixture，再从外向内删除 dev 分支。新 schema 直接定义 password-only 结构；不迁移旧 schema，不自动清理旧存储。M0A 原生部署默认 loopback HTTP、开放注册和 test mail，外部访问必须由后续 HTTPS 方案承载。

**Tech Stack:** TypeScript、Next.js、Node.js 22、SQLite Metadata、M0A `deploy.sh`/ESM deployment scripts、Node test runner。

---

## Execution baseline

- 必须先合并并通过 M0A.5a、M0A.5b。
- Task 1–5 不依赖 M0A；开始原生部署改造前必须完成本计划的 M0A 集成检查点。
- 这是一次明确的不兼容重置：旧 Metadata、Mastra、workspace/storage 数据直接人工删除。
- 严禁新增 schema migration、启动时自动删除、dev-user 定向清理器或旧数据兼容测试。

### Task 1: 为低层测试建立正式 metadata fixture

**Files:**

- Create: `scripts/lib/metadata-test-identity.mjs`
- Create: `scripts/lib/metadata-test-identity.test.mjs`
- Modify: lower-level smoke/test scripts listed below

- [ ] **Step 1: 写失败测试**

fixture 必须：

- 创建唯一、已验证的正式测试身份；
- 标记邮箱已验证；
- 创建 personal workspace；
- 建立 owner membership；
- 返回 `{ userId, workspaceId, email }`；
- 不创建 Session、不使用 dev token；
- 多次调用不共享身份。

- [ ] **Step 2: 实现 fixture**

```js
export function createVerifiedTestIdentity(metadata, options = {}) {
  const userId = randomUUID();
  const workspaceId = `personal-${userId}`;
  const email = options.email ?? `${userId}@example.test`;
  const user = metadata.users.createPasswordUser({
    id: userId,
    email,
    display_name: options.displayName ?? "Test User",
  });
  metadata.users.markEmailVerified({ user_id: user.id });
  const workspace = metadata.workspaces.createPersonal({
    id: workspaceId,
    owner_user_id: user.id,
    name: options.workspaceName ?? "Test Workspace",
  });
  metadata.workspaceMemberships.upsertOwner({
    workspace_id: workspace.id,
    user_id: user.id,
  });
  return { userId: user.id, workspaceId: workspace.id, email: user.email };
}
```

这是不经过 HTTP 的低层测试数据工厂，不创建密码凭据，因此不能用于登录、路由或端到端测试；
这些测试必须继续使用 M0A.5a 的真实注册客户端。文件名保持
`metadata-test-identity.mjs`，导出名明确为 `createVerifiedTestIdentity`。

- [ ] **Step 3: 迁移直接 metadata/runtime 测试**

逐组替换硬编码 `dev-user`/`default`：

组 A：

- `scripts/smoke-agent-runtime.mjs`
- `scripts/smoke-builtin-datalink.mjs`
- `scripts/smoke-collaboration-tools.mjs`
- `scripts/smoke-conversation-memory.mjs`
- `scripts/smoke-data-gateway.mjs`

组 B：

- `scripts/smoke-files.mjs`
- `scripts/smoke-long-term-memory.mjs`
- `scripts/smoke-memory-recall-shadow.mjs`
- `scripts/smoke-run-config-disabled.mjs`
- `scripts/smoke-run-config-mcp-degraded.mjs`
- `scripts/smoke-run-identity.mjs`

组 C：

- `scripts/smoke-skills.mjs`
- `scripts/smoke-sql-readonly.mjs`
- `scripts/smoke-task-state.mjs`
- `scripts/smoke-tool-state-isolation.mjs`
- `scripts/smoke-trace-sections.mjs`
- `scripts/smoke-protocol-recovery.mjs`

组 D：

- `scripts/smoke-copilotkit-context.mjs`
- `scripts/smoke-run-finalizer.mjs`
- `scripts/smoke-knowledge-retrieval-policy.mjs`
- `scripts/test-builtin-dtc-growth-datasource.mjs`
- `scripts/test-kb-skill-whitelist-fixes.mjs`
- `scripts/verify-tools/knowledge-tool.mjs`
- `scripts/verify-tools/data-tools.mjs`
- `scripts/verify-tools/task-collab-tools.mjs`

`scripts/diagnose-tool-result-events.mjs` 不应自动造身份：改为要求显式 `DATAFOUNDRY_USER_ID` 和 `DATAFOUNDRY_WORKSPACE_ID`。

- [ ] **Step 4: 每组迁移后立即验证**

```bash
npm run typecheck
node --test scripts/lib/metadata-test-identity.test.mjs

npm run smoke:agent
npm run smoke:builtin-datalink
npm run smoke:collaboration
npm run smoke:conversation-memory
npm run smoke:data-gateway

npm run smoke:files
npm run smoke:long-term-memory
npm run smoke:memory-recall-shadow
npm run smoke:run-config-disabled
npm run build && node scripts/smoke-run-config-mcp-degraded.mjs
npm run smoke:run-identity

npm run smoke:skills
npm run smoke:sql
npm run smoke:task-state
npm run smoke:tool-state
npm run smoke:trace-sections
npm run build && node scripts/smoke-protocol-recovery.mjs

npm run smoke:api-context
npm run build && node scripts/smoke-run-finalizer.mjs
npm run smoke:knowledge-policy
npm run test:builtin-dtc-growth
npm run build && node scripts/test-kb-skill-whitelist-fixes.mjs
```

Expected: 每组对应命令全部 PASS。`scripts/verify-tools/*.mjs` 是被 smoke
导入的 helper，由 typecheck 和调用它们的 smoke 覆盖。

- [ ] **Step 5: 每组通过后立即提交**

```bash
git add scripts/lib scripts/smoke-agent-runtime.mjs scripts/smoke-builtin-datalink.mjs scripts/smoke-collaboration-tools.mjs scripts/smoke-conversation-memory.mjs scripts/smoke-data-gateway.mjs
git commit -m "test(auth): migrate core runtime identity fixtures"

git add scripts/smoke-files.mjs scripts/smoke-long-term-memory.mjs scripts/smoke-memory-recall-shadow.mjs scripts/smoke-run-config-disabled.mjs scripts/smoke-run-config-mcp-degraded.mjs scripts/smoke-run-identity.mjs
git commit -m "test(auth): migrate storage identity fixtures"

git add scripts/smoke-skills.mjs scripts/smoke-sql-readonly.mjs scripts/smoke-task-state.mjs scripts/smoke-tool-state-isolation.mjs scripts/smoke-trace-sections.mjs scripts/smoke-protocol-recovery.mjs
git commit -m "test(auth): migrate tool identity fixtures"

git add scripts/smoke-copilotkit-context.mjs scripts/smoke-run-finalizer.mjs scripts/smoke-knowledge-retrieval-policy.mjs scripts/test-builtin-dtc-growth-datasource.mjs scripts/test-kb-skill-whitelist-fixes.mjs scripts/verify-tools scripts/diagnose-tool-result-events.mjs
git commit -m "test(auth): finish low-level identity migration"
```

### Task 2: 删除 API 请求认证模式和匿名回退

**Files:**

- Modify: `apps/api/src/auth/config.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Modify: `scripts/auth-foundation.test.mjs`
- Modify: `scripts/smoke-auth.mjs`

- [ ] **Step 1: 添加失败测试**

覆盖：

- 无 Cookie 的所有业务 REST/AG-UI 请求返回 401；
- `X-Dev-Token` 不授权；
- 开发 Bearer 不授权；
- `X-Workspace-Id` 不创建身份；
- 健康检查和 auth public routes 仍公开；
- API 不读取 `DATAFOUNDRY_AUTH_MODE`；
- 未配置 password 必需项时拒绝启动。

- [ ] **Step 2: 删除分支**

- 删除 `AuthMode = "dev" | "password"`；
- password config 成为唯一 `AuthConfig`；
- 删除 `DEV_USER`；
- `resolveRequestAuth()` 只接受正式 Session Cookie；
- CSRF 对所有 unsafe 业务请求统一生效；
- auth routes 无条件挂载；
- 删除 Bearer/dev token/workspace header 身份解析。

- [ ] **Step 3: 验证**

```bash
npm run test:auth-foundation
npm run smoke:auth
npm run smoke:copilotkit-run
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/auth apps/api/src/server.ts scripts/auth-foundation.test.mjs scripts/smoke-auth.mjs
git commit -m "refactor(api): make password sessions the only auth mode"
```

### Task 3: 删除开发用户配置 API

**Files:**

- Modify: `apps/api/src/config-api.ts`
- Modify: `scripts/smoke-config-api.mjs`

- [ ] **Step 1: 写失败断言**

- `/api/v1/dev/users` 返回 404；
- 正式用户配置 API 仍按 Session 工作；
- 全局路由表不包含 dev namespace。

- [ ] **Step 2: 删除实现**

删除开发用户的 list/create/select helper、响应类型和路由分支。不要保留“暂时不可用”的 410 兼容接口。

- [ ] **Step 3: 验证并提交**

```bash
npm run smoke:config-api
rg -n "/api/v1/dev/users|X-Dev-Token" apps/api scripts
git add -A apps/api scripts
git commit -m "refactor(api): remove development user endpoints"
```

Expected: smoke PASS；扫描仅允许设计历史文档命中。

### Task 4: 从新 Metadata schema 删除 dev token 和默认用户

**Files:**

- Modify: `packages/metadata/src/index.ts`
- Modify: metadata tests and callers
- Modify: `scripts/smoke-metadata.mjs`

- [ ] **Step 1: 写新 schema 失败测试**

用全新临时数据库断言：

- `users` 表没有 `dev_token`；
- 初始化后没有 `dev-user`；
- password 用户、workspace、membership、Session 正常；
- 不运行任何旧 schema 升级。

- [ ] **Step 2: 删除产品代码**

删除：

- `UserRecord.devToken`；
- `DEFAULT_DEV_USER`；
- `upsertDevUser()`；
- `getByDevToken()`；
- 初始化自动 upsert；
- schema 中 `dev_token TEXT UNIQUE`。

保留正式 password 用户方法。

- [ ] **Step 3: 验证**

```bash
npm run typecheck
npm run smoke:metadata
node --test scripts/lib/metadata-test-identity.test.mjs
```

- [ ] **Step 4: 提交**

```bash
git add packages/metadata scripts/smoke-metadata.mjs scripts/lib
git commit -m "refactor(metadata): remove development identities from fresh schema"
```

### Task 5: 删除 Web 开发身份路径

**Files:**

- Modify: `apps/web/src/lib/config-api/client.ts`
- Modify: `apps/web/src/app/data-tasks/data-task-identity.tsx`
- Modify: `apps/web/src/components/auth/auth-flow.tsx`
- Modify: `apps/web/src/app/login/login-client.tsx`
- Modify: `apps/web/src/app/register/register-client.tsx`
- Modify: `apps/web/src/lib/config-api/types.ts`
- Modify: `apps/web/src/lib/config-api/index.ts`
- Modify: `apps/web/src/app/data-tasks/__tests__/config-api-adapter.test.ts`
- Modify: `apps/web/src/app/data-tasks/__tests__/identity-menu.test.ts`
- Modify: `apps/web/.env.example`

- [ ] **Step 1: 写/调整失败测试**

覆盖：

- 只有 password provider；
- 未登录跳转登录页；
- 请求不添加开发 Bearer、`X-Dev-Token`、`X-Workspace-Id`；
- 登录和注册不再按 env mode 分支；
- Web 从 `GET /api/v1/auth/status` 读取注册策略；
- closed registration 根据 auth status 隐藏入口，直接提交仍由 API 拒绝。

- [ ] **Step 2: 删除模式判断**

删除：

- `isPasswordAuthMode`；
- `NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE`；
- `DevIdentityUser`；
- localStorage dev identity；
- Continue as Dev User；
- dev user create/switch UI。

Web 始终使用 Cookie + CSRF BFF/客户端链路。`config-api/client.ts` 增加公开的 `getAuthStatus()`；`auth-flow.tsx` 在 login 模式根据 `registrationEnabled` 决定是否显示注册链接。直接访问 `/register` 且注册关闭时，显示“注册已关闭，请联系部署管理员”，不能渲染一个最终必定失败的表单。

- [ ] **Step 3: 验证**

```bash
npm run test:web
npm run build:web
rg -n "NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE|DevIdentity|Continue as Dev|X-Dev-Token" apps/web
```

Expected: 测试和 build PASS；扫描无运行时代码命中。

- [ ] **Step 4: 提交**

```bash
git add -A apps/web
git commit -m "refactor(web): remove development identity mode"
```

### Task 6: 集成 M0A 原生部署基线

**Prerequisite:** PR #82 已合并到目标主分支，或其提交可以被明确 cherry-pick。

**Files:**

- Reconcile: `.env.example`
- Reconcile: `package.json`
- Reconcile: `.github/workflows/ci.yml`
- Reconcile: deployment and quick-start docs
- Verify: `deploy.sh`
- Verify: `scripts/deploy/args.mjs`
- Verify: `scripts/deploy/bootstrap.sh`
- Verify: `scripts/deploy/cli.mjs`
- Verify: `scripts/deploy/config.mjs`
- Verify: `scripts/deploy/controller.mjs`
- Verify: `scripts/deploy/dependencies.mjs`
- Verify: `scripts/deploy/health.mjs`
- Verify: `scripts/deploy/ports.mjs`
- Verify: `scripts/deploy/process-state.mjs`

- [ ] **Step 1: 将 M0A 合入当前 M0A.5c 工作分支**

```bash
git merge --no-commit --no-ff origin/pr/82
```

Expected: 执行计划时已经通过 worktree skill 位于独立的 M0A.5c 分支；PR #82
部署文件进入当前分支。如有冲突，只解决上述明确文件。

- [ ] **Step 2: 解决配置语义冲突**

冲突解决规则：

- 保留 M0A 的端口探测、生命周期、status/logs/stop/reconfigure/non-interactive；
- 保留 M0A.5a 的 `AUTH_REGISTRATION_MODE`、公共 URL 校验和 test mail 边界；
- 保留 M0A.5b 的 TUI 正式登录入口；
- 暂时保留 M0A 生成的 auth mode 行，Task 7 的失败测试负责删除，避免在集成提交中混入行为变更。

- [ ] **Step 3: 运行未改造的 M0A 回归**

```bash
node --test scripts/deploy/args.test.mjs scripts/deploy/bootstrap.test.mjs scripts/deploy/cli.test.mjs scripts/deploy/config.test.mjs scripts/deploy/controller.test.mjs scripts/deploy/dependencies.test.mjs scripts/deploy/health.test.mjs scripts/deploy/lifecycle.test.mjs scripts/deploy/ports.test.mjs scripts/deploy/process-state.test.mjs scripts/stack-runtime-config.test.mjs
```

Expected: PASS。若现有断言因 M0A.5 配置变更失败，只允许更新冲突文件中的输入，
不得提前实现 Task 7。

- [ ] **Step 4: 提交集成结果**

```bash
git add .env.example package.json .github/workflows/ci.yml deploy.sh scripts/deploy scripts/stack-runtime-config.mjs scripts/stack-runtime-config.test.mjs docs
git commit -m "chore(deploy): integrate m0a baseline for auth cutover"
```

### Task 7: 将 M0A 原生部署改为 password-only 安全默认值

**Files from PR #82:**

- Modify: `scripts/deploy/config.mjs`
- Modify: `scripts/deploy/config.test.mjs`
- Modify: `scripts/deploy/bootstrap.sh`
- Modify: `scripts/deploy/bootstrap.test.mjs`
- Modify: `scripts/deploy/cli.mjs`
- Modify: `scripts/deploy/cli.test.mjs`
- Modify: `scripts/stack-runtime-config.mjs`
- Modify: `scripts/stack-runtime-config.test.mjs`
- Modify: `scripts/smoke-native-deploy.mjs`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/en/quick-start.md`
- Modify: `docs/zh/quick-start.md`

- [ ] **Step 1: 写失败测试**

默认非交互配置必须为：

```dotenv
WEB_HOST=127.0.0.1
API_HOST=127.0.0.1
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_REGISTRATION_MODE=open
AUTH_EMAIL_DELIVERY=test
```

并覆盖：

- Web 选择 3100 时生成 `AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3100`；
- 不再生成 `DATAFOUNDRY_AUTH_MODE`；
- 不再生成 `NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE`；
- 用户选择非 loopback host 时，原生脚本拒绝普通 HTTP 并解释 SSH 转发/HTTPS；
- 端口选择逻辑保持 M0A 已批准行为；
- `--non-interactive` 使用上述默认值完成；
- `--reconfigure` 可显式配置 HTTPS 公共 URL 和 SMTP。

- [ ] **Step 2: 修改生成器**

`renderApiEnvironment()` 与 `renderWebEnvironment()` 只生成正式配置。不要把模型配置塞入部署问答；模型仍由 Web 首次配置。

- [ ] **Step 3: 修改 runtime config 默认 host**

将 PR #82 当前 `WEB_HOST: "0.0.0.0"` 改为 `127.0.0.1`，API 同理。远程原生部署通过 SSH 转发访问。

- [ ] **Step 4: 验证**

```bash
node --test scripts/deploy/args.test.mjs scripts/deploy/bootstrap.test.mjs scripts/deploy/cli.test.mjs scripts/deploy/config.test.mjs scripts/deploy/controller.test.mjs scripts/deploy/dependencies.test.mjs scripts/deploy/health.test.mjs scripts/deploy/lifecycle.test.mjs scripts/deploy/ports.test.mjs scripts/deploy/process-state.test.mjs scripts/stack-runtime-config.test.mjs
npm run build
node scripts/smoke-native-deploy.mjs
```

- [ ] **Step 5: 提交**

```bash
git add deploy.sh scripts/deploy scripts/stack-runtime-config.mjs scripts/stack-runtime-config.test.mjs scripts/smoke-native-deploy.mjs .env.example docs
git commit -m "feat(deploy): default native installs to loopback password auth"
```

### Task 8: 删除开发专属脚本并写人工重置手册

**Files:**

- Delete: `scripts/clear-session-history.mjs`
- Modify: `scripts/diagnose-tool-result-events.mjs`
- Create: `docs/development/password-only-reset.md`
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/en/quick-start.md`
- Modify: `docs/zh/quick-start.md`
- Modify: `docs/en/security.md`
- Modify: `docs/zh/security.md`

- [ ] **Step 1: 写重置手册**

必须明确：

1. 停止 Web、API、DataLink；
2. 读取实际 `.env`；
3. 分别解析并人工确认 `STORAGE_ROOT_DIR`、`METADATA_DB_PATH`、`MASTRA_STORAGE_PATH`、`FILE_ASSET_STORAGE_ROOT`、`WORKSPACE_ROOT`；
4. 仅删除或移走这些已确认的具体路径；
5. 启动新版本并重新注册。

醒目标注会删除全部旧用户、会话、文件、Memory、Agent 状态和配置。

不要提供一个会自动递归删除的脚本；不要使用 glob、仓库根、用户主目录或未解析变量。

- [ ] **Step 2: 删除误导入口**

删除 `clear-session-history.mjs`，因为它只清理部分数据，会让开发者误以为已完成 password-only 重置。

- [ ] **Step 3: 验证文档**

```bash
npm run smoke:docs
rg -n "clear-session-history|dev-token|X-Dev-Token|DATAFOUNDRY_AUTH_MODE|--demo" apps packages scripts
rg -n --glob "!docs/superpowers/**" "dev user|dev-token|X-Dev-Token|DATAFOUNDRY_AUTH_MODE|--demo" README.md README_zh.md docs
```

Expected: 第一条扫描无输出；第二条只允许
`docs/development/password-only-reset.md` 的解释性文字命中，代码块不得命中。

- [ ] **Step 4: 提交**

```bash
git add -A scripts docs README.md README_zh.md
git commit -m "docs(auth): document destructive password-only reset"
```

### Task 9: 建立最终无旁路门禁并全量回归

**Files:**

- Create: `scripts/password-only-cutover.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 实现源码扫描测试**

在产品代码、脚本和可复制命令示例中禁止可运行引用：

```text
DATAFOUNDRY_AUTH_MODE
NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE
X-Dev-Token
dev-token
DEFAULT_DEV_USER
upsertDevUser
getByDevToken
DemoCopilotKitClient
--demo
```

扫描规则：

- 产品代码和脚本对上述字符串零容忍；
- 排除 `docs/superpowers/specs`、`docs/superpowers/plans`，它们保留历史决策；
- `docs/development/password-only-reset.md` 可以在普通叙述中解释旧术语，但 fenced
  code block 和单行命令不得包含可运行的开发认证配置；
- README 和 quick-start 的 fenced code block、环境变量示例零容忍；
- 测试必须解析 Markdown fenced code block，不能仅做全文件字符串搜索。

另用全新临时 Metadata DB 断言 schema 不含 `dev_token`、初始化无默认用户。

- [ ] **Step 2: 增加 CI 命令**

```json
"test:password-only": "npm run build && node --test scripts/password-only-cutover.test.mjs"
```

CI 在所有核心 smoke 前执行。

- [ ] **Step 3: 全量验证**

```bash
npm run typecheck
npm run test:web
npm --workspace @datafoundry/tui test
npm run test:auth-foundation
npm run test:password-only
npm run smoke:auth
npm run smoke:config-api
npm run smoke:copilotkit-run
npm run smoke:server-datasources
npm run smoke:tui-auth-sharing
npm run smoke:metadata
npm run smoke:docs
node scripts/smoke-native-deploy.mjs
```

Expected: 全部 PASS。

- [ ] **Step 4: 人工验收**

- 清空一套测试存储；
- 执行 M0A 原生部署；
- Web 注册、test mail 验证并登录；
- TUI 登录同一账号；
- 双向创建/恢复会话；
- `/logout`；
- `--no-auto-login` 切换第二账号；
- 验证未登录 REST/AG-UI 被拒绝。

记录命令、版本、平台和结果，但不记录任何 Secret/Cookie。

- [ ] **Step 5: 最终提交**

```bash
git add scripts/password-only-cutover.test.mjs package.json .github/workflows/ci.yml
git commit -m "test(auth): enforce password-only cutover"
```

## M0A.5c exit gate

- API、Web、TUI、部署脚本和正式测试不存在可运行 dev 身份入口。
- 新 Metadata schema 不含 `dev_token`，启动不创建默认开发用户。
- M0A 默认仅监听 loopback HTTP，注册 open、邮件 test；外部 HTTP 被拒绝。
- 旧数据处理只有人工全量重置手册，没有迁移或自动清理代码。
- 正式注册、验证、Session、CSRF、REST、AG-UI、Web/TUI 共享和原生部署 smoke 全部通过。
- 达到上述门槛后，才开始 M0B Docker 镜像与 Compose 实施。
