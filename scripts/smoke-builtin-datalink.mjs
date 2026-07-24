import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUILTIN_DATALINK_SERVER_ID,
  ensureBuiltinDatalinkServer,
} from "../apps/api/dist/builtin-datalink-server.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";
import { createVerifiedTestIdentity } from "./lib/metadata-test-identity.mjs";

const root = mkdtempSync(join(tmpdir(), "datafoundry-builtin-datalink-"));
const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
const __testIdentity = createVerifiedTestIdentity(metadataStore);
const userId = __testIdentity.userId;
const workspaceId = __testIdentity.workspaceId;

const common = { metadataStore, userId, workspaceId };
const enabledEnv = {
  DATALINK_ENABLED: "true",
  DATALINK_API_PORT: "18081",
  DATALINK_MCP_PORT: "18080",
};

assert.equal(ensureBuiltinDatalinkServer({ ...common, env: enabledEnv }), "created");
assert.equal(ensureBuiltinDatalinkServer({ ...common, env: enabledEnv }), "skipped");

const resource = metadataStore.configResources.get({
  id: BUILTIN_DATALINK_SERVER_ID,
  workspace_id: workspaceId,
  user_id: userId,
  kind: "mcp-server",
});
assert.equal(resource.builtin, true);
assert.equal(resource.default_enabled, true);
assert.equal(resource.payload.apiUrl, "http://127.0.0.1:18081");
assert.equal(resource.payload.serverUrl, "http://127.0.0.1:18080/mcp");
assert.deepEqual(resource.payload.toolManifest, [{ name: "datalink_explore" }]);

assert.equal(ensureBuiltinDatalinkServer({ ...common, env: {} }), "removed");
assert.equal(metadataStore.configResources.find({
  id: BUILTIN_DATALINK_SERVER_ID,
  workspace_id: workspaceId,
  user_id: userId,
  kind: "mcp-server",
}), undefined);

metadataStore.close();
console.log("Built-in DataLink lifecycle smoke OK");
