# M0A.5b TUI Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 TUI 通过正式账号登录，安全持久化 7 天 Session，并让 REST 与 AG-UI 共享同一认证传输；支持 Web 注册引导、自动恢复、账号切换和可靠注销，同时删除离线 Demo。

**Architecture:** 在 Ink UI 启动前运行独立认证引导。`TuiAuthClient` 只理解认证接口，`TuiSessionStore` 只负责本地存储，`AuthenticatedTransport` 是 REST 与 AG-UI 唯一网络入口。主 App 只接收已认证客户端和一个认证控制器，不复制 Web 状态，也不抽取 Web/TUI 公共 UI 层。

**Tech Stack:** TypeScript、Node.js 22、Ink/React、原生 `fetch`、`readline/promises`、Node test runner。

---

## Execution baseline

- 必须先合并并通过 M0A.5a。
- 不修改 Web UI 架构，不共享 reducer，不引入设备码或 PAT。
- 不保存密码；日志和异常不得包含 Cookie、CSRF、密码或 `Set-Cookie`。
- 所有客户端通过注入 `fetch` 使用统一传输，不在各模块重复认证逻辑。

### Task 1: 实现 Cookie Jar 和认证类型

**Files:**

- Create: `apps/tui/src/auth/types.ts`
- Create: `apps/tui/src/auth/cookie-jar.ts`
- Create: `apps/tui/src/auth/cookie-jar.test.ts`
- Create: `apps/tui/src/auth/index.ts`
- Modify: `apps/tui/package.json`

- [ ] **Step 1: 写失败测试**

覆盖：

- 解析多个 `Set-Cookie`；
- 仅保留 name/value；
- 生成稳定 `Cookie` header；
- 获取 `df_csrf`；
- 替换 Session 时不混入旧 Cookie；
- `toJSON()` 不存在，避免误日志序列化。

- [ ] **Step 2: 运行并确认失败**

```bash
npm --workspace @datafoundry/tui run build
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现最小接口**

```ts
export type StoredTuiSession = {
  apiBaseUrl: string;
  cookies: Record<string, string>;
  user: { id: string; email: string; displayName?: string };
  workspace: { id: string; name?: string };
  expiresAt: string;
};

