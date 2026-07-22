# DataFoundry 原生一键部署设计

日期：2026-07-22  
状态：已确认  
目标平台：Ubuntu / Debian  

## 1. 背景

DataFoundry 当前通过 `npm run build`、`npm run build:web` 和 `npm run start` 运行。`scripts/stack-runner.mjs` 已能统一启动 Web、API，以及可选的 DataLink REST 和 MCP 进程；API 也已提供 `/healthz` 和 `/ready`。但是首次部署仍要求用户理解 Node、Python、uv、两份环境配置、四个潜在端口、后台进程、日志和健康检查，教学与排障成本较高。

本设计先补齐当前非容器化形态的一键部署。Docker Compose、systemd、PostgreSQL、RBAC 和内部架构治理属于后续独立阶段，不作为本阶段前置条件。

## 2. 目标

用户在已克隆的仓库中执行一个命令，即可完成配置、依赖检查、构建、后台启动和健康验证：

```bash
./deploy.sh
```

部署完成后，用户能够通过同一个脚本启动、停止、重启、查看状态、查看日志和执行只读诊断。

成功标准：

1. 首次部署不要求用户手工复制或同步 `.env` 与 `apps/web/.env.local`。
2. 无服务端模型环境变量时，Web、API、认证和配置管理仍能启动；模型在部署后通过 Web 创建、测试和启用。
3. 默认只依赖 Node.js；DataLink 默认关闭，用户可在交互部署中选择开启。
4. 端口选择透明、可控，不自动结束未知进程，也不静默改用随机端口。
5. 重复部署不删除 Metadata、文件资产或 DataLink 图数据；运行日志只按明确的轮转策略处理。
6. 部署成功必须由进程和健康检查共同证明，而不是只凭启动命令退出码判断。

## 3. 非目标

本阶段不提供：

- Dockerfile 或 Docker Compose。
- systemd 服务安装或开机自启。
- Kubernetes、Helm、Ingress 或多副本运行。
- PostgreSQL Metadata adapter。
- 单组织多用户 RBAC。
- Web/TUI 公共状态层重构。
- 自动 `git pull`、代码版本选择或远程 `curl | bash` 安装器。
- 卸载、重置、清理 storage、强制 kill 未知进程。
- 零停机升级或自动回滚到上一个代码版本。

## 4. 设计原则

1. **一个入口**：用户只需要学习 `./deploy.sh`。
2. **安全默认**：能够安全推断的配置自动生成；不能安全推断的交互确认或失败。
3. **显式系统变更**：安装 Node、Python 或 uv 前展示用途和操作，并在交互模式取得同意。
4. **配置一次**：根 `.env` 是服务端权威配置，Web 配置由脚本生成。
5. **不抢占资源**：未知进程占用端口时只报告和重新选择。
6. **数据优先**：脚本不删除 `storage`，配置写入使用临时文件和原子替换。
7. **可诊断**：每次失败都说明阶段、日志位置、服务现状和下一步命令。
8. **更新安全优先于可用性**：原地部署更新接受维护窗口，不在运行中的依赖目录执行 `npm ci`。

## 5. 用户命令面

### 5.1 命令

| 命令 | 行为 |
| --- | --- |
| `./deploy.sh` | 等同于 `deploy`；配置、检查依赖、安装、构建、启动并验证。 |
| `./deploy.sh deploy` | 显式执行完整部署或更新。 |
| `./deploy.sh start` | 使用已有配置和构建产物启动，不安装、不构建。 |
| `./deploy.sh stop` | 正常结束 DataFoundry 进程组，不删除配置和数据。 |
| `./deploy.sh restart` | 不重建，只停止并重新启动已有构建。 |
| `./deploy.sh status` | 检查 PID、API、Web 和可选 DataLink 的真实健康状态。 |
| `./deploy.sh logs` | 显示最近运行日志并持续跟随；`Ctrl+C` 不停止服务。 |
| `./deploy.sh doctor` | 只读检查依赖、配置、端口、权限、磁盘和服务健康。 |
| `./deploy.sh help` | 显示命令、选项和常用示例。 |

`start`、`stop` 和 `restart` 必须幂等。缺少配置或构建产物时，`start` 明确提示先执行 `./deploy.sh deploy`。

### 5.2 选项

| 选项 | 行为 |
| --- | --- |
| `--reconfigure` | 重新进入配置流程；保留现有非敏感值作为默认值，修改前备份 `.env`。 |
| `--non-interactive` | 禁止脚本提问，采用安全默认值；无法安全决定时立即失败。 |

