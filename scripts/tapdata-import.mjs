#!/usr/bin/env node

/**
 * Validate and optionally upload TapData connection/task/API exports.
 *
 * TapData export/import endpoints are edition/version specific, so this tool
 * deliberately follows the official TapData 4.21 browser API contract. The
 * routes and multipart field names are still configurable for other editions.
 * `manual` mode is safe for preparing a hand-off manifest; `api` mode checks
 * exact task/API names first, uploads missing packages as copies, and never
 * starts a task unless the configured post-processing/autostart flow enables it.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { MongoClient } from "mongodb";

const env = process.env;

const asBool = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const asPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const importMode = (process.argv[2] || env.TAPDATA_IMPORT_MODE || "manual").toLowerCase();
const stateDir = resolve(env.TAPDATA_IMPORT_STATE_DIR || join(process.cwd(), "runtime", "tapdata-import"));
const importRoot = env.TAPDATA_IMPORT_ROOT ? resolve(env.TAPDATA_IMPORT_ROOT) : undefined;
const timeoutMs = asPositiveInt(env.TAPDATA_IMPORT_TIMEOUT_MS, 15_000);

const log = (message) => console.log(`[tapdata-import] ${message}`);
const fail = (message) => {
  console.error(`[tapdata-import] ERROR: ${message}`);
  process.exitCode = 1;
};

function resolveArtifact(explicitPath, kind, fileName) {
  if (explicitPath) {
    const candidate = isAbsolute(explicitPath) ? explicitPath : resolve(explicitPath);
    if (existsSync(candidate)) return candidate;
    throw new Error(`${kind} export not found at the configured path`);
  }

  if (!importRoot) {
    throw new Error(`set TAPDATA_${kind.toUpperCase()}_EXPORT or TAPDATA_IMPORT_ROOT`);
  }

  const kindDirs = kind === "connection"
    ? ["connection", "connections"]
    : kind === "task"
      ? ["task", "tasks"]
      : kind === "api"
        ? ["api", "apis", "modules"]
        : [kind];
  const candidates = [
    ...kindDirs.map((dir) => join(importRoot, dir, fileName)),
    join(importRoot, fileName),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    throw new Error(`${kind} export not found under TAPDATA_IMPORT_ROOT`);
  }
  return match;
}

function resolveOptionalArtifact(explicitPath, kind, fileName) {
  if (explicitPath) return resolveArtifact(explicitPath, kind, fileName);
  if (!importRoot) return undefined;
  const kindDirs = kind === "connection"
    ? ["connection", "connections"]
    : kind === "task"
      ? ["task", "tasks"]
      : kind === "api"
        ? ["api", "apis", "modules"]
        : [kind];
  const candidates = [
    ...kindDirs.map((dir) => join(importRoot, dir, fileName)),
    join(importRoot, fileName),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fileInfo(filePath) {
  const stat = statSync(filePath);
  return {
    fileName: basename(filePath),
    sizeBytes: stat.size,
    sha256: sha256(filePath),
  };
}

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function safeKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).slice(0, 30) : [];
}

function parseTaskExport(filePath) {
  let bytes = readFileSync(filePath);
  if (filePath.endsWith(".gz")) bytes = gunzipSync(bytes);

  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("task export is not valid JSON or gzip JSON");
  }

  const records = (Array.isArray(parsed) ? parsed : [parsed]).map((record) => {
    if (!record?.collectionName || record.json === undefined) return record;
    const body = parseJsonValue(record.json);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("invalid JSON payload in the TapData collection export");
    }
    return { ...body, exportCollection: record.collectionName };
  });
  const taskRecords = records.filter((record) => record && (record.exportCollection ? record.exportCollection === "Task" : record.type === "Task" || record.className === "Task" || record.taskId));
  const connectionRecords = records.filter((record) => record && (record.exportCollection ? record.exportCollection === "Connections" : record.type === "Connection" || record.className === "Connection" || record.connectionId));
  const metadataRecords = records.filter((record) => record && (record.exportCollection ? record.exportCollection === "MetadataInstances" : record.type === "MetadataInstance" || record.className === "MetadataInstance" || record.metadataInstanceId));
  if (taskRecords.length === 0) throw new Error("export contains no Task records; API module packages cannot be imported as tasks");
  const task = taskRecords[0] || {};
  const taskConfig = parseJsonValue(task.config ?? task.taskConfig ?? task.options);
  const nodes = parseJsonValue(task.nodes ?? task.nodeList ?? task.nodeConfig ?? parseJsonValue(task.dag)?.nodes);

  const nodeNames = [];
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (node && typeof node === "object") {
        const name = node.name ?? node.nodeName ?? node.label;
        if (typeof name === "string" && name.length < 120) nodeNames.push(name);
      }
    }
  }

  return {
    recordCount: records.length,
    taskCount: taskRecords.length,
    connectionCount: connectionRecords.length,
    metadataInstanceCount: metadataRecords.length,
    task: {
      name: typeof task.name === "string" ? task.name : undefined,
      syncType: typeof task.syncType === "string" ? task.syncType : undefined,
      type: typeof task.taskType === "string" ? task.taskType : typeof task.type === "string" ? task.type : undefined,
      nodeNames: [...new Set(nodeNames)].slice(0, 20),
      configKeys: safeKeys(taskConfig),
    },
    // Connection IDs are installation-specific and are intentionally reduced
    // to a count; IDs and embedded URIs must not be copied into a manifest.
    installationSpecificConnectionIds: connectionRecords.length,
  };
}

function parseModuleExport(filePath) {
  let bytes = readFileSync(filePath);
  if (filePath.endsWith(".gz")) bytes = gunzipSync(bytes);

  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("API module export is not valid JSON or gzip JSON");
  }

  const records = (Array.isArray(parsed) ? parsed : [parsed]).map((record) => {
    if (!record?.collectionName || record.json === undefined) return record;
    const body = parseJsonValue(record.json);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("invalid JSON payload in the TapData API module export");
    }
    return { ...body, exportCollection: record.collectionName };
  });
  const moduleRecords = records.filter((record) => record && (record.exportCollection ? record.exportCollection === "Modules" : record.type === "Module" || record.className === "Module" || record.moduleId));
  const connectionRecords = records.filter((record) => record && (record.exportCollection ? record.exportCollection === "Connections" : record.type === "Connection" || record.className === "Connection" || record.connectionId));
  const metadataRecords = records.filter((record) => record && (record.exportCollection ? record.exportCollection === "MetadataInstances" : record.type === "MetadataInstance" || record.className === "MetadataInstance" || record.metadataInstanceId));
  if (moduleRecords.length === 0) throw new Error("API export contains no Modules records; a CDC task package cannot be imported as APIs");
  const names = moduleRecords
    .map((record) => record.name ?? record.moduleName ?? record.apiName)
    .filter((name) => typeof name === "string" && name.length < 120);
  const tableNames = moduleRecords
    .map((record) => record.tableName ?? record.table ?? (record.exportCollection === "Modules" ? undefined : record.collectionName))
    .filter((name) => typeof name === "string" && name.length < 120);
  return {
    recordCount: records.length,
    moduleCount: moduleRecords.length,
    connectionCount: connectionRecords.length,
    metadataInstanceCount: metadataRecords.length,
    moduleNames: [...new Set(names)],
    moduleTableNames: [...new Set(tableNames)],
  };
}

function inspectXlsx(filePath) {
  const bytes = readFileSync(filePath);
  const signature = bytes.subarray(0, 4).toString("hex");
  const isZip = signature === "504b0304" || signature === "504b0506" || signature === "504b0708";
  const textProbe = bytes.toString("latin1");
  const zipEntries = [];
  if (isZip) {
    // The central directory names are uncompressed and often remain visible
    // in the binary buffer. This is deliberately an opaque check: no XML,
    // URI, or credential content is emitted.
    const entryPattern = /(?:xl\/[^\0]{1,160}|docProps\/[^\0]{1,160}|_rels\/[^\0]{1,160})/g;
    for (const match of textProbe.match(entryPattern) || []) {
      const controlIndex = [...match[0]].findIndex((char) => char.charCodeAt(0) < 32);
      const cleaned = controlIndex < 0 ? match[0] : match[0].slice(0, controlIndex);
      if (cleaned && !zipEntries.includes(cleaned)) zipEntries.push(cleaned);
    }
  }
  return {
    isZipOfficeDocument: isZip,
    hasWorkbook: isZip && (textProbe.includes("xl/workbook") || zipEntries.some((entry) => entry.includes("workbook"))),
    hasExpectedConnectionName: textProbe.includes("MongoDB_Source"),
    entryCountHint: zipEntries.length,
  };
}

function redactPath(filePath) {
  return basename(filePath);
}

function createManifest(connectionPath, taskPath, apiPath) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: importMode,
    taskExport: {
      ...fileInfo(taskPath),
      path: redactPath(taskPath),
      format: taskPath.endsWith(".gz") ? "gzip-json" : "json",
      summary: parseTaskExport(taskPath),
    },
    requiresSourceUri: Boolean(connectionPath) && !env.TAPDATA_SOURCE_MONGODB_URI && !asBool(env.TAPDATA_IMPORT_ALLOW_MISSING_URI),
    requiresEndpointConfig: false,
    credentialsStored: false,
  };
  if (connectionPath) {
    const inspection = inspectXlsx(connectionPath);
    if (!inspection.hasWorkbook) throw new Error("connection export is not an XLSX workbook");
    manifest.connectionExport = {
      ...fileInfo(connectionPath),
      path: redactPath(connectionPath),
      format: "xlsx",
      inspection,
    };
  }
  if (apiPath) {
    manifest.apiExport = {
      ...fileInfo(apiPath),
      path: redactPath(apiPath),
      format: apiPath.endsWith(".gz") ? "gzip-json" : "json",
      summary: parseModuleExport(apiPath),
    };
  }
  return manifest;
}

function writeManifest(manifest) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const target = join(stateDir, "import-manifest.json");
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return target;
}

function parseFormFields(raw, label) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a JSON object`);
  }
}

function parseMongoDatabase(uri, label) {
  if (!uri) throw new Error(`${label} MongoDB URI is required`);
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`${label} MongoDB URI is invalid`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!database) throw new Error(`${label} MongoDB URI must include a database name`);
  return database;
}

function assertMongoDatabase(uri, expected, label) {
  if (!expected) return;
  const actual = parseMongoDatabase(uri, label);
  if (actual !== expected) {
    throw new Error(`${label} MongoDB database must be ${expected}, received ${actual}`);
  }
}

function parseJsonArray(raw, label) {
  if (!raw) return undefined;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${label} must be a JSON array`); }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string" || !value)) {
    throw new Error(`${label} must be a JSON array of collection names`);
  }
  return [...new Set(parsed)];
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function appendFields(form, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    if (typeof value === "object") form.append(key, JSON.stringify(value));
    else form.append(key, String(value));
  }
}

function authHeaders() {
  const headers = {};
  headers["x-requested-with"] = "XMLHttpRequest";
  if (env.TAPDATA_IMPORT_AUTHORIZATION) headers.Authorization = env.TAPDATA_IMPORT_AUTHORIZATION;
  return headers;
}

async function request(path, { method = "GET", form, body } = {}) {
  const base = env.TAPDATA_IMPORT_API_BASE_URL || env.TAPDATA_API_BASE_URL;
  if (!base) throw new Error("TAPDATA_IMPORT_API_BASE_URL (or TAPDATA_API_BASE_URL) is required in api mode");
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  if (url.origin !== new URL(base).origin || url.username || url.password) {
    throw new Error("import endpoints must use the configured API origin without URL credentials");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = authHeaders();
    const accessToken = env.TAPDATA_IMPORT_TOKEN || env.TAPDATA_ACCESS_TOKEN;
    if (accessToken) url.searchParams.set("access_token", accessToken);
    const init = { method, headers, signal: controller.signal, redirect: "error" };
    if (form) init.body = form;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let parsed;
    if (contentType.includes("json")) {
      try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    }
    if (!response.ok) {
      const detail = parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 12).join(",") : `content-type=${contentType || "unknown"}`;
      throw new Error(`${method} ${path} returned HTTP ${response.status} (${detail})`);
    }
    const payload = parsed && typeof parsed === "object" ? parsed : undefined;
    if (payload && payload.code !== undefined && payload.code !== "ok" && payload.code !== 0) {
      throw new Error(`${method} ${path} returned TapData code ${String(payload.code).slice(0, 40)}`);
    }
    const data = payload?.data ?? payload;
    return {
      status: response.status,
      contentType,
      summary: payload ? Object.keys(payload).slice(0, 20) : [],
      itemCount: Array.isArray(data) ? data.length : Array.isArray(data?.items) ? data.items.length : undefined,
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function uploadExport(path, filePath, fieldName, extraFields) {
  const form = new FormData();
  form.append(fieldName, new Blob([readFileSync(filePath)]), basename(filePath));
  appendFields(form, extraFields);
  return request(path, { method: "POST", form });
}

function replaceExactStrings(value, ids, targetId) {
  if (typeof value === "string") return ids.has(value) ? targetId : value;
  if (Array.isArray(value)) return value.map((item) => replaceExactStrings(item, ids, targetId));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceExactStrings(item, ids, targetId)]));
  return value;
}

function remapExistingTargetExport(filePath, targetName, targetId, tempDir) {
  let bytes = readFileSync(filePath);
  const compressed = filePath.endsWith(".gz");
  if (compressed) bytes = gunzipSync(bytes);
  const records = JSON.parse(bytes.toString("utf8"));
  const list = Array.isArray(records) ? records : [records];
  const targetIds = new Set();
  for (const record of list) {
    if (record?.collectionName !== "Connections") continue;
    const body = parseJsonValue(record.json);
    if (body?.name === targetName && typeof body.id === "string") targetIds.add(body.id);
  }
  if (targetIds.size === 0) throw new Error(`export does not contain the ${targetName} connection`);
  const remapped = list.map((record) => ({
    ...record,
    json: JSON.stringify(replaceExactStrings(parseJsonValue(record.json), targetIds, targetId)),
  }));
  const output = join(tempDir, basename(filePath));
  writeFileSync(output, compressed ? gzipSync(JSON.stringify(remapped)) : JSON.stringify(remapped));
  return output;
}

async function runApiImport(connectionPath, taskPath, apiPath) {
  const connectionPathApi = env.TAPDATA_CONNECTION_IMPORT_PATH;
  const taskPathApi = env.TAPDATA_TASK_IMPORT_PATH || "/api/Task/batch/import";
  const apiPathApi = env.TAPDATA_API_IMPORT_PATH || "/api/Modules/batch/import";
  if (!taskPathApi || !apiPathApi) {
    throw new Error("api mode requires TAPDATA_TASK_IMPORT_PATH and TAPDATA_API_IMPORT_PATH");
  }
  if (!env.TAPDATA_IMPORT_TOKEN && !env.TAPDATA_ACCESS_TOKEN && !env.TAPDATA_IMPORT_AUTHORIZATION) {
    throw new Error("api mode requires TAPDATA_IMPORT_TOKEN (or TAPDATA_IMPORT_AUTHORIZATION) in the private environment");
  }
  const sourceMongoUri = env.TAPDATA_IMPORT_SOURCE_MONGODB_URI || env.TAPDATA_SOURCE_MONGODB_URI;
  if (connectionPath && !sourceMongoUri && !asBool(env.TAPDATA_IMPORT_ALLOW_MISSING_URI)) {
    throw new Error("connection export omits the MongoDB URI; set TAPDATA_IMPORT_SOURCE_MONGODB_URI (or TAPDATA_SOURCE_MONGODB_URI) or explicitly allow missing URI");
  }
  if (connectionPath && env.TAPDATA_SOURCE_MONGODB_URI && !env.TAPDATA_IMPORT_URI_FIELD) {
    throw new Error("set TAPDATA_IMPORT_URI_FIELD to the exact form field accepted by your TapData import endpoint");
  }

  const connectionFields = parseFormFields(env.TAPDATA_IMPORT_CONNECTION_FORM_FIELDS_JSON, "TAPDATA_IMPORT_CONNECTION_FORM_FIELDS_JSON");
  const taskFields = parseFormFields(env.TAPDATA_IMPORT_TASK_FORM_FIELDS_JSON, "TAPDATA_IMPORT_TASK_FORM_FIELDS_JSON");
  const commonFields = parseFormFields(env.TAPDATA_IMPORT_FORM_FIELDS_JSON, "TAPDATA_IMPORT_FORM_FIELDS_JSON");
  const taskSummary = parseTaskExport(taskPath).task;
  const apiSummary = parseModuleExport(apiPath);
  const taskListPath = env.TAPDATA_TASK_LIST_PATH || "/api/Task";
  const apiListPath = env.TAPDATA_API_LIST_PATH || "/api/Modules";
  let taskList;
  let apiList;
  let skipExistingImport = false;
  if (asBool(env.TAPDATA_IMPORT_SKIP_EXISTING, true)) {
    // A fresh checkout has no deployment checkpoint. Query exact names before
    // uploading so a colleague's already prepared task/API is reused instead
    // of creating an `import_as_copy` duplicate.
    taskList = await request(`${taskListPath}${taskListPath.includes("?") ? "&" : "?"}limit=1000`);
    apiList = await request(`${apiListPath}${apiListPath.includes("?") ? "&" : "?"}limit=1000`);
    const existingTasks = listItems(taskList, "task");
    const existingModules = listItems(apiList, "API module");
    const existingTask = existingTasks.find((task) => task.name === taskSummary.name);
    const existingNames = new Set(existingModules.map((module) => module.name));
    const existingApiNames = apiSummary.moduleNames.filter((name) => existingNames.has(name));
    if (existingTask || existingApiNames.length > 0) {
      const missing = apiSummary.moduleNames.filter((name) => !existingNames.has(name));
      if (!existingTask || missing.length > 0) {
        throw new Error(`partial same-name import detected (task=${Boolean(existingTask)}, missingApiModules=${missing.length}); inspect TapData before retrying`);
      }
      skipExistingImport = true;
      log(`same-name task and ${existingApiNames.length} API modules already exist; skipping upload`);
    }
  }
  let uploadTaskPath = taskPath;
  let uploadApiPath = apiPath;
  let remapDir;
  if (!skipExistingImport && asBool(env.TAPDATA_IMPORT_USE_EXISTING_TARGET)) {
    const connectionListPath = env.TAPDATA_CONNECTION_LIST_PATH || "/api/Connections";
    const connectionResult = await request(`${connectionListPath}${connectionListPath.includes("?") ? "&" : "?"}limit=1000`);
    const existingTarget = listItems(connectionResult, "connection").find((connection) => connection.name === (env.TAPDATA_IMPORT_TARGET_CONNECTION_NAME || "MDM"));
    if (!existingTarget?.id) throw new Error("TapData Enterprise MDM connection was not found");
    remapDir = mkdtempSync(join(tmpdir(), "tapdata-existing-mdm-"));
    uploadTaskPath = remapExistingTargetExport(taskPath, env.TAPDATA_IMPORT_TARGET_CONNECTION_NAME || "MDM", existingTarget.id, remapDir);
    uploadApiPath = remapExistingTargetExport(apiPath, env.TAPDATA_IMPORT_TARGET_CONNECTION_NAME || "MDM", existingTarget.id, remapDir);
    log("prepared task and API imports to reuse the existing TapData MDM connection");
  }
  if (!skipExistingImport && connectionPathApi && connectionPath) {
    if (env.TAPDATA_SOURCE_MONGODB_URI) connectionFields[env.TAPDATA_IMPORT_URI_FIELD] = env.TAPDATA_SOURCE_MONGODB_URI;
    log("uploading connection export (credentials are not printed)");
    const connectionResult = await uploadExport(
      connectionPathApi,
      connectionPath,
      env.TAPDATA_IMPORT_CONNECTION_FILE_FIELD || "connectionFile",
      { ...commonFields, ...connectionFields },
    );
    log(`connection import accepted (HTTP ${connectionResult.status})`);
  } else if (!skipExistingImport && connectionPath) {
    log("connection XLSX upload skipped; the task package will be imported with its embedded connection records");
  }

  if (!skipExistingImport) {
    log("uploading task export after connection import");
    const taskResult = await uploadExport(
      taskPathApi,
      uploadTaskPath,
      "file",
      {
        ...commonFields,
        ...taskFields,
        type: env.TAPDATA_TASK_IMPORT_TYPE || "dataflow",
        importMode: env.TAPDATA_TASK_IMPORT_MODE || "import_as_copy",
        listtags: parseJsonValue(env.TAPDATA_IMPORT_LISTTAGS_JSON || "[]"),
      },
    );
    log(`task import accepted (HTTP ${taskResult.status})`);

    log("uploading API module export");
    const apiResult = await uploadExport(
      apiPathApi,
      uploadApiPath,
      "file",
      {
        type: env.TAPDATA_API_IMPORT_TYPE || "Modules",
        importMode: env.TAPDATA_API_IMPORT_MODE || "import_as_copy",
        listtags: parseJsonValue(env.TAPDATA_IMPORT_LISTTAGS_JSON || "[]"),
      },
    );
    log(`API module import accepted (HTTP ${apiResult.status})`);
    // Refresh after the remote mutation; the preflight lists intentionally
    // represented the state before the upload.
    taskList = undefined;
    apiList = undefined;
  }
  if (remapDir) rmSync(remapDir, { recursive: true, force: true });

  if (env.TAPDATA_CONNECTION_LIST_PATH) {
    const result = await request(env.TAPDATA_CONNECTION_LIST_PATH);
    log(`connection list check accepted (HTTP ${result.status})`);
  }

  if (!taskList) taskList = await request(taskListPath);
  if (!apiList) apiList = await request(apiListPath);
  log(`task list check accepted (HTTP ${taskList.status}${taskList.itemCount === undefined ? "" : `, items=${taskList.itemCount}`})`);
  log(`API module list check accepted (HTTP ${apiList.status}${apiList.itemCount === undefined ? "" : `, items=${apiList.itemCount}`})`);

  if (asBool(env.TAPDATA_IMPORT_POSTPROCESS)) {
    await postProcessImport({ taskList, apiList, taskPath, apiPath });
  } else if (asBool(env.TAPDATA_IMPORT_AUTOSTART)) {
    if (!env.TAPDATA_TASK_START_PATH) throw new Error("TAPDATA_IMPORT_AUTOSTART=true requires the exact TAPDATA_TASK_START_PATH when post-processing is disabled");
    const startBody = env.TAPDATA_TASK_START_BODY_JSON ? parseFormFields(env.TAPDATA_TASK_START_BODY_JSON, "TAPDATA_TASK_START_BODY_JSON") : undefined;
    const result = await request(env.TAPDATA_TASK_START_PATH, {
      method: env.TAPDATA_TASK_START_METHOD || "POST",
      body: startBody,
    });
    log(`task start accepted (HTTP ${result.status})`);
  } else {
    log("task start skipped; set TAPDATA_IMPORT_AUTOSTART=true only after confirming the exact start endpoint");
  }
}

function listItems(result, label) {
  const items = result?.payload?.data?.items;
  if (!Array.isArray(items)) throw new Error(`${label} list response did not contain data.items`);
  return items;
}

function postProcessUri(name, uri, connection) {
  if (!uri) throw new Error(`TAPDATA_IMPORT_POSTPROCESS requires a URI for ${name}`);
  return {
    id: connection.id,
    name: connection.name,
    database_type: connection.database_type || connection.databaseType || "MongoDB",
    status: "testing",
    submit: true,
    config: {
      isUri: true,
      uri,
      ssl: false,
      mongodbLoadSchemaSampleSize: 1000,
      schemaLimit: 1024,
      __connectionType: "source_and_target",
    },
  };
}

async function inspectMdmCollections(uri, collectionNames) {
  const database = parseMongoDatabase(uri, "Target");
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: timeoutMs,
    connectTimeoutMS: timeoutMs,
  });
  try {
    await client.connect();
    const db = client.db(database);
    const available = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
    const missing = collectionNames.filter((name) => !available.has(name));
    const empty = [];
    for (const name of collectionNames) {
      if (missing.includes(name)) continue;
      const document = await db.collection(name).findOne({}, { projection: { _id: 1 } });
      if (!document) empty.push(name);
    }
    return { database, missing, empty };
  } finally {
    await client.close();
  }
}

async function waitForMdmCollections(uri, collectionNames) {
  const attempts = asPositiveInt(env.TAPDATA_IMPORT_MDM_WAIT_ATTEMPTS, 60);
  const intervalMs = asPositiveInt(env.TAPDATA_IMPORT_MDM_WAIT_INTERVAL_MS, 5_000);
  let last = { missing: collectionNames, empty: [] };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = await inspectMdmCollections(uri, collectionNames);
      if (last.missing.length === 0 && last.empty.length === 0) {
        log(`verified MDM database ${last.database}: ${collectionNames.length} collections contain data`);
        return;
      }
      log(`waiting for MDM data (${attempt}/${attempts}): missing=${last.missing.length}, empty=${last.empty.length}`);
    } catch (error) {
      if (attempt === attempts) throw new Error(`MDM data verification failed: ${error instanceof Error ? error.message : String(error)}`);
      log(`waiting for MDM MongoDB (${attempt}/${attempts}); credentials and URI are not printed`);
    }
    if (attempt < attempts) await sleep(intervalMs);
  }
  throw new Error(`MDM database is not ready: missing=${last.missing.join(",")}, empty=${last.empty.join(",")}`);
}

async function postProcessImport({ taskList, apiList, taskPath, apiPath }) {
  const connectionListPath = env.TAPDATA_CONNECTION_LIST_PATH || "/api/Connections";
  const connectionPatchTemplate = env.TAPDATA_CONNECTION_PATCH_PATH || "/api/Connections/{id}";
  const modulePatchPath = env.TAPDATA_MODULE_PATCH_PATH || "/api/Modules";
  const connectionResult = await request(`${connectionListPath}${connectionListPath.includes("?") ? "&" : "?"}limit=1000`);
  const connections = listItems(connectionResult, "connection");
  const byName = new Map(connections.map((connection) => [connection.name, connection]));
  const source = byName.get(env.TAPDATA_IMPORT_SOURCE_CONNECTION_NAME || "MongoDB_Source");
  const target = byName.get(env.TAPDATA_IMPORT_TARGET_CONNECTION_NAME || "MDM");
  const sourceUri = env.TAPDATA_IMPORT_SOURCE_MONGODB_URI || env.TAPDATA_SOURCE_MONGODB_URI;
  const targetUri = env.TAPDATA_IMPORT_TARGET_MONGODB_URI;
  const useExistingTarget = asBool(env.TAPDATA_IMPORT_USE_EXISTING_TARGET);
  if (!source || !target) throw new Error("post-processing requires MongoDB_Source and the existing TapData MDM connection");
  assertMongoDatabase(sourceUri, env.TAPDATA_IMPORT_SOURCE_MONGODB_DB, "Source");
  if (!useExistingTarget) {
    assertMongoDatabase(targetUri, env.TAPDATA_IMPORT_TARGET_MONGODB_DB, "Target");
  } else if (targetUri) {
    log("using the existing TapData MDM connection; target URI is ignored");
  }

  const patchedIds = new Set();
  for (const [connection, uri] of useExistingTarget ? [[source, sourceUri]] : [[source, sourceUri], [target, targetUri]]) {
    const path = connectionPatchTemplate.replace("{id}", encodeURIComponent(connection.id));
    await request(path, { method: "PATCH", body: postProcessUri(connection.name, uri, connection) });
    patchedIds.add(connection.id);
  }
  if (useExistingTarget) patchedIds.add(target.id);

  const taskItems = listItems(taskList, "task");
  const taskSummary = parseTaskExport(taskPath).task;
  const task = taskItems.find((item) => item.name === taskSummary.name) || taskItems[taskItems.length - 1];
  if (!task?.id) throw new Error("post-processing could not resolve the imported task id");

  const apiItems = listItems(apiList, "API module");
  const apiSummary = parseModuleExport(apiPath);
  const apiNames = new Set(apiSummary.moduleNames);
  const importedModules = apiItems.filter((item) => apiNames.has(item.name));
  if (importedModules.length === 0) throw new Error("post-processing could not resolve imported API modules");
  const missingModules = [...apiNames].filter((name) => !importedModules.some((item) => item.name === name));
  if (missingModules.length > 0 && !asBool(env.TAPDATA_IMPORT_ALLOW_PARTIAL_API)) {
    throw new Error(`post-processing could not resolve all API modules (missing=${missingModules.join(",")})`);
  }
  for (const apiModule of importedModules) {
    if (apiModule.connectionId && !patchedIds.has(apiModule.connectionId) && !useExistingTarget) {
      const moduleConnection = connections.find((connection) => connection.id === apiModule.connectionId);
      if (!moduleConnection) throw new Error(`API module ${apiModule.name} references an unknown connection`);
      const path = connectionPatchTemplate.replace("{id}", encodeURIComponent(moduleConnection.id));
      await request(path, { method: "PATCH", body: postProcessUri(moduleConnection.name, targetUri, moduleConnection) });
      patchedIds.add(moduleConnection.id);
    }
  }

  // Connection tests are asynchronous in TapData. Poll until every patched
  // connection reports ready instead of claiming that a PATCH alone proved
  // data-plane health.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(5_000);
    const current = await request(`${connectionListPath}${connectionListPath.includes("?") ? "&" : "?"}limit=1000`);
    const currentById = new Map(listItems(current, "connection").map((connection) => [connection.id, connection]));
    const statuses = [...patchedIds].map((id) => currentById.get(id)?.status);
    if (statuses.every((status) => ["ready", "normal", "active"].includes(status))) break;
    if (attempt === 11) throw new Error(`post-processing connection test did not become ready (statuses=${statuses.join(",")})`);
  }

  if (asBool(env.TAPDATA_IMPORT_AUTOSTART)) {
    const template = env.TAPDATA_TASK_START_PATH_TEMPLATE;
    const path = template ? template.replaceAll("{taskId}", encodeURIComponent(task.id)) : env.TAPDATA_TASK_START_PATH;
    if (!path) throw new Error("TAPDATA_IMPORT_AUTOSTART=true requires TAPDATA_TASK_START_PATH or TAPDATA_TASK_START_PATH_TEMPLATE");
    const startBody = env.TAPDATA_TASK_START_BODY_JSON ? parseFormFields(env.TAPDATA_TASK_START_BODY_JSON, "TAPDATA_TASK_START_BODY_JSON") : undefined;
    const result = await request(path, { method: env.TAPDATA_TASK_START_METHOD || "POST", body: startBody });
    log(`task start accepted after post-processing (HTTP ${result.status})`);
  }

  if (asBool(env.TAPDATA_IMPORT_VERIFY_MDM_DATA)) {
    if (useExistingTarget) {
      log("skipping direct MongoDB MDM verification; TapData Enterprise manages the existing MDM connection");
    } else if (!targetUri) {
      throw new Error("TAPDATA_IMPORT_VERIFY_MDM_DATA=true requires TAPDATA_IMPORT_TARGET_MONGODB_URI");
    }
    const expectedCollections = parseJsonArray(env.TAPDATA_IMPORT_MDM_COLLECTIONS_JSON, "TAPDATA_IMPORT_MDM_COLLECTIONS_JSON") || apiSummary.moduleTableNames;
    if (expectedCollections.length === 0) throw new Error("MDM data verification requires expected collection names");
    if (!useExistingTarget) await waitForMdmCollections(targetUri, expectedCollections);
  }

  for (const apiModule of importedModules) {
    const modulePatch = { id: apiModule.id, status: "active", tableName: apiModule.tableName };
    if (useExistingTarget && apiModule.connectionId && apiModule.connectionId !== target.id) {
      // API modules in an export may carry an installation-specific MDM id.
      // Point them at the Enterprise-provided MDM connection before publishing.
      modulePatch.connectionId = target.id;
      modulePatch.connectionName = target.name;
    }
    await request(modulePatchPath, {
      method: "PATCH",
      body: modulePatch,
    });
  }
  log(`post-processing verified ${patchedIds.size} MongoDB connection(s) and published ${importedModules.length} API module(s)`);
}

async function startTask() {
  if (!env.TAPDATA_TASK_START_PATH) {
    throw new Error("start mode requires the exact TAPDATA_TASK_START_PATH; no endpoint is guessed");
  }
  const startBody = env.TAPDATA_TASK_START_BODY_JSON
    ? parseFormFields(env.TAPDATA_TASK_START_BODY_JSON, "TAPDATA_TASK_START_BODY_JSON")
    : undefined;
  const result = await request(env.TAPDATA_TASK_START_PATH, {
    method: env.TAPDATA_TASK_START_METHOD || "POST",
    body: startBody,
  });
  log(`task start accepted (HTTP ${result.status})`);
}

async function main() {
  if (!["manual", "prepare", "api", "start"].includes(importMode)) {
    throw new Error("TAPDATA_IMPORT_MODE/CLI mode must be manual, prepare, api, or start");
  }

  if (importMode === "start") {
    await startTask();
    return;
  }

  const connectionPath = resolveOptionalArtifact(
    env.TAPDATA_CONNECTION_EXPORT,
    "connection",
    "MongoDB_Source-20260915.xlsx",
  );
  const taskPath = resolveArtifact(
    env.TAPDATA_TASK_EXPORT,
    "task",
    "TapData_CDC_Patron_Table_Sessions_To_MongoDB-20260915.json.gz",
  );
  const apiPath = importMode === "api"
    ? resolveArtifact(env.TAPDATA_API_EXPORT, "api", "module_batch-20260915.json.gz")
    : resolveOptionalArtifact(env.TAPDATA_API_EXPORT, "api", "module_batch-20260915.json.gz");
  const manifest = createManifest(connectionPath, taskPath, apiPath);
  const manifestPath = writeManifest(manifest);

  if (manifest.connectionExport) log(`validated connection export ${manifest.connectionExport.fileName} (${manifest.connectionExport.sizeBytes} bytes)`);
  log(`validated task export ${manifest.taskExport.fileName} (${manifest.taskExport.sizeBytes} bytes)`);
  log(`task records=${manifest.taskExport.summary.recordCount}, connections=${manifest.taskExport.summary.connectionCount}, metadataInstances=${manifest.taskExport.summary.metadataInstanceCount}, tasks=${manifest.taskExport.summary.taskCount}`);
  if (manifest.apiExport) log(`validated API export ${manifest.apiExport.fileName} (${manifest.apiExport.sizeBytes} bytes)`);
  if (manifest.apiExport) log(`API records=${manifest.apiExport.summary.recordCount}, modules=${manifest.apiExport.summary.moduleCount}, connections=${manifest.apiExport.summary.connectionCount}, metadataInstances=${manifest.apiExport.summary.metadataInstanceCount}`);
  log(`redacted manifest written to ${manifestPath}`);

  if (importMode !== "api") {
    log("manual mode: import the task and API packages through the TapData UI/API; the XLSX export is optional and does not contain the source MongoDB URI");
    log("no network calls were made");
    return;
  }

  await runApiImport(connectionPath, taskPath, apiPath);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
