# DataFoundry 正式认证统一与 TUI 登录设计

日期：2026-07-23

状态：已确认，待实施计划

里程碑：M0A.5（位于 M0A 原生部署与 M0B Docker Compose 之间）

相关规格：

- [DataFoundry 工程与企业交付演进路线](./2026-07-22-datafoundry-evolution-roadmap-design.md)
- [原生一键部署设计](./2026-07-22-native-one-click-deployment-design.md)

## 1. 背景

当前 Web 已支持 password 认证、Session Cookie、CSRF、邮箱验证和密码重置，但 TUI 不会登录，也不会为 REST 或 AG-UI 请求携带 Cookie 和 CSRF。API 同时保留 `dev` 与 `password` 两套身份路径：开发模式允许匿名回退到 `dev-user/default`，Web 还支持本地开发身份切换。这导致以下问题：

- password 部署中的 TUI 实际不可用；
- Web 与 TUI 只有在开发模式默认身份下才可能共享记录；
- 正式链路和开发链路可能产生行为漂移；
- Docker 化 TUI 只能解决运行环境，不能解决身份问题；
- `--demo` 形成第三套不连接真实 API 的行为。

M0A.5 在进入容器化前统一身份语义，使 Web、TUI、REST 和 AG-UI 都通过同一正式认证链路访问同一服务端用户与工作区。

## 2. 目标

1. 删除可运行的开发认证模式，只保留正式 password 认证。
2. 为 TUI 增加登录、Web 注册引导、Session 恢复、账号切换和注销。
3. 让 REST 与 AG-UI 共用同一 TUI 认证上下文。
4. 登录同一 API 实例和同一用户时，Web 与 TUI 可以查看并恢复同一批服务端记录。
5. 删除 TUI 离线 Demo 路径，所有验收均连接真实 API。
6. 将 M0A.5 定义为开发期不兼容重置点，不投入旧存储迁移代码。
7. 为 M0B 的按需 TUI 容器和默认部署所有者提供稳定认证基础。

## 3. 非目标

M0A.5 不实现：

- Personal Access Token；
- device-code 或浏览器回调自动授权；
- 多组织、角色和自定义权限；
- Web/TUI 公共 reducer 或共享 UI 状态；
- 多账号 Session 选择器；
- TUI 密码持久化；
- Dockerfile、Compose 或镜像发布；
- 实时双端协作与同一会话的并发冲突合并；
- 旧 Metadata、Mastra 状态、文件或 workspace 的迁移、兼容和恢复入口；
- 系统密钥链集成。

PAT 和 device-code 仍可在 M1 作为非交互认证、自动化和更强终端授权体验继续演进。

## 4. 已确认决策

| 主题 | 决策 |
| --- | --- |
| 里程碑位置 | 新增 M0A.5，完成后再进入 M0B。 |
| 认证模式 | 从 API、Web、TUI 和正式测试中彻底删除开发认证模式。 |
| TUI 注册 | 打开 Web 注册页；注册和验证完成后回到 TUI 手动输入邮箱与密码。 |
| Session 保存 | 本地持久化 Session Cookie 和 CSRF Token，不保存密码。 |
| 账号数量 | 每个 API 地址只保留最后一次登录的一个账号。 |
| 账号切换 | `--no-auto-login` 忽略缓存并要求登录；新登录成功后先尝试注销旧 Session，再替换缓存。 |
| TUI Session | 持久化，有效期 7 天；Web Session 继续使用现有期限。 |
| 离线 Demo | 删除 `--demo` 和 `DemoCopilotKitClient`。 |
| 旧开发数据 | 不开发迁移或自动清理；停止服务后人工删除整个旧存储并重新注册。 |
| 网络边界 | M0A 默认只监听 loopback HTTP；非 loopback 访问必须使用 HTTPS。 |
| 注册策略 | M0A.5 loopback 开发默认 `open`；M0B 创建默认所有者后默认 `closed`。 |
| 测试方式 | 端到端和路由验收走真实注册、验证、登录、Cookie 与 CSRF。 |
| 交付拆分 | M0A.5a 正式认证基础、M0A.5b TUI 登录、M0A.5c 破坏性收口。 |
| M0B 衔接 | M0B 再增加默认部署所有者的创建和 TUI 自动登录凭据来源。 |

## 5. 统一认证架构

### 5.1 API

API 不再解析 `DATAFOUNDRY_AUTH_MODE`，也不再根据 `NODE_ENV` 切换身份行为。password 认证配置成为所有环境的唯一配置：