支持 `./deploy.sh --reconfigure` 作为 `./deploy.sh deploy --reconfigure` 的简写。`--reconfigure` 与 `--non-interactive` 互斥。

无交互模式不等于无条件成功。它使用默认端口、关闭 DataLink、自动生成密钥、不配置模型；但端口冲突、依赖缺失且无法通过 root 或免密 sudo 安装、配置非法时必须失败并给出修复命令。

## 6. 组件

```text
deploy.sh
├─ 操作系统检测
├─ 经确认的 apt / uv 安装
├─ 项目安装与构建
├─ 进程组启动和停止
└─ 健康检查与命令分发

scripts/deploy/setup-config.mjs
├─ 读取和解析 .env
├─ 判断缺失值与示例占位值
├─ 生成安全密钥
├─ 原子写入配置
└─ 生成 apps/web/.env.local

scripts/deploy/check-ports.mjs
├─ 校验端口范围
├─ 检查本次选择是否重复
├─ 检查操作系统监听状态
├─ 区分当前 DataFoundry 与未知进程
└─ 执行交互式选择循环
```

Bash 负责 Linux、sudo 和进程生命周期；已有的 Node.js 22 负责可靠解析和写入环境配置，避免用 `sed` 修改 Secret 或结构化配置。

## 7. 首次交互流程

首次部署阶段为：

```text
config → dependencies → ports → install → build → start → verify
```

已有部署的更新阶段为：

```text
config → dependencies → ports → stop-old → install → build → start → verify
```

用户看到明确进度，例如：

```text
[3/8] 检查端口
[4/8] 安装项目依赖
[5/8] 构建应用
```

首次部署按以下顺序执行：

1. 确认系统为受支持的 Ubuntu / Debian。
2. 读取已有 `.env`；不存在时在内存中创建默认配置草案。
3. 自动生成 `AUTH_SESSION_SECRET` 和 `SECRET_MASTER_KEY`，不询问模型信息。
4. 介绍 DataLink 能力并询问是否启用，默认不启用。
5. 检查 Node.js 22、npm，以及启用 DataLink 时的 Python 3.10+ 和 uv。
6. 缺少依赖时展示安装用途和操作，经同意后通过 `sudo apt` 或 uv 官方安装方式安装并复检。
7. 逐项选择和验证 Web、API，以及可选 DataLink 的端口。
8. 确认浏览器公开访问地址，并确保其端口与 Web 端口一致。
9. 原子写入 `.env`，生成 `apps/web/.env.local`，限制配置文件权限。
10. 创建 storage、日志和运行状态目录。
11. 若当前版本正在运行，进入明确提示的维护窗口并正常停止旧 DataFoundry 进程组。
12. 执行 `npm ci`、TypeScript build 和 Web build。
13. 启用 DataLink 时执行其锁定依赖安装。
14. 启动后台进程，等待健康检查。
15. 输出 Web 地址、后续模型配置步骤和管理命令。

更新时不得在旧服务运行期间原地修改 `node_modules` 或构建目录。首期选择简单、可预测的维护窗口，不承诺零停机或自动代码回滚。安装或构建失败时 storage 保持不变，服务保持停止状态；修复原因后重新执行 `./deploy.sh deploy`。

## 8. 默认配置

默认运行配置为：

```dotenv
WEB_HOST=0.0.0.0
WEB_PORT=3000
API_HOST=127.0.0.1
API_PORT=8787

DATAFOUNDRY_AUTH_MODE=password
AUTH_EMAIL_DELIVERY=test
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000

DATALINK_ENABLED=false
DATALINK_MCP_HOST=127.0.0.1
DATALINK_MCP_PORT=8080
DATALINK_API_HOST=127.0.0.1
DATALINK_API_PORT=8081

STORAGE_ROOT_DIR=storage
METADATA_DB_PATH=storage/metadata/workbench.sqlite
```

`AUTH_SESSION_SECRET` 与 `SECRET_MASTER_KEY` 首次随机生成。已有有效值永不自动覆盖。

Web 配置自动生成：

```dotenv
NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE=password
NEXT_PUBLIC_AGENT_RUNTIME_URL=
NEXT_PUBLIC_CONFIG_API_URL=
API_PROXY_TARGET=http://127.0.0.1:8787
```

`API_PROXY_TARGET` 必须随所选 API 端口更新。Web 端口变化时，`AUTH_PUBLIC_BASE_URL` 必须同步确认或更新。

## 9. 模型配置

