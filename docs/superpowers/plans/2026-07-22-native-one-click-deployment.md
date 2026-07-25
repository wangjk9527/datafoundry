# Native One-Click Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an Ubuntu/Debian `./deploy.sh` entry point that safely configures, builds, starts, stops, diagnoses, and verifies the current non-containerized DataFoundry stack without requiring a server-side model configuration.

**Architecture:** Keep `deploy.sh` as a small Linux bootstrap and command entry point. Put deterministic configuration, port, state, lifecycle, and health behavior in focused Node.js modules under `scripts/deploy/`, then reuse the existing `scripts/stack-runner.mjs` as the managed child process. The root `.env` remains authoritative; `apps/web/.env.local`, PID state, deployment metadata, and logs are generated artifacts. Updates use an explicit maintenance window: preflight first, stop the managed process group, then run `npm ci` and builds.

**Tech Stack:** Bash 4+, Node.js 22 ESM, `node:test`, npm workspaces, Next.js, TypeScript, Python 3.10+ and uv only when DataLink is enabled, GitHub Actions on Ubuntu.

---

## Scope and fixed decisions

- Target Ubuntu and Debian on `x86_64` and `aarch64`; reject other operating systems and architectures with a clear message.
- Use Node.js 22.x. Accept Python 3.10+ and current uv when DataLink is enabled.
- `./deploy.sh` is equivalent to `./deploy.sh deploy`.
- Supported commands are `deploy`, `start`, `stop`, `restart`, `status`, `logs`, `doctor`, and `help`.
- Supported flags are `--reconfigure` and `--non-interactive`; they are mutually exclusive and valid only for `deploy`.
- DataLink defaults to disabled. Model configuration is not requested during deployment.
- Defaults are Web `3000`, API `8787`, DataLink MCP `8080`, and DataLink REST `8081`.
- Unknown processes are never terminated. Only the process group recorded in `storage/run/deployment.json` may be stopped.
- Runtime health timeout is 60 seconds with one-second polling.
- Rotate `storage/logs/datafoundry.log` at 20 MiB and retain five numbered archives.
- Test-email verification links remain in the permission-restricted runtime log; `status` and `doctor` never print them.
- Dependency installers use Debian/Ubuntu `apt`, the NodeSource Node.js 22 repository, and the official uv installer downloaded to a temporary file. The script displays the source and command before requesting consent.
- Configuration precedence is explicit: process environment overrides an existing root `.env`, which overrides generated defaults. Generated values are written back only after validation; unrelated existing keys and comments remain intact.

## File and responsibility map

### Create

- `deploy.sh` — Linux/architecture guard, Node bootstrap, and delegation to the Node CLI.
- `scripts/deploy/args.mjs` — command/flag parsing and help text.
- `scripts/deploy/config.mjs` — environment merge, secret generation, validation, atomic writes, backup, and Web env projection.
- `scripts/deploy/ports.mjs` — port validation, availability probing, managed-port recognition, and interactive selection loop.
- `scripts/deploy/process-state.mjs` — PID/state files, detached process-group start/stop, stale-state handling, and log rotation.
- `scripts/deploy/health.mjs` — bounded HTTP/TCP probes and health summary.
- `scripts/deploy/dependencies.mjs` — dependency detection and consent-driven installer invocation.
- `scripts/deploy/controller.mjs` — command orchestration and maintenance-window ordering.
- `scripts/deploy/cli.mjs` — readline prompts, real system adapters, output, and exit-code mapping.
- `scripts/deploy/install-dependency.sh` — narrowly scoped Node, Python, and uv installation actions.
- Matching `*.test.mjs` files under `scripts/deploy/`.
- `scripts/smoke-native-deploy.mjs` — end-to-end deploy/status/restart/stop smoke.

### Modify

- `scripts/stack-runner.mjs` — honor configured Web/API ports and print actual endpoints.
- `scripts/datalink-stack-config.mjs` only if runtime environment composition needs a shared exported helper; do not duplicate its DataLink validation.
- `.env.example` — add Web host/port and clarify that `LLM_*` values are optional server defaults.
- `apps/web/.env.example` — document generated same-origin BFF settings.
- `package.json` — add deployment unit and smoke scripts.
- `.github/workflows/ci.yml` — add deployment tests and Ubuntu native smoke.
- `README.md`, `README_zh.md`, `docs/en/quick-start.md`, and `docs/zh/quick-start.md` — make the script the primary native deployment path.

## Task 1: Make stack runtime ports configurable

**Files:**

- Create: `scripts/stack-runtime-config.mjs`
- Create: `scripts/stack-runtime-config.test.mjs`
- Modify: `scripts/stack-runner.mjs`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing runtime configuration tests**

Create tests that prove defaults, explicit Web/API ports, Web child environment projection, endpoint output, and invalid-port rejection:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStackEndpoints,
  resolveStackRuntimeConfig,
  webProcessEnvironment
} from "./stack-runtime-config.mjs";