- `AUTH_SESSION_SECRET` 必填且必须满足长度要求；
- `AUTH_PUBLIC_BASE_URL` 必填；
- `AUTH_REGISTRATION_MODE` 必须为 `open` 或 `closed`；
- 邮件投递为 `smtp` 或 `test`；
- `test` 只替换邮件发送，注册、令牌生成、邮箱验证和登录逻辑保持正式路径。

删除：

- `AuthMode = "dev" | "password"` 分支；
- 匿名 `DEV_USER` 回退；
- `dev-token`；
- `X-Dev-Token`；
- Bearer 开发用户查询；
- `X-Workspace-Id` 驱动的开发工作区伪身份；
- 创建、选择和存储开发用户的 API。

健康检查和认证公开入口保持无需登录。其他用户数据、配置、REST 和 AG-UI 接口必须通过正式 Session。

#### 5.1.1 网络与 Cookie

M0A.5 只允许两种网络形态：

1. loopback HTTP：Web 和公共 URL 均为 `127.0.0.1` 或 `localhost`，Cookie 可以不带 `Secure`；
2. HTTPS：对局域网或公网提供服务时，Session Cookie 必须带 `Secure`。

非 loopback 的 HTTP 公共 URL 属于非法配置，API 必须拒绝启动。不得为了让公网 HTTP 登录可用而关闭 Cookie 安全属性。

M0A 默认：

```dotenv
WEB_HOST=127.0.0.1
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000
```

远程 M0A 验证通过 SSH 端口转发访问。M0B 再通过 Caddy HTTPS overlay 提供正式外部入口。Cookie 安全策略必须由经过校验的公共 URL 和显式部署规则决定，不能继续只依赖 `NODE_ENV`。

#### 5.1.2 注册策略

`AUTH_REGISTRATION_MODE` 的服务端语义为：

- `open`：显示注册入口并允许 `POST /api/v1/auth/register`；
- `closed`：隐藏注册入口，同时由服务端拒绝注册请求。

`registrationEnabled` 必须反映真实的服务端策略，不能只是 UI 提示。M0A.5 的 loopback 开发验证默认 `open`，方便注册多个测试账号。`AUTH_EMAIL_DELIVERY=test` 只允许 loopback 公共 URL；外部 HTTPS 部署开启注册时必须配置 SMTP。

新增公开接口：

```http
GET /api/v1/auth/status
```

响应至少包含：

```json
{
  "publicBaseUrl": "http://localhost:3000",
  "registrationEnabled": true
}
```

该接口不返回 Secret、用户信息、SMTP 配置或内部网络地址。TUI 使用它生成 Web 注册和登录链接。

#### 5.1.3 登录防枚举

登录按以下顺序处理：

1. 查询用户和密码凭据；
2. 用户不存在时执行一次固定的伪密码哈希校验，降低时间差异；
3. 用户存在时先验证密码；
4. 用户不存在或密码错误统一返回 `Invalid email or password`；
5. 只有密码正确后，才能返回“邮箱尚未验证”；
6. 保留邮箱和来源 IP 两层限流。

Web 与 TUI 使用相同错误码映射。密码、Cookie 和 CSRF 不得进入审计详情或普通日志。

### 5.2 Web

Web 只保留 password 身份提供器。删除：

- `Dev User` 默认身份；
- 浏览器 localStorage 中的开发身份；
- 本地开发用户创建与切换；
- `Continue as Dev User`；
- 开发 Bearer Token 和 `X-Workspace-Id` 请求头。

本地开发、部署验证和生产部署使用相同的注册、验证、登录、Session 与 CSRF 行为。测试环境可以通过 `AUTH_EMAIL_DELIVERY=test` 在 Web 展示验证令牌，不依赖真实 SMTP。

### 5.3 TUI

TUI 增加三个边界清晰的组件：

1. `TuiAuthClient`
   - 查询公开认证状态；
   - 登录；
   - 调用 `/api/v1/auth/me` 验证身份；
   - 获取或刷新 CSRF；
   - 注销。
2. `TuiSessionStore`
   - 按规范化 API base URL 保存 Session；
   - 每个 base URL 只保存最后一个账号；
   - 原子写入和安全清理；
   - 不保存密码。
3. `AuthenticatedTransport`
   - 为 REST 和 AG-UI 统一附加 Cookie；
   - 为 unsafe method 附加 CSRF；
   - 统一处理身份过期、CSRF 刷新和敏感信息脱敏。