部署脚本不询问 `LLM_MODEL`、`LLM_BASE_URL` 或 `LLM_API_KEY`。API 可以在没有服务端默认模型的情况下启动。

部署完成后的用户路径是：

1. 打开 Web。
2. 注册并登录。
3. 在模型配置中创建 OpenAI-compatible Profile。
4. 测试连接并启用。
5. 选择模型后发起 Agent Run。

前端提交的模型配置持久化在后端 Metadata 和 Secret Store；API Key 不只保存在浏览器。未配置可用模型时，运行入口应提示先配置模型，后端仍保留 `PROVIDER_CONFIG_MISSING` 保护。

环境变量 `LLM_*` 继续作为可选的只读 server-default Profile，不属于一键部署必填项。

## 10. DataLink 交互与边界

首次部署显示：

```text
可选能力：DataLink 语义服务

DataLink 会根据表结构和数据画像建立语义关系图，帮助 Agent：
- 理解表和字段的业务含义
- 发现可信的表关联与 JOIN 路径
- 减少选错表、猜错字段和盲目 JOIN
- 在 Web 中查看图谱、探索关系并管理已接入的表

启用后需要 Python 3.10+ 和 uv，并会额外启动
DataLink MCP 与 DataLink REST 两个进程。

1. 暂不启用（推荐，部署更简单）
2. 启用 DataLink
请选择 [1]:
```

启用后才检查 Python、uv、MCP 端口和 REST 端口。uv 缺失时，脚本展示将执行的官方安装方式并请求授权；用户可以安装、返回关闭 DataLink 或退出部署。

DataLink 当前可以从 Web 填写数据库连接串或服务器可访问的 CSV / Parquet 路径，并执行添加、删除和重建。浏览器本地文件上传后自动加入 DataLink 图谱尚未打通；未来应通过受控的 `fileAssetId` 或 `datasourceId` 服务端桥接实现，而不是把真实服务器路径暴露给浏览器。

DataLink 当前主要读取服务端 `LLM_*` 或 `DATALINK_LLM_*`，不会自动复用用户在 Web 创建的模型 Profile。默认关闭 DataLink 可避免这一点阻塞基础部署；启用用户需要按 DataLink 文档配置需要模型参与的建图能力。

## 11. 端口选择算法

按 Web、API、DataLink MCP、DataLink REST 的顺序处理；DataLink 未启用时跳过后两项。

端口可用时显示：

```text
端口 3000 当前可用，请选择：
1. 使用端口 3000
2. 指定其他端口
请选择 [1]:
```

选择其他端口后循环执行：

1. 验证输入为 `1..65535` 的整数。
2. 验证未与本次其他服务端口重复。
3. 检查操作系统监听状态。
4. 空闲时确认采用；占用时显示可获得的 PID 和进程名。
5. 输入 `q` 时安全退出，配置草案不落盘。

未知进程占用端口时绝不自动 kill。当前 DataFoundry 占用自己的已配置端口时，标记为“更新时复用”，不当作外部冲突。

端口检查执行两次：配置阶段用于选择，启动前用于避免构建期间发生的竞态。第二次冲突时，交互模式重新进入相应端口循环；无交互模式失败。

## 12. 无交互模式

```bash
./deploy.sh deploy --non-interactive
```

默认行为：

- Web `3000`，API `8787`。
- DataLink 关闭。
- password 认证和 test 邮件模式。
- SQLite Metadata 和本地 storage。
- 自动生成安全密钥。
- 不配置服务端默认模型。
- 自动生成 Web BFF 配置。

通过进程环境或已有 `.env` 提供的合法显式值优先于默认值。无交互模式不允许询问：端口冲突、非法配置或无法无交互安装的依赖会立即失败。需要 sudo 密码时不降级成交互；只有 root 或免密 sudo 能继续自动安装。

远程服务器应显式提供正确的 `AUTH_PUBLIC_BASE_URL`。未提供时默认 `http://127.0.0.1:${WEB_PORT}`，部署可以完成，但状态输出必须提示该地址仅适合本机访问。

## 13. 后台进程和状态

运行文件布局：

```text
storage/
├─ logs/
│  ├─ datafoundry.log
│  └─ deploy-YYYYMMDD-HHMMSS.log
└─ run/
   ├─ datafoundry.pid
   └─ deployment.json
```

后台进程在独立进程组中运行。PID 文件记录受控父进程，`stop` 向该进程组发送正常终止信号；现有 stack runner 负责向 Web、API 和 DataLink 子进程传递终止信号。