export class TuiCookieJar {
  replace(cookies: Record<string, string>): void;
  absorbSetCookie(headers: Headers): void;
  headerValue(): string | undefined;
  csrfToken(): string | undefined;
  snapshot(): Record<string, string>;
  clear(): void;
}
```

实现自定义检查方法，不在错误消息中打印原值。

- [ ] **Step 4: 更新可移植测试命令**

`apps/tui/package.json` 不使用 shell glob：

```json
"test": "npm run build && node --test dist/auth/cookie-jar.test.js dist/ui/components/EnhancedInputBox.test.js"
```

后续任务逐个追加测试文件。

- [ ] **Step 5: 验证并提交**

```bash
npm --workspace @datafoundry/tui test
git add apps/tui/src/auth apps/tui/package.json
git commit -m "feat(tui): add auth cookie jar"
```

### Task 2: 实现按 API 地址隔离的 Session Store

**Files:**

- Create: `apps/tui/src/auth/session-store.ts`
- Create: `apps/tui/src/auth/session-store.test.ts`
- Modify: `apps/tui/src/auth/index.ts`
- Modify: `apps/tui/package.json`

- [ ] **Step 1: 写失败测试**

使用临时目录和注入平台环境，覆盖：

- base URL 规范化保留部署 path，移除尾部 `/`；
- 同一 base URL 新账号替换旧账号；
- 不同 base URL 相互隔离；
- JSON 损坏被隔离并视为无 Session；
- 同目录临时文件 + rename 原子替换；
- Unix 目录 `0700`、文件 `0600`；
- Windows 路径固定在 `%APPDATA%\DataFoundry`，拒绝符号链接和非普通文件。

- [ ] **Step 2: 运行并确认失败**

```bash
npm --workspace @datafoundry/tui test
```

Expected: FAIL。

- [ ] **Step 3: 实现路径和存储**

默认位置：

- Windows：`%APPDATA%\DataFoundry\tui-auth.json`
- Linux：`$XDG_CONFIG_HOME/datafoundry/tui-auth.json` 或 `~/.config/datafoundry/tui-auth.json`
- macOS：`~/Library/Application Support/DataFoundry/tui-auth.json`

接口：

```ts
export class TuiSessionStore {
  load(apiBaseUrl: string): Promise<StoredTuiSession | undefined>;
  save(session: StoredTuiSession): Promise<void>;
  remove(apiBaseUrl: string): Promise<void>;
}
```

不要实现旧格式迁移。损坏文件改名为带时间戳的 `.corrupt`，新建干净文件。

- [ ] **Step 4: 验证并提交**

将测试命令更新为：

```json
"test": "npm run build && node --test dist/auth/cookie-jar.test.js dist/auth/session-store.test.js dist/ui/components/EnhancedInputBox.test.js"
```

```bash
npm --workspace @datafoundry/tui test
git add apps/tui/src/auth apps/tui/package.json
git commit -m "feat(tui): persist sessions per api endpoint"
```

### Task 3: 实现统一 AuthenticatedTransport

**Files:**

- Create: `apps/tui/src/auth/authenticated-transport.ts`
- Create: `apps/tui/src/auth/authenticated-transport.test.ts`
- Modify: `apps/tui/src/auth/index.ts`
- Modify: `apps/tui/package.json`

- [ ] **Step 1: 写失败测试**

覆盖：

- 所有请求携带 Cookie；
- POST/PATCH/PUT/DELETE 添加 CSRF；
- GET 不添加 CSRF；
- 401 触发一次 `onSessionInvalid`，不重试业务请求；
- 只有明确 `CSRF_INVALID` 403 才刷新 CSRF 并重试一次；
- 其他 403 不重试；
- 检查错误码时使用 `response.clone()`，不消费返回给调用方的响应体；
- 首次发送前为可重放 Request 创建 clone；无法 clone 的流式 body 不自动重试；
- 重试仍失败时身份失效；
- 错误文本和日志回调不包含敏感 header。

- [ ] **Step 2: 实现接口**

```ts
export class AuthenticatedTransport {
  constructor(options: {
    cookieJar: TuiCookieJar;
    fetchImpl?: typeof fetch;
    refreshCsrf: () => Promise<void>;
    onSessionInvalid: () => Promise<void>;
  });

  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
```

CSRF 重试必须发生在服务端明确表示请求未进入业务处理时；不要对网络中断或 5xx 自动重放 POST。
这里依赖 M0A.5a 已完成的 CSRF 契约：`POST /api/v1/auth/csrf/refresh` 轮换 Token，
同时返回新 Token 和新 Cookie；其他 `FORBIDDEN` 不得重试。
对 Request 输入，在第一次 `fetch` 前调用 `request.clone()` 保存重放副本；clone
失败时仍发送原请求，但收到 `CSRF_INVALID` 后直接使身份失效，不冒险重复业务请求。

- [ ] **Step 3: 验证并提交**

将 `dist/auth/authenticated-transport.test.js` 追加到明确测试列表。

```bash
npm --workspace @datafoundry/tui test
git add apps/tui/src/auth apps/tui/package.json
git commit -m "feat(tui): add shared authenticated transport"
```

### Task 4: 实现 TuiAuthClient 与账号切换协调器

**Files:**

- Create: `apps/tui/src/auth/auth-client.ts`
- Create: `apps/tui/src/auth/auth-client.test.ts`
- Create: `apps/tui/src/auth/bootstrap.ts`
- Create: `apps/tui/src/auth/bootstrap.test.ts`
- Modify: `apps/tui/src/auth/index.ts`
- Modify: `apps/tui/package.json`

- [ ] **Step 1: 写失败测试**

覆盖：

- status、login、me、csrf、logout 的 URL 和方法；
- login body 固定带 `client: "tui"`；
- `expiresAt` 必须读取登录响应的 `session.expiresAt`，不得本地加七天推算；
- 默认启动先读缓存再 `/me`；
- 缓存的 `expiresAt` 已过期时直接清理，不发 `/me`；
- 缓存失效清除并进入登录；
- `--no-auto-login` 不使用缓存；
- 新登录失败不改旧缓存；
- 新登录成功后 best-effort 注销旧 Session，再原子保存新 Session；
- 旧注销失败保留新账号并返回明确 warning。

- [ ] **Step 2: 实现认证客户端**

```ts
export class TuiAuthClient {
  getStatus(): Promise<AuthStatus>;
  login(email: string, password: string): Promise<StoredTuiSession>;
  me(): Promise<TuiUser>;
  refreshCsrf(): Promise<void>;
  logout(): Promise<void>;
}
```

`login()` 只在内存中使用密码，响应完成后不缓存输入对象。
如果响应缺失合法的 `session.expiresAt`，登录视为协议错误，不保存 Session。

- [ ] **Step 3: 实现无 UI 的 bootstrap 状态机**

```ts
export async function bootstrapTuiAuth(options): Promise<
  | { kind: "authenticated"; session; transport; warning? }
  | { kind: "login-required"; status; previousSession? }
>
```

状态机只返回结果，不直接读取键盘，便于单测。

- [ ] **Step 4: 验证并提交**

将 `dist/auth/auth-client.test.js`、`dist/auth/bootstrap.test.js` 追加到明确测试列表。

```bash
npm --workspace @datafoundry/tui test
git add apps/tui/src/auth apps/tui/package.json
git commit -m "feat(tui): add formal auth client and bootstrap"
```

### Task 5: 实现交互登录和 Web 注册引导

**Files:**

- Create: `apps/tui/src/auth/interactive-login.ts`
- Create: `apps/tui/src/auth/interactive-login.test.ts`
- Create: `apps/tui/src/auth/browser-opener.ts`
- Create: `apps/tui/src/auth/browser-opener.test.ts`
- Modify: `apps/tui/src/auth/index.ts`
- Modify: `apps/tui/package.json`

- [ ] **Step 1: 写失败测试**

注入 prompt、stdout 和 process spawn，覆盖：

- 菜单 1 登录、2 注册、3 退出；
- 密码输入不回显；
- 注册 URL 保留 `publicBaseUrl` 中可能存在的部署路径前缀；
- Windows 使用 `rundll32` 参数数组；
- macOS 使用 `open`；
- Linux 使用 `xdg-open`；
- 不启用 shell；
- 打开失败打印完整可复制 URL；
- 用户回车后回到登录；
- 限流不自动循环请求。

- [ ] **Step 2: 实现安全 prompt**

使用 `readline/promises`，密码输入通过静音 `Writable`，不要把密码放入 history 或 Error。

- [ ] **Step 3: 实现浏览器打开**

```ts
spawn(command, args, {
  shell: false,
  detached: true,
  stdio: "ignore",
});
```

只允许已由 status 返回并通过 HTTP/HTTPS 校验的 URL。不要使用会丢弃部署路径的前导 `/`：

```ts
const base = new URL(publicBaseUrl);
base.pathname = `${base.pathname.replace(/\/?$/, "/")}register`;
base.search = "";
base.hash = "";
```

- [ ] **Step 4: 验证并提交**

将 `dist/auth/interactive-login.test.js`、`dist/auth/browser-opener.test.js`
追加到明确测试列表。

```bash
npm --workspace @datafoundry/tui test
git add apps/tui/src/auth apps/tui/package.json
git commit -m "feat(tui): add interactive login and web registration"
```

### Task 6: 将 REST 与 AG-UI 客户端接入统一传输

**Files:**

- Modify: `apps/tui/src/config/config-client.ts`
- Modify: `apps/tui/src/protocol/copilotkit-client.ts`
- Create: `apps/tui/src/config/config-client.test.ts`
- Create: `apps/tui/src/protocol/copilotkit-client-auth.test.ts`
- Modify: `apps/tui/package.json`

- [ ] **Step 1: 写失败测试**

分别注入 spy fetch，证明：

- ConfigClient 的 REST GET/POST 只调用注入 fetch；
- CopilotKitClient 的 AG-UI POST/SSE 只调用注入 fetch；
- 两者收到的是同一个 transport.fetch；
- 客户端内部没有重新构造认证 header。

- [ ] **Step 2: 修改构造参数**

```ts
type ClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};
```

所有直接 `fetch(...)` 改为 `this.fetchImpl(...)`，默认值仍为 global fetch，方便纯单元测试，但正式入口必须注入认证传输。

- [ ] **Step 3: 验证并提交**

将 `dist/config/config-client.test.js`、
`dist/protocol/copilotkit-client-auth.test.js` 追加到明确测试列表。

```bash
npm --workspace @datafoundry/tui test
git add apps/tui/src/config apps/tui/src/protocol apps/tui/package.json
git commit -m "refactor(tui): share auth transport across rest and agui"
```

### Task 7: 接入 TUI 启动和 `/logout`

**Files:**

- Modify: `apps/tui/src/index.tsx`
- Modify: `apps/tui/src/ui/App.tsx`
- Modify: `apps/tui/src/commands/types.ts`
- Modify: `apps/tui/src/commands/builtinCommands.ts`
- Create: `apps/tui/src/commands/logout-command.test.ts`
- Modify: `apps/tui/package.json`

- [ ] **Step 1: 写失败测试**

覆盖：

- `--no-auto-login` 被解析并传入 bootstrap；
- 未登录时 Ink App 不启动；
- 登录后 ConfigClient 和 CopilotKitClient 共用 transport；
- `/logout` 返回 `logout` 动作；
- 远端注销成功后清理本地 Session 并退出到登录流程；
- 远端不可达时不宣称完整注销；
- 用户明确确认后才执行“仅清本地”。

- [ ] **Step 2: 扩展最小命令上下文**

```ts
export interface AuthCommandController {
  logout(): Promise<
    | { kind: "complete" }
    | { kind: "remote-failed"; clearLocalOnly: () => Promise<void> }
  >;
}
```

`logoutCommand` 只返回：

```ts
{ success: true, message: "Logging out...", data: { action: "logout" } }
```

`App.tsx` 在现有 action switch 中调用 controller。不要让 command 直接读写文件。
远端注销失败时，App 进入一个 Ink 内部确认状态，显示：

```text
无法连接服务端，远端 Session 仍然有效。
[1] 仅清除此设备的登录
[2] 返回
```

只有用户选择 1 才调用 `clearLocalOnly()`。不要退出 alternate screen 后再启动第二套
readline prompt。

- [ ] **Step 3: 修改顶层启动**

将入口拆成可测试的 `runTui()` 循环。每轮顺序固定为：

1. 解析 runtime URL；
2. 查询 auth status；
3. 尝试恢复或交互登录；
4. 创建 `AuthenticatedTransport`；
5. 注入 ConfigClient、CopilotKitClient 和 preflight；
6. 渲染 Ink App。

在 `runTui()` 中定义：

```ts
type AppExitReason = "exit" | "logout";
```

渲染前将 `exitReason` 初始化为 `"exit"`，向 App 注入
`onExit(reason: AppExitReason)`；App 调用该回调后再调用 Ink `exit()`。
`waitUntilExit()` 返回后，`logout` 使顶层循环重新进入认证菜单，`exit` 结束进程。
不要在 React 组件内部递归启动新 App。

- [ ] **Step 4: 验证并提交**

将 `dist/commands/logout-command.test.js` 追加到明确测试列表。

```bash
npm --workspace @datafoundry/tui test
git add apps/tui/src apps/tui/package.json
git commit -m "feat(tui): wire login lifecycle and logout command"
```

### Task 8: 删除离线 Demo

**Files:**

- Modify: `apps/tui/src/index.tsx`
- Delete: `apps/tui/src/protocol/demo-client.ts`
- Delete: `apps/tui/src/state/demo-state.ts`
- Modify: `apps/tui/src/protocol/client.ts`
- Modify: `apps/tui/src/protocol/index.ts`
- Modify: `apps/tui/README.md`
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: TUI usage docs containing `--demo`

- [ ] **Step 1: 添加扫描门禁**

新增测试或 CI 命令，禁止：

```text
--demo
DemoCopilotKitClient
seedDemoState
```

- [ ] **Step 2: 运行并确认失败**

```bash
rg -n --glob "!docs/superpowers/**" -- "--demo|DemoCopilotKitClient|seedDemoState" apps README.md README_zh.md docs
```

Expected: 当前能找到 Demo 入口。

- [ ] **Step 3: 删除 Demo 路径并更新帮助**

TUI API 不可达时只提供重试、换地址、退出；不得自动进入 Demo。

- [ ] **Step 4: 验证并提交**

```bash
npm --workspace @datafoundry/tui test
rg -n --glob "!docs/superpowers/**" -- "--demo|DemoCopilotKitClient|seedDemoState" apps README.md README_zh.md docs
git add -A apps/tui README.md README_zh.md docs
git commit -m "refactor(tui): remove offline demo mode"
```

Expected: 测试 PASS；扫描无输出。

### Task 9: 增加 Web/TUI 共享记录 smoke

**Files:**

- Create: `scripts/smoke-tui-auth-sharing.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 写 smoke**