这不是 Web/TUI 公共运行时重构。Web 与 TUI 仍保留独立 UI 和状态实现，只统一服务端认证契约以及 TUI 内部两个协议客户端的认证传输。

## 6. TUI 用户流程

### 6.1 默认启动

TUI 启动时：

1. 解析 `--runtime-url` 并得到包含部署路径的规范化 API base URL。
2. 调用 `/api/v1/auth/status`。
3. 读取该 base URL 对应的本地 Session。
4. 携带 Session 调用 `/api/v1/auth/me`。
5. Session 有效则显示当前用户并进入主界面。
6. Session 缺失、过期或已撤销则清理缓存并进入未登录界面。

未登录界面：

```text
DataFoundry TUI

尚未登录

[1] 登录已有账户
[2] 前往 Web 注册
[3] 退出
```

### 6.2 登录

- 邮箱为普通文本输入；
- 密码隐藏输入，不出现在历史、日志或错误对象中；
- 登录请求声明客户端类型为 `tui`，服务端签发 7 天 Session；
- 登录成功后保存 `df_session`、`df_csrf`、用户显示信息和过期信息；
- 再次调用 `/api/v1/auth/me` 确认身份和工作区；
- 登录失败保留在认证界面并允许用户重试或返回。

### 6.3 Web 注册

选择“前往 Web 注册”后：

1. 使用 `publicBaseUrl` 构造 `/register`；
2. 尝试通过跨平台安全打开能力打开浏览器；
3. 无法打开时显示可复制的完整 URL；
4. 提示用户在 Web 完成注册和邮箱验证；
5. 用户返回 TUI 并按 Enter；
6. TUI 进入邮箱和密码登录，不轮询浏览器状态，也不自动获取授权。

URL 只接受合法 HTTP/HTTPS 地址。不得通过拼接 Shell 命令打开浏览器。

### 6.4 自动恢复与账号切换

```bash
datafoundry-tui
```

验证并恢复当前 API 地址最后保存的 Session。

```bash
datafoundry-tui --no-auto-login
```

忽略该 API 地址已有 Session，直接进入登录。切换流程为：

1. 在内存中保留旧 Session；
2. 完成新账号登录；
3. 使用旧 Session 尝试正式注销；
4. 原子保存新 Session；
5. 旧 Session 注销失败时仍保留新登录，但必须提示用户从 Web Session 管理中撤销旧 Session。

新登录失败时不修改旧缓存。

### 6.5 注销

TUI 提供 `/logout`：

- 服务端可达时先调用正式 logout，再删除本地 Session；
- 服务端不可达时，用户可以明确确认“仅清除本地登录”；
- 仅本地清理时提示远端 Session 将保留到过期或被其他端注销；
- 不允许静默把远端失败显示为完整注销成功。

## 7. Session 存储

默认位置：

- Windows：`%APPDATA%\DataFoundry\tui-auth.json`
- Linux：`$XDG_CONFIG_HOME/datafoundry/tui-auth.json`，未设置时使用 `~/.config/datafoundry/tui-auth.json`
- macOS：`~/Library/Application Support/DataFoundry/tui-auth.json`

存储规则：

- key 为规范化 API base URL，包括 scheme、host、有效端口和部署路径；
- 同一文件可以保存多个 API base URL，但每个 base URL 只有一个账号；
- 采用同目录临时文件、flush 和原子替换；
- Unix 文件权限为 `0600`，目录权限为 `0700`；
- Windows 只允许使用当前用户 `%APPDATA%` 下的固定目录，验证目标为普通文件且不跟随链接；
- JSON 损坏时隔离或删除损坏记录，不能带着部分 Cookie 继续请求；
- 日志禁止输出 Cookie、CSRF、密码和 `Set-Cookie`；
- 日志、诊断包和备份默认排除认证文件。

M0A.5 不承诺操作系统密钥链加密。TUI Session 有效期为 7 天；能读取该文件的本机用户权限主体可以在 Session 失效前使用该身份，这是选择文件持久化方案的已知边界。

## 8. REST、AG-UI 与记录共享

`AuthenticatedTransport` 为两个客户端提供同一身份：

- REST GET 携带 Session Cookie；
- REST POST/PATCH/DELETE 携带 Session Cookie 和 CSRF；
- AG-UI POST/SSE 携带相同 Session Cookie 和 CSRF；
- 下载和文本响应继续使用相同 Cookie；
- 身份过期统一回到登录入口。

共享记录的必要条件是：