`deployment.json` 只保存非敏感运行信息：启动时间、代码版本、端口、DataLink 状态、PID / 进程组和部署状态。它不得保存 Key、密码、Token、Cookie 或密钥内容。

`status` 同时报告：

```text
进程        running / stopped
API         healthy / starting / unhealthy
Web         reachable / unreachable
DataLink    disabled / healthy / unhealthy
```

## 14. 健康验证

只有以下条件全部满足才报告部署成功：

1. 后台父进程仍存活。
2. API `/healthz` 成功。
3. API `/ready` 成功。
4. Web 返回可接受的 HTTP 状态。
5. 启用 DataLink 时，其 REST `/healthz` 成功且 MCP 端口可连接。

健康检查使用有上限的重试和总超时。超时后保留进程状态和完整日志，不能只输出“启动失败”。

## 15. 错误处理

失败输出必须包含：失败阶段、错误摘要、日志路径、配置是否改变、旧服务是否仍运行、下一条建议命令。

示例：

```text
✗ Web 构建失败
更新处于维护窗口，服务当前已停止；现有数据未被修改。

完整日志：storage/logs/deploy-20260722-143000.log
修复后重试：./deploy.sh deploy
诊断命令：./deploy.sh doctor
```

规则：

- 配置使用临时文件生成，成功后原子替换。
- `--reconfigure` 修改前创建权限受限的 `.env` 备份。
- 日志脱敏 API Key、密码、Token、Cookie 和 Secret。
- 不删除 `storage`，不自动执行 `git pull`。
- 不结束无法证明属于当前 DataFoundry 的进程。
- 完成配置、依赖可安装性和端口预检后才停止旧服务；停止后才执行会修改运行目录的安装和构建。
- 安装、构建或新版本启动失败时报告维护窗口和健康状态；本阶段不承诺自动代码回滚。
- `Ctrl+C` 清理本次临时文件，但不误停部署前已经运行的版本。

## 16. 日志

- `datafoundry.log` 保存 Web、API 和 DataLink 的运行日志。
- `deploy-*` 保存依赖检测、安装、构建和健康验证日志。
- `logs` 默认显示最近记录并持续跟随。
- `doctor` 输出脱敏诊断摘要，不写入或打印 Secret。
- 首期提供简单的大小轮转，避免日志无限增长。
- test 邮件模式产生的验证链接属于敏感运行信息，只应写入权限受限的运行日志，不进入部署摘要或诊断分享内容。

## 17. 测试与 CI 门禁

单元和集成测试至少覆盖：

1. 缺少 `.env` 时生成安全默认配置。
2. 无模型配置也能启动。
3. 已有配置和密钥不会被覆盖。
4. `--reconfigure` 备份并更新配置。
5. `--non-interactive` 不产生脚本询问。
6. 默认端口可用时正常部署。
7. 端口冲突时交互循环或无交互失败。
8. 不结束占用端口的未知进程。
9. DataLink 关闭时不检查 Python 和 uv。
10. DataLink 开启时正确检查和安装依赖。
11. 更新构建失败时保持 storage 完整，并明确报告服务处于维护窗口。
12. `start`、`stop`、`restart`、`status`、`logs` 和 `doctor` 符合各自边界。
13. 测试 Secret 不出现在日志和状态文件。
14. 非默认端口下 Web BFF、REST 和 AG-UI SSE 正常。
15. 重复部署保留 Metadata、文件和 DataLink 图数据。

CI 增加 Ubuntu 原生部署 smoke：

```text
无交互部署（非默认端口、DataLink 关闭）
→ API / Web 健康检查
→ status
→ restart
→ stop
```

DataLink 使用独立可选任务测试，以免 Python 安装和图服务拖慢基础部署门禁。

## 18. 文档

快速部署正文控制在一屏内：

```text
要求：Ubuntu / Debian；安装脚本会检查缺失依赖

1. 克隆仓库并进入目录
2. 执行 ./deploy.sh
3. 打开输出的 Web 地址
4. 注册登录并在前端配置模型

状态：./deploy.sh status
日志：./deploy.sh logs
停止：./deploy.sh stop
诊断：./deploy.sh doctor
```

依赖安装、公开地址、SMTP、DataLink、非默认端口、升级和故障排查放在后续章节，不增加主路径的认知负担。

## 19. 后续演进

阶段 0B 的 Docker Compose 应复用相同环境变量、端口含义、storage 布局、健康检查和用户操作语义。之后再独立设计单组织三角色 RBAC、SQLite / PostgreSQL 双 adapter、审计与内部模块治理。