真实链路：

1. 启动 password API；
2. 创建并验证正式用户；
3. 用 Web 客户端语义创建服务端会话；
4. 用 TUI AuthenticatedTransport 登录同一用户并 `/resume` 读取；
5. 用 TUI 创建另一会话；
6. 用 Web 客户端读取同一会话；
7. 验证 user ID 和 workspace ID 一致；
8. 对 AG-UI 使用确定性模型替身，但认证走真实 Cookie/CSRF。

- [ ] **Step 2: 增加命令**

```json
"smoke:tui-auth-sharing": "npm run build && npm --workspace @datafoundry/tui run build && node scripts/smoke-tui-auth-sharing.mjs"
```

- [ ] **Step 3: 运行全量验收**

```bash
npm run typecheck
npm run test:web
npm --workspace @datafoundry/tui test
npm run test:auth-foundation
npm run smoke:auth
npm run smoke:tui-auth-sharing
```

Expected: 全部 PASS。

- [ ] **Step 4: CI 与提交**

将 `smoke:tui-auth-sharing` 加入核心认证 smoke。

```bash
git add scripts/smoke-tui-auth-sharing.mjs package.json .github/workflows/ci.yml
git commit -m "test(tui): verify web and tui session sharing"
```

## M0A.5b exit gate

- TUI 首次启动可登录或打开 Web 注册，密码不回显、不持久化。
- 默认启动恢复当前 API 的最后一个账号；`--no-auto-login` 可切换账号。
- `/logout` 区分完整注销与仅清本地。
- REST 与 AG-UI 共享一个认证传输。
- Web 与 TUI 登录同一用户后可互相读取服务端会话。
- `--demo`、Demo Client 和自动匿名回退已删除。