```text
同一个 API 实例
+ 同一个用户 ID
+ 同一个工作区
= Web 与 TUI 访问同一服务端记录
```

TUI 创建的会话应能在 Web 会话列表中打开；Web 创建的会话应能通过 TUI `/resume list`、`/resume latest` 或指定 Session ID 恢复。M0A.5 不承诺两个客户端同时修改同一会话时的实时合并。

## 9. 错误处理

### 9.1 连接错误

API 不可达时显示当前地址，并提供：

1. 重试；
2. 使用其他地址；
3. 退出。

不得自动进入 Demo、匿名模式或离线伪连接。

### 9.2 认证错误

- 账号或密码错误：使用统一提示，不泄漏账号是否存在；
- 邮箱未验证：提示先在 Web 完成验证，并提供 Web 地址；
- 请求限流：显示等待提示，不自动连续重试；
- Session 过期或撤销：清理本地记录并返回登录；
- CSRF 失效：只有收到服务端明确的 CSRF 拒绝（请求尚未进入业务处理）时，才重新获取一次 CSRF 并重试原请求一次；
- CSRF 重试仍失败：清理身份并要求重新登录；
- 服务端错误：显示稳定错误码和简短信息，不输出敏感响应头或完整内部错误。

## 10. 删除开发模式与开发期存储重置

### 10.1 代码清理

删除：

- API 的开发认证类型、分支、令牌解析和用户管理接口；
- Web 的开发身份状态、界面、存储和请求头；
- TUI 的 `--demo`、`DemoCopilotKitClient` 和专属 fixture；
- 指导用户使用 Dev User、dev token 或 Demo 的文档；
- 仅证明开发旁路可用的测试。

新建 Metadata schema 不再包含 `dev_token`，Metadata 初始化不再创建 `dev-user`。产品代码中不保留旧身份的登录、查询、清理或兼容路径。

### 10.2 开发期不兼容重置

M0A.5 是明确的开发期不兼容重置点。旧数据没有保留承诺，因此：

- 不开发数据库迁移；
- 不开发跨 Metadata、Mastra 和文件系统的清理协调器；
- 不开发旧 schema 兼容层；
- 不在 API 启动时自动删除任何存储；
- 不测试旧存储升级。

切换到 password-only 版本前，由开发人员执行一次人工操作：

1. 停止 Web、API 和 DataLink；
2. 读取实际 `.env`，确认 `STORAGE_ROOT_DIR`、`METADATA_DB_PATH`、`MASTRA_STORAGE_PATH`、`FILE_ASSET_STORAGE_ROOT` 和 `WORKSPACE_ROOT`；
3. 删除或移走这些明确解析出的旧开发存储；
4. 启动新版本，让应用创建干净 schema；
5. 重新注册并验证第一个正式用户。

不得用未解析环境变量、glob、仓库根目录或用户主目录作为删除目标。开发手册必须明确：该操作会删除所有旧用户、会话、配置、文件、Memory 和 Agent 状态，而不仅是 `dev-user`。

## 11. 测试策略

### 11.1 单元测试

- Session key 规范化；
- 多 API base URL 隔离和单账号替换；
- Cookie 与 CSRF 解析、注入和脱敏；
- Session 文件原子写入、损坏处理和权限；
- TUI 7 天 Session 与 Web Session 期限区分；
- 新账号登录成功后的旧 Session 注销；
- 登录状态机和注册返回流程；
- CSRF 单次刷新重试；
- URL 校验和安全浏览器打开参数。

纯函数与组件测试可以使用直接 fixture，不要求每个单元测试启动 HTTP 服务；这不构成开发认证模式。

### 11.2 API 路由与集成测试

所有受保护路由测试通过以下正式链路获得身份：

1. 注册；
2. 读取 test 邮件验证令牌；
3. 验证邮箱；
4. 登录；
5. 使用 Session Cookie 和 CSRF。

覆盖：

- 无 Cookie 的业务请求被拒绝；
- `X-Dev-Token`、`dev-token` 和开发 Bearer 不再授权；
- loopback HTTP 可登录，非 loopback HTTP 拒绝启动，HTTPS Cookie 强制 `Secure`；
- `open` 允许注册，`closed` 同时在 UI 和 API 拒绝注册；
- test 邮件模式在非 loopback 公共 URL 下拒绝启动；
- 不存在用户与错误密码的响应保持统一，只有正确密码才能得到邮箱未验证提示；
- Session 吊销和过期；
- REST 与 AG-UI 使用同一用户；
- TUI 创建会话后 Web 可读取；
- Web 创建会话后 TUI 可恢复。