test("uses native deployment defaults", () => {
  const config = resolveStackRuntimeConfig({ DATALINK_ENABLED: "false" });
  assert.equal(config.API_HOST, "127.0.0.1");
  assert.equal(config.API_PORT, "8787");
  assert.equal(config.WEB_HOST, "0.0.0.0");
  assert.equal(config.WEB_PORT, "3000");
});

test("projects configured host and port into the Next.js child", () => {
  const config = resolveStackRuntimeConfig({ WEB_HOST: "127.0.0.1", WEB_PORT: "3310" });
  assert.deepEqual(webProcessEnvironment(config), { HOSTNAME: "127.0.0.1", PORT: "3310" });
});

test("prints actual configured endpoints", () => {
  const config = resolveStackRuntimeConfig({ API_PORT: "8877", WEB_PORT: "3310" });
  const output = formatStackEndpoints(config, { startApi: true, startDatalink: false, startWeb: true });
  assert.match(output, /http:\/\/127\.0\.0\.1:8877/);
  assert.match(output, /http:\/\/127\.0\.0\.1:3310/);
});

test("rejects invalid ports", () => {
  assert.throws(() => resolveStackRuntimeConfig({ WEB_PORT: "70000" }), /WEB_PORT/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test scripts/stack-runtime-config.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `stack-runtime-config.mjs`.

- [ ] **Step 3: Implement the runtime configuration module**

Export these exact responsibilities:

```js
import { resolveDatalinkEnv } from "./datalink-stack-config.mjs";

function port(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return String(parsed);
}

export function resolveStackRuntimeConfig(env = process.env) {
  return {
    ...resolveDatalinkEnv(process.cwd(), env),
    API_HOST: env.API_HOST?.trim() || "127.0.0.1",
    API_PORT: port(env.API_PORT, 8787, "API_PORT"),
    WEB_HOST: env.WEB_HOST?.trim() || "0.0.0.0",
    WEB_PORT: port(env.WEB_PORT, 3000, "WEB_PORT")
  };
}

export function webProcessEnvironment(config) {
  return { HOSTNAME: config.WEB_HOST, PORT: config.WEB_PORT };
}

export function formatStackEndpoints(config, enabled) {
  const lines = ["DataFoundry endpoints:"];
  if (enabled.startWeb) lines.push(`  Web: http://127.0.0.1:${config.WEB_PORT}`);
  if (enabled.startApi) lines.push(`  API: http://${config.API_HOST}:${config.API_PORT}`);
  if (enabled.startDatalink) {
    lines.push(`  DataLink MCP: http://${config.DATALINK_MCP_HOST}:${config.DATALINK_MCP_PORT}/mcp`);
    lines.push(`  DataLink REST: http://${config.DATALINK_API_HOST}:${config.DATALINK_API_PORT}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Wire `stack-runner.mjs` to the new config**

Replace hard-coded Web/API endpoint and development cleanup ports with values from `resolveStackRuntimeConfig()`. Spawn Web with:

```js
const webEnv = { ...datalinkEnv, ...webProcessEnvironment(runtimeConfig) };
spawnProcess("web", "npm", ["--prefix", "apps/web", "run", webScript, ...args], webEnv);
```

Keep API and DataLink command semantics unchanged. Do not change REST or AG-UI paths.

- [ ] **Step 5: Add Web defaults to `.env.example` and run regression tests**

Add:

```dotenv
WEB_HOST=0.0.0.0
WEB_PORT=3000
```

Run: `node --test scripts/stack-runtime-config.test.mjs scripts/datalink-stack-config.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/stack-runtime-config.mjs scripts/stack-runtime-config.test.mjs scripts/stack-runner.mjs .env.example
git commit -m "feat: make stack runtime ports configurable"
```

## Task 2: Build safe deployment configuration generation

**Files:**

- Create: `scripts/deploy/config.mjs`
- Create: `scripts/deploy/config.test.mjs`

- [ ] **Step 1: Write failing tests for defaults, preservation, Web projection, backup, and model independence**

Tests must assert all of the following:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureDeploymentEnvironment,
  renderWebEnvironment,
  writeDeploymentConfiguration
} from "./config.mjs";

test("creates safe defaults without model settings", () => {
  const result = ensureDeploymentEnvironment("", { randomSecret: () => "generated-secret-value" });
  assert.equal(result.env.WEB_PORT, "3000");
  assert.equal(result.env.API_PORT, "8787");
  assert.equal(result.env.DATALINK_ENABLED, "false");
  assert.equal(result.env.AUTH_SESSION_SECRET, "generated-secret-value");
  assert.equal(result.env.SECRET_MASTER_KEY, "generated-secret-value");
  assert.equal(result.env.LLM_API_KEY, undefined);
});

test("preserves existing secrets and unrelated values", () => {
  const source = "AUTH_SESSION_SECRET=existing-session\nSECRET_MASTER_KEY=existing-master\nCUSTOM_VALUE=keep-me\n";
  const result = ensureDeploymentEnvironment(source, { randomSecret: () => "replacement" });
  assert.match(result.text, /AUTH_SESSION_SECRET=existing-session/);
  assert.match(result.text, /SECRET_MASTER_KEY=existing-master/);
  assert.match(result.text, /CUSTOM_VALUE=keep-me/);
});

test("renders same-origin Web BFF configuration", () => {
  const text = renderWebEnvironment({
    DATAFOUNDRY_AUTH_MODE: "password",
    API_HOST: "127.0.0.1",
    API_PORT: "8877"
  });
  assert.match(text, /NEXT_PUBLIC_AGENT_RUNTIME_URL=$/m);
  assert.match(text, /NEXT_PUBLIC_CONFIG_API_URL=$/m);
  assert.match(text, /API_PROXY_TARGET=http:\/\/127\.0\.0\.1:8877/);
});

test("reconfigure creates a backup and atomically writes both files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "datafoundry-config-"));
  await writeFile(path.join(root, ".env"), "AUTH_SESSION_SECRET=old\nSECRET_MASTER_KEY=old-master\n");
  const result = ensureDeploymentEnvironment(await readFile(path.join(root, ".env"), "utf8"));
  const written = await writeDeploymentConfiguration(root, result.text, renderWebEnvironment(result.env), {
    backup: true,
    timestamp: "20260722-120000"
  });
  assert.equal(await readFile(written.backupPath, "utf8"), "AUTH_SESSION_SECRET=old\nSECRET_MASTER_KEY=old-master\n");
  assert.match(await readFile(path.join(root, "apps/web/.env.local"), "utf8"), /API_PROXY_TARGET=/);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test scripts/deploy/config.test.mjs`

Expected: FAIL because `config.mjs` does not exist.

- [ ] **Step 3: Implement pure configuration helpers**

Use `dotenv.parse` for reading and a line-aware upsert function for writing so unknown keys and comments survive. Defaults must include the values from section 8 of the approved design. Generate secrets with `randomBytes(32).toString("base64url")`. Reject newline characters in written values. Treat missing, blank, `change-me`, and `replace-me` secret values as placeholders; never treat blank `LLM_*` values as deployment errors.

The public API must be:

```js
export function ensureDeploymentEnvironment(sourceText, options = {})
export function updateDeploymentEnvironment(sourceText, updates)
export function renderWebEnvironment(env)
export async function writeDeploymentConfiguration(root, rootText, webText, options = {})
export function redactSensitiveText(text)
```

`writeDeploymentConfiguration` must write temporary files in the destination directory, set mode `0o600`, rename them atomically, and remove temporary files on error. With `backup: true`, write `.env.backup-20260722-120000` before replacing `.env`.

`redactSensitiveText` must mask values for keys containing `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `COOKIE`, or `AUTHORIZATION`, case-insensitively.

- [ ] **Step 4: Run focused tests and inspect permissions on Linux**

Run: `node --test scripts/deploy/config.test.mjs`

Expected: all tests pass. On Linux, add an assertion that `(stat.mode & 0o777) === 0o600` for `.env`, `.env.local`, and backups.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy/config.mjs scripts/deploy/config.test.mjs
git commit -m "feat: add safe deployment configuration"
```

## Task 3: Implement collision-safe port selection

**Files:**

- Create: `scripts/deploy/ports.mjs`
- Create: `scripts/deploy/ports.test.mjs`

- [ ] **Step 1: Write failing tests for validation and the selection loop**

Cover valid/invalid ranges, duplicate selections, available defaults, user-selected alternatives, repeated collisions, quitting, managed ports, and non-interactive failure. The core test should use injected probes and prompts:

```js
test("loops until the requested alternative is available", async () => {
  const answers = ["2", "3001", "3002"];
  const selected = await selectDeploymentPort({
    label: "Web",
    defaultPort: 3000,
    reserved: new Set([8787]),
    managedPorts: new Set(),
    ask: async () => answers.shift(),
    probe: async (port) => ({ available: port === 3002, owner: port === 3001 ? "node pid=42" : null })
  });
  assert.equal(selected, 3002);
});

test("non-interactive mode fails on an unknown listener", async () => {
  await assert.rejects(
    selectDeploymentPort({
      label: "API",
      defaultPort: 8787,
      reserved: new Set(),
      managedPorts: new Set(),
      nonInteractive: true,
      ask: async () => assert.fail("must not prompt"),
      probe: async () => ({ available: false, owner: "python pid=99" })
    }),
    /API port 8787 is already in use/
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test scripts/deploy/ports.test.mjs`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement port primitives and injectable selection**

Export:

```js
export function parsePort(value, label)
export async function probePort(host, port)
export async function describePortOwner(port)
export async function selectDeploymentPort(options)
export async function verifySelectedPorts(services, options = {})
```

`probePort` must bind a temporary `node:net` server with `exclusive: true`, close it immediately on success, and return `{ available, owner }`. `describePortOwner` is best effort: run `ss -ltnp` on Linux, return a sanitized one-line owner, and return `"unknown process"` if ownership cannot be read.

The selection text must distinguish these cases:

```text
端口 3000 当前可用，请选择：
1. 使用端口 3000
2. 指定其他端口
请选择 [1]:
```

```text
端口 3000 已被未知进程占用（node pid=42）。DataFoundry 不会结束该进程。
请输入其他端口，或输入 q 退出：
```

A port in `managedPorts` may be selected during update preflight, but `verifySelectedPorts` must run again after the old managed process is stopped and before the new process starts.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/deploy/ports.test.mjs`

Expected: all tests pass and no test binds a fixed machine port.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy/ports.mjs scripts/deploy/ports.test.mjs
git commit -m "feat: add safe deployment port selection"
```

## Task 4: Add managed process state and log rotation

**Files:**

- Create: `scripts/deploy/process-state.mjs`
- Create: `scripts/deploy/process-state.test.mjs`

- [ ] **Step 1: Write failing tests**

Tests must cover atomic non-sensitive `deployment.json`, live/stale PID detection, detached start, idempotent stop, refusal to signal an unrecorded PID, and 20 MiB/five-file rotation. Use a temporary directory and a child command such as `node -e "setInterval(() => {}, 1000)"`; skip the process-group assertion on Windows.

Assert that state serialization rejects sensitive keys:

```js
assert.throws(
  () => validateDeploymentState({ pid: 123, API_KEY: "must-not-leak" }),
  /sensitive field API_KEY/
);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test scripts/deploy/process-state.test.mjs`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement state and lifecycle primitives**

Export:

```js
export function deploymentPaths(root)
export function validateDeploymentState(state)
export async function readDeploymentState(root)
export async function writeDeploymentState(root, state)
export function isProcessAlive(pid)
export async function rotateRuntimeLog(logPath, options = {})
export async function startManagedStack(root, options = {})
export async function stopManagedStack(root, options = {})
```

`startManagedStack` must:

1. Refuse to start when a recorded PID is alive.
2. Create `storage/logs` and `storage/run`.
3. Rotate the runtime log before opening it.
4. Spawn `npm run start` with `cwd: root`, `detached: true`, and stdout/stderr appended to `storage/logs/datafoundry.log`.
5. Call `child.unref()` and atomically store PID, process group, start time, commit SHA when available, configured ports, DataLink state, and status `starting`.

`stopManagedStack` must send `SIGTERM` to `-pid`, poll for at most 15 seconds, clear stale state after exit, and fail with a diagnostic message instead of signaling another PID when the recorded command marker does not identify DataFoundry. The marker can be a random launch ID stored in `deployment.json` and passed as `DATAFOUNDRY_LAUNCH_ID` to the child; confirm it via `/proc/<pid>/environ` before signaling on Linux.

- [ ] **Step 4: Run tests and check no children remain**

Run: `node --test scripts/deploy/process-state.test.mjs`

Expected: all tests pass; the test cleanup confirms the child PID no longer exists.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy/process-state.mjs scripts/deploy/process-state.test.mjs
git commit -m "feat: manage native deployment process state"
```

## Task 5: Add bounded health verification and status reporting

**Files:**

- Create: `scripts/deploy/health.mjs`
- Create: `scripts/deploy/health.test.mjs`

- [ ] **Step 1: Write failing probe tests using ephemeral local servers**

Test HTTP success, HTTP failure, TCP success, disabled DataLink, retry-until-ready, and timeout. Avoid fixed ports by listening on port `0`.

```js
const summary = await collectDeploymentHealth({
  processAlive: true,
  apiBaseUrl: `http://127.0.0.1:${apiPort}`,
  webUrl: `http://127.0.0.1:${webPort}`,
  datalinkEnabled: false
});
assert.deepEqual(summary, {
  process: "running",
  apiHealth: "healthy",
  apiReady: "ready",
  web: "reachable",
  datalinkRest: "disabled",
  datalinkMcp: "disabled",
  ok: true
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test scripts/deploy/health.test.mjs`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement probes**

Export:

```js
export async function probeHttp(url, options = {})
export async function probeTcp(host, port, options = {})
export async function collectDeploymentHealth(config, options = {})
export async function waitForDeployment(config, options = {})
```

Use an `AbortController` with a five-second timeout per HTTP probe. Treat Web status `200..399` as reachable. Require API `/healthz` and `/ready` to return `200`. When enabled, require DataLink REST `/healthz` to return `200` and the MCP port to accept TCP. `waitForDeployment` must poll every second for at most 60 seconds and include the final per-service summary in its error.

- [ ] **Step 4: Run tests**

Run: `node --test scripts/deploy/health.test.mjs`

Expected: all tests pass in under five seconds by injecting short test intervals and timeouts.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy/health.mjs scripts/deploy/health.test.mjs
git commit -m "feat: verify native deployment health"
```

## Task 6: Define the command surface and orchestration contract

**Files:**

- Create: `scripts/deploy/args.mjs`
- Create: `scripts/deploy/args.test.mjs`
- Create: `scripts/deploy/controller.mjs`
- Create: `scripts/deploy/controller.test.mjs`

- [ ] **Step 1: Write command parser tests**

Cover default `deploy`, every supported command, both flags, flags before or after `deploy`, unknown commands, mutually exclusive flags, and flags rejected on non-deploy commands.

```js
assert.deepEqual(parseDeployArgs([]), {
  command: "deploy",
  reconfigure: false,
  nonInteractive: false
});
assert.deepEqual(parseDeployArgs(["--non-interactive"]), {
  command: "deploy",
  reconfigure: false,
  nonInteractive: true
});
assert.throws(
  () => parseDeployArgs(["start", "--reconfigure"]),
  /--reconfigure is only valid with deploy/
);
```

- [ ] **Step 2: Write controller ordering tests before implementation**

Inject every side effect and record calls. The update-path assertion must be exact:

```js
assert.deepEqual(calls, [
  "load-config",
  "preflight",
  "configure",
  "check-dependencies",
  "select-ports",
  "write-config",
  "stop-old",
  "install",
  "build-typescript",
  "build-web",
  "verify-ports-again",
  "start",
  "wait-for-health",
  "mark-healthy"
]);
```

Also test that a build failure occurs after `stop-old`, never calls `start`, preserves storage, and reports `maintenanceWindow: true`.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test scripts/deploy/args.test.mjs scripts/deploy/controller.test.mjs`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement the parser and help text**

`args.mjs` must export `parseDeployArgs(argv)` and `deploymentHelp()`. The help text must list exact effects and boundaries:

```text
./deploy.sh [deploy] [--reconfigure | --non-interactive]
./deploy.sh start|stop|restart|status|logs|doctor|help

deploy   Configure, install, build, start, and verify. Existing deployments use a maintenance window.
start    Start an existing build. Does not install or build.
stop     Stop only the managed DataFoundry process group. Keeps configuration and data.
restart  Stop and start an existing build. Does not install or build.
status   Read process state and probe actual service health.
logs     Show recent runtime logs and continue following them. Ctrl+C does not stop DataFoundry.
doctor   Run read-only dependency, configuration, port, permission, disk, and health checks.
help     Show this help.
```

- [ ] **Step 5: Implement an injected controller**

Export `createDeploymentController(deps)`. `run(parsed)` dispatches commands without importing readline, child-process, or filesystem globals. This keeps ordering unit-testable. Required dependency methods are:

```js
loadConfiguration, preflight, configure, checkDependencies,
selectPorts, writeConfiguration, isRunning, stop,
installProject, buildTypeScript, buildWeb, installDataLink,
verifyPorts, start, waitForHealth, markHealthy,
status, logs, doctor, printHelp, reportFailure
```

For `deploy`, call `installDataLink` only when the final configuration enables DataLink. For `start`, require existing valid config and both `apps/api/dist/index.js` and `apps/web/.next/BUILD_ID`. Make `stop` and `restart` idempotent. Wrap failures with stage, log path, whether configuration changed, whether the service was stopped, and the recommended retry/doctor commands.

- [ ] **Step 6: Run tests and commit**

Run: `node --test scripts/deploy/args.test.mjs scripts/deploy/controller.test.mjs`

Expected: all tests pass.

```bash
git add scripts/deploy/args.mjs scripts/deploy/args.test.mjs scripts/deploy/controller.mjs scripts/deploy/controller.test.mjs
git commit -m "feat: define native deployment commands"
```

## Task 7: Add dependency checks and interactive configuration

**Files:**

- Create: `scripts/deploy/dependencies.mjs`
- Create: `scripts/deploy/dependencies.test.mjs`
- Create: `scripts/deploy/cli.mjs`
- Create: `scripts/deploy/cli.test.mjs`

- [ ] **Step 1: Write dependency policy tests**

Inject a command runner. Verify Node 22 and npm are always required; Python and uv are not checked when DataLink is disabled; Python 3.10+ and uv are checked when enabled; interactive refusal returns a corrective command; non-interactive installation is allowed only as root or when `sudo -n true` succeeds.

- [ ] **Step 2: Write prompt-flow tests**

Inject `ask()` and capture output. Cover:

1. First run explains DataLink and defaults to option `1`.
2. Option `2` enables DataLink and adds MCP/REST port selection.
3. Existing complete valid config skips prompts unless `--reconfigure` is present.
4. `--reconfigure` shows existing non-sensitive values as defaults and creates a backup.
5. `--non-interactive` never calls `ask()`.
6. Choosing `2` for an available default port asks for another port; `n` is rejected with the explicit hint `请输入 1 或 2`.
7. Public URL port must match the selected Web port unless the user explicitly confirms an external reverse proxy URL.
8. A non-interactive remote bind with only the default loopback public URL succeeds but prints a clear warning that the URL is local-machine only.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test scripts/deploy/dependencies.test.mjs scripts/deploy/cli.test.mjs`

Expected: FAIL because the modules are missing.

- [ ] **Step 4: Implement dependency inspection**

Export:

```js
export async function inspectDependencies(options = {})
export async function ensureDependencies(options = {})
```

Return structured entries with `name`, `required`, `foundVersion`, `minimumVersion`, `status`, and `installAction`. Never log environment values. Invoke `scripts/deploy/install-dependency.sh` only after consent, then inspect again and fail if the required version is still unavailable.

- [ ] **Step 5: Implement the real CLI adapter**

`cli.mjs` must:

- Parse arguments before opening readline.
- Load the root `.env` without requiring `LLM_*`, then overlay explicit process-environment values before validation.
- Present the approved Chinese DataLink capability explanation.
- Select Web, API, and optional DataLink ports one at a time.
- Write `.env` and `apps/web/.env.local` only after the complete draft passes validation.
- Run `npm ci`, `npm run build`, and `npm run build:web` as separate stages with combined output written through the redactor to a timestamped deploy log.
- Run `uv sync --project services/datalink --locked` only when DataLink is enabled.
- Implement `logs` using `tail -n 200 -F storage/logs/datafoundry.log`; exiting tail must not signal the service.
- Implement `doctor` as read-only checks for OS/architecture, dependencies, config syntax, duplicate ports, current listeners, storage/log permissions, free disk, PID marker, and health.
- Exit `0` only for successful commands, `1` for operational failure, and `2` for invalid usage.

Keep the direct execution guard so tests can import without running:

```js
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
```

- [ ] **Step 6: Run all deployment unit tests and commit**

Run: `node --test scripts/deploy/*.test.mjs`

Expected: all tests pass and test output contains none of the fixture secrets.

```bash
git add scripts/deploy/dependencies.mjs scripts/deploy/dependencies.test.mjs scripts/deploy/cli.mjs scripts/deploy/cli.test.mjs
git commit -m "feat: add deployment configuration workflow"
```

## Task 8: Add the Bash bootstrap and installer boundary

**Files:**

- Create: `deploy.sh`
- Create: `scripts/deploy/install-dependency.sh`
- Create: `scripts/deploy/bootstrap.test.mjs`

- [ ] **Step 1: Write Bash boundary tests from Node**

Use `spawnSync("bash", ...)` with a temporary fake `PATH` where appropriate. Test:

- `./deploy.sh help` delegates without installing anything when Node 22 exists.
- Unsupported OS and architecture exit `1` with a precise message.
- Node 20 is rejected.
- Interactive Node installation prints repository and command, then asks once.
- `--non-interactive` never reads stdin and fails if neither root nor passwordless sudo is available.
- Installer accepts only `node`, `python`, or `uv`; any other argument exits `2`.
- No code path executes `curl | bash`.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test scripts/deploy/bootstrap.test.mjs`

Expected: FAIL because the scripts are missing.

- [ ] **Step 3: Implement `deploy.sh`**

Use this top-level shape:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

main() {
  check_supported_system
  ensure_node_22 "$@"
  exec node "$ROOT_DIR/scripts/deploy/cli.mjs" "$@"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
```

Source `/etc/os-release`; accept `ID=ubuntu` or `ID=debian`. Accept `uname -m` values `x86_64`, `amd64`, `aarch64`, or `arm64`. Do not install anything for `status`, `logs`, `stop`, `doctor`, or `help`; if Node is missing for these commands, print the exact prerequisite and exit.

For a missing Node 22 during `deploy`, show the NodeSource URL and installation commands, get consent in interactive mode, or require root/passwordless sudo in non-interactive mode. Download the setup script to `mktemp`, use a trap to remove it, execute it, install `nodejs`, and re-check `node --version` and `npm --version`.

- [ ] **Step 4: Implement the scoped dependency installer**

`install-dependency.sh python` runs `apt-get update` and installs `python3 python3-venv`. It must verify Python 3.10+ afterward.

`install-dependency.sh uv` downloads `https://astral.sh/uv/install.sh` into a `mktemp` file, executes it with `sh`, removes it, adds `$HOME/.local/bin` to the current lookup path, and verifies `uv --version`.

Both paths must use `sudo -n` in non-interactive mode and ordinary `sudo` only after interactive consent. Never write under `storage` and never edit user shell profiles.

- [ ] **Step 5: Mark scripts executable, run tests, and commit**

Run:

```bash
chmod +x deploy.sh scripts/deploy/install-dependency.sh
node --test scripts/deploy/bootstrap.test.mjs
./deploy.sh help
```

Expected: tests pass and help lists all eight commands.

```bash
git add deploy.sh scripts/deploy/install-dependency.sh scripts/deploy/bootstrap.test.mjs
git commit -m "feat: add native deployment bootstrap"
```

## Task 9: Wire lifecycle commands and failure diagnostics end to end

**Files:**

- Modify: `scripts/deploy/cli.mjs`
- Modify: `scripts/deploy/controller.mjs`
- Modify: `scripts/deploy/process-state.mjs`
- Modify: `scripts/deploy/health.mjs`
- Modify: `scripts/deploy/*.test.mjs`

- [ ] **Step 1: Add failing integration-style tests with fake executors**

Prove these complete behaviors:

- Fresh deploy: config, dependencies, ports, install, both builds, start, health, healthy state.
- Update deploy: all preflight checks complete before stop; install/build happen only after stop.
- Build failure: service remains stopped, storage sentinel remains byte-for-byte unchanged, error says maintenance window and points to deploy log, retry, and doctor.
- Port becomes occupied during build: second probe prevents start and never kills the listener.
- Start with missing build artifact fails with `请先运行 ./deploy.sh deploy`.
- `status` distinguishes stale PID, API unhealthy, Web unreachable, and DataLink disabled.
- `restart` does not install or build.
- `stop` twice succeeds both times.
- Runtime/deploy logs redact test secrets.

- [ ] **Step 2: Implement adapters and state transitions**

Use deployment states `starting`, `healthy`, `unhealthy`, and `stopped`. Do not claim `healthy` until `waitForDeployment` succeeds. If health times out, retain PID and mark `unhealthy` so `logs`, `status`, and `stop` remain usable.

Every deploy failure must emit this data shape before formatting:

```js
{
  stage: "build-web",
  summary: "Web build failed",
  logPath: "storage/logs/deploy-20260722-143000.log",
  configurationChanged: true,
  maintenanceWindow: true,
  oldServiceRunning: false,
  retryCommand: "./deploy.sh deploy",
  doctorCommand: "./deploy.sh doctor"
}
```

The formatted Chinese output must state that existing data was not modified. Do not state that the old version was restored.

- [ ] **Step 3: Run deployment tests**

Run: `node --test scripts/deploy/*.test.mjs scripts/stack-runtime-config.test.mjs scripts/datalink-stack-config.test.mjs`

Expected: all tests pass.

- [ ] **Step 4: Run project regressions**

Run:

```bash
npm run build
npm run test:web
npm run build:web
npm run test:datalink-stack
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy scripts/stack-runner.mjs
git commit -m "feat: complete native deployment lifecycle"
```

## Task 10: Add a real Ubuntu native deployment smoke

**Files:**

- Create: `scripts/smoke-native-deploy.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the smoke script**

The script must create a temporary deployment checkout or copy that excludes `.git`, existing `.env`, `apps/web/.env.local`, `node_modules`, build outputs, and `storage`. It must reserve free non-default Web/API ports, write only non-secret test overrides, then execute:

```text
./deploy.sh deploy --non-interactive
./deploy.sh status
HTTP GET API /healthz
HTTP GET API /ready
HTTP GET Web /
./deploy.sh restart
./deploy.sh status
./deploy.sh stop
./deploy.sh stop
```

Assert DataLink remains disabled, no model variables are present, a storage sentinel survives restart and stop, and final process state is stopped. Always stop the managed process in `finally`.

- [ ] **Step 2: Add npm scripts**

Add:

```json
"test:deploy": "node --test scripts/deploy/*.test.mjs scripts/stack-runtime-config.test.mjs",
"smoke:native-deploy": "node scripts/smoke-native-deploy.mjs"
```

- [ ] **Step 3: Run the unit suite**

Run: `npm run test:deploy`

Expected: all deployment tests pass.

- [ ] **Step 4: Add a CI job**

Add `native-deploy-smoke` on `ubuntu-latest` with Node 22. It must run `npm ci`, `npm run test:deploy`, and `npm run smoke:native-deploy`. Set a 20-minute timeout. On failure, upload only redacted `storage/logs` artifacts; ensure the smoke uses fixture secrets and scan uploaded text for those fixtures before upload.

Keep DataLink-native smoke in the existing separate Python/uv job; do not enable DataLink in the base deployment smoke.

- [ ] **Step 5: Run the smoke on Linux and commit**

Run: `npm run smoke:native-deploy`

Expected: deploy, health, restart, and two stops succeed; no managed process remains.

```bash
git add scripts/smoke-native-deploy.mjs package.json package-lock.json .github/workflows/ci.yml
git commit -m "test: add native deployment smoke"
```

## Task 11: Make one-click deployment the primary documented path

**Files:**

- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/en/quick-start.md`
- Modify: `docs/zh/quick-start.md`
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Update the Chinese quick-start main path**

The first screen must contain only prerequisites, clone, `./deploy.sh`, open Web, configure a model in Web, and the four common management commands. Explain that DataLink is optional and what it adds before the advanced section. State that DataLink can start without a model but model-assisted graph-building still needs `DATALINK_LLM_*` or compatible server-side `LLM_*` configuration; it does not automatically reuse a Web model Profile. Move manual npm configuration into an explicitly labeled advanced/manual section.

- [ ] **Step 2: Update the English quick start with equivalent behavior**

Keep command semantics, maintenance-window warning, non-interactive limitations, and troubleshooting equivalent across languages.

- [ ] **Step 3: Update both READMEs**

Replace the primary native installation path with:

```bash
./deploy.sh
```

Show:

```bash
./deploy.sh status
./deploy.sh logs
./deploy.sh stop
./deploy.sh doctor
```

Document that model profiles are configured after login, DataLink defaults off, remote deployments should set `AUTH_PUBLIC_BASE_URL`, and updates have a maintenance window.

- [ ] **Step 4: Clarify generated Web configuration**

In `apps/web/.env.example`, state that native deployment generates `.env.local`, uses same-origin BFF variables, and derives `API_PROXY_TARGET` from the selected API port.

- [ ] **Step 5: Verify docs and commit**

Run:

```bash
npm run smoke:docs
npm run docs:build
```

Expected: link/secret checks pass and MkDocs strict build exits `0`.

```bash
git add README.md README_zh.md docs/en/quick-start.md docs/zh/quick-start.md apps/web/.env.example
git commit -m "docs: document native one-click deployment"
```

## Task 12: Final verification and release evidence

**Files:**

- Modify only files required to fix a verification failure; do not mix unrelated cleanup into this task.

- [ ] **Step 1: Run the full focused verification set**

```bash
npm run test:deploy
npm run test:datalink-stack
npm run build
npm run test:web
npm run build:web
npm run smoke:docs
npm run docs:build
```

Expected: every command exits `0`.

- [ ] **Step 2: Run the real native smoke on Ubuntu/Debian**

```bash
npm run smoke:native-deploy
```

Expected: deploy, status, API health/readiness, Web reachability, restart, idempotent stop, storage preservation, and secret scan all pass.

- [ ] **Step 3: Manually exercise the interactive choices on a clean Ubuntu/Debian VM**

Verify:

- Default DataLink option `1` deploys without Python/uv checks.
- DataLink option `2` explains capabilities and checks Python/uv plus two additional ports.
- Choosing port option `2` loops until a valid free port is entered.
- An unknown listener is reported and remains alive.
- `--reconfigure` backs up `.env` and preserves existing secrets.
- `--non-interactive` never prompts.
- No server-side model configuration is needed to reach login and the model-profile UI.
- `logs` can be interrupted without stopping DataFoundry.
- A deliberate Web build failure reports the maintenance window and leaves storage intact.

- [ ] **Step 4: Inspect repository diff and generated-file hygiene**

Run:

```bash
git status --short
git diff --check
git ls-files .env apps/web/.env.local storage
```

Expected: no generated config, logs, PID files, databases, or storage assets are tracked; `git diff --check` has no output.

- [ ] **Step 5: Scan for placeholders and accidental secrets**

Run:

```bash
rg -n "TODO|TBD|change-me|replace-me|fixture-deploy-secret" deploy.sh scripts/deploy scripts/smoke-native-deploy.mjs README.md README_zh.md docs/en/quick-start.md docs/zh/quick-start.md
```

Expected: only intentional test assertions or documented rejected-placeholder examples appear; no real credential appears.

- [ ] **Step 6: Record final evidence**

Add the exact command results and tested Ubuntu/Debian version to the pull request description or release checklist. If verification required code changes, commit them with a narrowly scoped message and rerun the failed command plus its adjacent regression suite before claiming completion.

## Definition of done

- A new Ubuntu/Debian user can clone the repository and run `./deploy.sh` without manually creating environment files.
- Default deployment starts Web and API without DataLink and without a model key.
- Interactive and non-interactive behavior matches the approved design.
- Port conflicts never terminate unknown processes and never silently choose random ports.
- Updates stop the old managed service before `npm ci` or builds and clearly expose the maintenance window.
- `start`, `stop`, `restart`, `status`, `logs`, `doctor`, and `help` have automated boundary tests.
- PID identity, generated config, logs, state files, health checks, storage preservation, and secret redaction are tested.
- Non-default ports work through Web BFF, REST, and AG-UI without changing protocol paths.
- CI runs deployment unit tests and a DataLink-disabled Ubuntu native smoke.
- Chinese and English docs teach the one-command path first and preserve a manual path for advanced users.
