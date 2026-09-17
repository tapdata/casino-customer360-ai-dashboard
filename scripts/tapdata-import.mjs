#!/usr/bin/env node

/**
 * Validate and optionally upload TapData connection/task/API exports.
 *
 * TapData export/import endpoints are edition/version specific, so this tool
 * deliberately follows the official TapData 4.21 browser API contract. The
 * routes and multipart field names are still configurable for other editions.
 * `manual` mode is safe for preparing a hand-off manifest; `api` mode uploads
 * task and API packages as copies and never starts a task by default.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

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
  return {
    recordCount: records.length,
    moduleCount: moduleRecords.length,
    connectionCount: connectionRecords.length,
    metadataInstanceCount: metadataRecords.length,
    moduleNames: [...new Set(names)].slice(0, 20),
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
  if (connectionPath && !env.TAPDATA_SOURCE_MONGODB_URI && !asBool(env.TAPDATA_IMPORT_ALLOW_MISSING_URI)) {
    throw new Error("connection export omits the MongoDB URI; set TAPDATA_SOURCE_MONGODB_URI or explicitly allow missing URI");
  }
  if (connectionPath && env.TAPDATA_SOURCE_MONGODB_URI && !env.TAPDATA_IMPORT_URI_FIELD) {
    throw new Error("set TAPDATA_IMPORT_URI_FIELD to the exact form field accepted by your TapData import endpoint");
  }

  const connectionFields = parseFormFields(env.TAPDATA_IMPORT_CONNECTION_FORM_FIELDS_JSON, "TAPDATA_IMPORT_CONNECTION_FORM_FIELDS_JSON");
  const taskFields = parseFormFields(env.TAPDATA_IMPORT_TASK_FORM_FIELDS_JSON, "TAPDATA_IMPORT_TASK_FORM_FIELDS_JSON");
  const commonFields = parseFormFields(env.TAPDATA_IMPORT_FORM_FIELDS_JSON, "TAPDATA_IMPORT_FORM_FIELDS_JSON");
  if (connectionPathApi && connectionPath) {
    if (env.TAPDATA_SOURCE_MONGODB_URI) connectionFields[env.TAPDATA_IMPORT_URI_FIELD] = env.TAPDATA_SOURCE_MONGODB_URI;
    log("uploading connection export (credentials are not printed)");
    const connectionResult = await uploadExport(
      connectionPathApi,
      connectionPath,
      env.TAPDATA_IMPORT_CONNECTION_FILE_FIELD || "connectionFile",
      { ...commonFields, ...connectionFields },
    );
    log(`connection import accepted (HTTP ${connectionResult.status})`);
  } else if (connectionPath) {
    log("connection XLSX upload skipped; the task package will be imported with its embedded connection records");
  }

  log("uploading task export after connection import");
  const taskResult = await uploadExport(
    taskPathApi,
    taskPath,
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
    apiPath,
    "file",
    {
      type: env.TAPDATA_API_IMPORT_TYPE || "Modules",
      importMode: env.TAPDATA_API_IMPORT_MODE || "import_as_copy",
      listtags: parseJsonValue(env.TAPDATA_IMPORT_LISTTAGS_JSON || "[]"),
    },
  );
  log(`API module import accepted (HTTP ${apiResult.status})`);

  if (env.TAPDATA_CONNECTION_LIST_PATH) {
    const result = await request(env.TAPDATA_CONNECTION_LIST_PATH);
    log(`connection list check accepted (HTTP ${result.status})`);
  }

  const verifyTaskPath = env.TAPDATA_TASK_LIST_PATH || "/api/Task";
  const verifyApiPath = env.TAPDATA_API_LIST_PATH || "/api/Modules";
  const taskList = await request(verifyTaskPath);
  const apiList = await request(verifyApiPath);
  log(`task list check accepted (HTTP ${taskList.status}${taskList.itemCount === undefined ? "" : `, items=${taskList.itemCount}`})`);
  log(`API module list check accepted (HTTP ${apiList.status}${apiList.itemCount === undefined ? "" : `, items=${apiList.itemCount}`})`);

  if (asBool(env.TAPDATA_IMPORT_AUTOSTART)) {
    if (!env.TAPDATA_TASK_START_PATH) {
      throw new Error("TAPDATA_IMPORT_AUTOSTART=true requires the exact TAPDATA_TASK_START_PATH");
    }
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