AG-UI 集成测试可以使用确定性的模型测试替身，但不能替换认证链路。

### 11.3 平台与回归

- Windows 与 Linux 验证 Session 路径和权限行为；
- Web 注册、验证、登录和密码重置继续通过；
- TUI login、`--no-auto-login`、`/logout` 和 `/resume` 通过；
- CI 和正式部署 smoke 使用 password 配置及 test 邮件投递；
- 所有需要 HTTP 身份的 smoke 和诊断脚本使用共享的正式认证测试工具；
- 代码和文档扫描不再出现可运行的开发认证入口或 TUI Demo 指令。

## 12. 验收标准

M0A.5 完成必须同时满足：

1. API、Web 和 TUI 不再存在可运行的开发认证模式。
2. 所有业务 REST 和 AG-UI 请求必须有正式 Session。
3. TUI 支持登录、Web 注册引导、Session 恢复、账号切换和注销。
4. TUI 不保存密码；敏感认证信息不进入日志。
5. Web 与 TUI 登录同一用户后可以互相查看并恢复服务端会话。
6. `--demo` 和内置 Demo Client 已删除。
7. 新 schema 不包含开发令牌或默认开发用户，应用不包含旧存储迁移和自动删除逻辑。
8. loopback HTTP、外部 HTTPS、注册开关和 test 邮件边界有自动化验证。
9. 路由和端到端测试使用真实注册、验证、Cookie 和 CSRF。
10. 原生部署 smoke 在统一正式认证配置下通过。
11. 文档明确 TUI Session 文件安全边界和开发期旧存储重置规则。

## 13. M0B 衔接

M0B 将 TUI 定义为按需容器，而不是常驻服务：

```bash
docker compose run --rm tui
```

M0B 在本规格之上增加：

- TUI GHCR 镜像；
- Compose 内部 `http://api:8787/api/copilotkit` 默认地址；
- 持久挂载 TUI Session Store，保证 `--rm` 删除容器后仍能恢复登录；
- 部署时创建默认所有者；
- 默认所有者直接标记为已验证，注册默认切换为 `closed`；
- 默认所有者的自动登录凭据来源；
- `docker compose run --rm tui --no-auto-login` 手动登录任意已有 Web 用户。

M0B 不得通过内部网络白名单、匿名默认身份或隐藏 dev token 实现自动登录。自动登录必须复用本规格的正式登录、Session 和 CSRF 机制。需要新增账号时，由部署者显式将注册切换为 `open`；外部开放注册必须配置 SMTP，注册完成后可再次关闭。

## 14. 实施顺序建议

当前至少有数十个测试、smoke 和诊断入口依赖开发身份。为了避免先删除旁路后失去验证能力，M0A.5 分为三个可独立回归的 PR；只有三者全部完成才算里程碑验收。

### 14.1 M0A.5a：正式认证基础

- 建立共享的正式测试认证工具：注册、读取 test 验证令牌、验证、登录、Cookie Jar 和 CSRF；
- 先迁移所有需要 HTTP 身份的 smoke 与诊断脚本；
- 实现 loopback HTTP、HTTPS 和 Cookie 安全策略；
- 实现 `AUTH_REGISTRATION_MODE` 和真实 auth status；
- 修复登录用户枚举；
- 暂时保留旧开发模式，保证迁移期间验证能力不中断。

退出门槛：原有验证入口均可在 password 模式运行，新增网络和注册安全测试通过。

### 14.2 M0A.5b：TUI 登录

- 实现 TUI Auth Client、Session Store 和 Authenticated Transport；
- 完成登录、Web 注册引导、7 天 Session、恢复、切换和注销；
- 迁移 REST 与 AG-UI 到统一认证传输；
- 完成 Web/TUI 双向会话共享测试；
- 删除 `--demo` 和 Demo Client。

退出门槛：TUI 在 password 模式下完整可用，不需要 dev token。

### 14.3 M0A.5c：破坏性收口

- 删除 API dev 身份、dev token 和开发用户接口；
- 删除 Web 开发身份与用户切换；
- 删除剩余开发认证配置、代码和测试；
- 更新 M0A 默认监听、注册与 Cookie 配置；
- 人工删除旧开发 storage 并重新初始化，不编写迁移代码；
- 运行全量测试、smoke 和原生部署验证。

退出门槛：仓库中不存在可运行的开发认证旁路，所有正式验收门禁通过。
