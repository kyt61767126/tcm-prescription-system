var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _lib/auth.js
var ROLE = {
  PLATFORM_ADMIN: "platform_admin",
  CLINIC_ADMIN: "clinic_admin",
  DOCTOR: "doctor"
};
var KV_NS = {
  PLATFORM_ADMINS: "system:platform_admins",
  CLINICS: "system:clinics"
  // 诊所分区键（前缀）：
  // clinic:{clinicId}:users
  // clinic:{clinicId}:prescriptions
  // clinic:{clinicId}:medicines
  // clinic:{clinicId}:formulas
  // clinic:{clinicId}:prescriptions_trash
  // clinic:{clinicId}:seq:{username}:daily:{yymmdd}
};
function clinicKey(clinicId, name) {
  return `clinic:${clinicId}:${name}`;
}
__name(clinicKey, "clinicKey");
function safeAtob(str) {
  try {
    const decoded = atob(str);
    const bytes = [];
    for (let i2 = 0; i2 < decoded.length; i2++) {
      bytes.push(decoded.charCodeAt(i2));
    }
    let result = "";
    let i = 0;
    while (i < bytes.length) {
      const byte = bytes[i];
      if (byte < 128) {
        result += String.fromCharCode(byte);
        i++;
      } else if (byte < 192) {
        result += String.fromCharCode(byte);
        i++;
      } else if (byte < 224) {
        if (i + 1 < bytes.length) {
          const charCode = (byte & 31) << 6 | bytes[i + 1] & 63;
          result += String.fromCharCode(charCode);
          i += 2;
        } else {
          result += String.fromCharCode(byte);
          i++;
        }
      } else if (byte < 240) {
        if (i + 2 < bytes.length) {
          const charCode = (byte & 15) << 12 | (bytes[i + 1] & 63) << 6 | bytes[i + 2] & 63;
          result += String.fromCharCode(charCode);
          i += 3;
        } else {
          result += String.fromCharCode(byte);
          i++;
        }
      } else if (byte < 248) {
        if (i + 3 < bytes.length) {
          const charCode = (byte & 7) << 18 | (bytes[i + 1] & 63) << 12 | (bytes[i + 2] & 63) << 6 | bytes[i + 3] & 63;
          result += String.fromCharCode(charCode);
          i += 4;
        } else {
          result += String.fromCharCode(byte);
          i++;
        }
      } else {
        result += String.fromCharCode(byte);
        i++;
      }
    }
    return result;
  } catch (e) {
    console.error("safeAtob error:", e);
    return atob(str);
  }
}
__name(safeAtob, "safeAtob");
function parseAuthHeader(request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  try {
    let payload = null;
    if (authHeader.startsWith("Basic ")) {
      const decoded = safeAtob(authHeader.slice(6));
      if (decoded.startsWith("{")) {
        payload = JSON.parse(decoded);
      } else {
        return null;
      }
    }
    if (!payload || !payload.username || !payload.role) return null;
    return {
      username: payload.username,
      role: payload.role,
      clinicId: payload.clinicId || null,
      isPlatformAdmin: payload.role === ROLE.PLATFORM_ADMIN,
      isClinicAdmin: payload.role === ROLE.CLINIC_ADMIN,
      isDoctor: payload.role === ROLE.DOCTOR,
      // 兼容旧代码的 isAdmin 字段：clinic_admin 与 platform_admin 在诊所内均视为管理员
      isAdmin: payload.role === ROLE.PLATFORM_ADMIN || payload.role === ROLE.CLINIC_ADMIN,
      allowSavePrescription: true
    };
  } catch (e) {
    console.error("Auth parsing error:", e);
    return null;
  }
}
__name(parseAuthHeader, "parseAuthHeader");
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + ":" + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashPassword, "hashPassword");
function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateSalt, "generateSalt");
async function verifyPassword(password, salt, expectedHash) {
  const actualHash = await hashPassword(password, salt);
  return actualHash === expectedHash;
}
__name(verifyPassword, "verifyPassword");
var ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/tcm-prescription-system\.pages\.dev$/i,
  /^https:\/\/[a-z0-9-]+\.tcm-prescription-system\.pages\.dev$/i,
  /^https:\/\/localhost(:\d+)?$/i,
  /^http:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^capacitor:\/\/localhost$/i,
  /^file:\/\//i
];
function getAllowedOrigin(request) {
  if (!request) return "*";
  const origin = request.headers.get("Origin");
  if (origin === null || origin === void 0 || origin === "null") return "null";
  if (ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin))) return origin;
  return null;
}
__name(getAllowedOrigin, "getAllowedOrigin");
function buildCorsHeaders(request) {
  const allowed = getAllowedOrigin(request);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
  if (allowed) {
    headers["Access-Control-Allow-Origin"] = allowed;
    if (allowed !== "null") headers["Vary"] = "Origin";
  }
  return headers;
}
__name(buildCorsHeaders, "buildCorsHeaders");
function corsResponse(body, init = {}, request = null) {
  const corsHeaders = buildCorsHeaders(request);
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...init.headers || {}
    }
  });
}
__name(corsResponse, "corsResponse");
function handleOptions(request = null) {
  return new Response(null, { status: 200, headers: buildCorsHeaders(request) });
}
__name(handleOptions, "handleOptions");
function getKV(env) {
  return env.KV || env.TCM_PRESCRIPTION_KV || env["tcm-prescription-kv"] || env["TCM-PRESCRIPTION-KV"] || env.TCM_KV || env.PRESCRIPTION_KV || null;
}
__name(getKV, "getKV");
function getBeijingTime() {
  const now = /* @__PURE__ */ new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1e3);
}
__name(getBeijingTime, "getBeijingTime");
function formatBeijingDateYYMMDD(date) {
  const year = date.getUTCFullYear().toString().substring(2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return year + month + day;
}
__name(formatBeijingDateYYMMDD, "formatBeijingDateYYMMDD");

// api/backup-kv.js
async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return handleOptions(request);
  const expectedSecret = env.BACKUP_SECRET;
  if (!expectedSecret) {
    return corsResponse({
      success: false,
      error: "\u5907\u4EFD\u529F\u80FD\u672A\u914D\u7F6E\uFF1A\u8BF7\u5728 Cloudflare Pages \u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF BACKUP_SECRET"
    }, { status: 503 });
  }
  const authHeader = request.headers.get("Authorization") || "";
  const providedSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (providedSecret !== expectedSecret) {
    return corsResponse({
      success: false,
      error: "Unauthorized: Invalid secret key"
    }, { status: 401 });
  }
  try {
    const kv = getKV(env);
    if (!kv) {
      return corsResponse({
        success: false,
        error: "KV\u5B58\u50A8\u672A\u914D\u7F6E"
      }, { status: 500 });
    }
    const keys = await kv.list();
    const backupData = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      version: "1.0.0",
      keys: {}
    };
    for (const key of keys.keys) {
      const value = await kv.get(key.name, "json");
      backupData.keys[key.name] = value;
    }
    const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const timestamp = Date.now();
    const backupKey = `kv_backup_${date}_${timestamp}`;
    await kv.put(backupKey, JSON.stringify(backupData));
    return corsResponse({
      success: true,
      message: "KV data backup completed successfully",
      backupKey,
      keysCount: keys.keys.length,
      timestamp: backupData.timestamp
    });
  } catch (error) {
    console.error("Backup error:", error);
    return corsResponse({
      success: false,
      error: "Backup failed"
    }, { status: 500 });
  }
}
__name(onRequest, "onRequest");

// api/formulas.js
async function onRequest2(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  if (method === "OPTIONS") return handleOptions(request);
  try {
    const kv = getKV(env);
    if (!kv) {
      return corsResponse({
        success: false,
        error: "KV\u5B58\u50A8\u672A\u914D\u7F6E\u3002\u8BF7\u5728Cloudflare Pages\u8BBE\u7F6E\u4E2D\u914D\u7F6EKV binding",
        requireSetup: true
      }, { status: 500 });
    }
    const currentUser = parseAuthHeader(request);
    if (currentUser && currentUser.isPlatformAdmin) {
      return corsResponse({ success: false, error: "\u5E73\u53F0\u603B\u7BA1\u7406\u5458\u4E0D\u53C2\u4E0E\u8BCA\u6240\u65B9\u5242\u5E93\u4E1A\u52A1" }, { status: 403 });
    }
    if (!currentUser || !currentUser.clinicId) {
      return corsResponse({ success: false, error: "\u672A\u6388\u6743\u8BBF\u95EE\uFF0C\u8BF7\u5148\u767B\u5F55" }, { status: 401 });
    }
    const KV_FORMULAS_KEY = clinicKey(currentUser.clinicId, "formulas");
    if (method === "GET") {
      let formulas = await kv.get(KV_FORMULAS_KEY, "json");
      if (!formulas || !Array.isArray(formulas)) {
        formulas = [];
        await kv.put(KV_FORMULAS_KEY, JSON.stringify(formulas));
      }
      return corsResponse({ success: true, data: formulas, count: formulas.length });
    }
    if (method === "POST" || method === "PUT") {
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return corsResponse({ success: false, error: "\u8BF7\u6C42\u6570\u636E\u683C\u5F0F\u9519\u8BEF" }, { status: 400 });
      }
      if (!body.formulas || !Array.isArray(body.formulas)) {
        return corsResponse({ success: false, error: "\u65E0\u6548\u7684\u65B9\u5242\u6570\u636E" }, { status: 400 });
      }
      const formulasWithOwner = body.formulas.map((f) => ({
        ...f,
        createdBy: f.createdBy || currentUser.username,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }));
      let existingFormulas = await kv.get(KV_FORMULAS_KEY, "json") || [];
      if (currentUser.isClinicAdmin) {
        existingFormulas = formulasWithOwner;
      } else {
        const userFormulas = existingFormulas.filter((f) => f.createdBy === currentUser.username);
        const otherFormulas = existingFormulas.filter((f) => f.createdBy !== currentUser.username);
        existingFormulas = [...otherFormulas, ...formulasWithOwner.filter((f) => f.createdBy === currentUser.username)];
      }
      await kv.put(KV_FORMULAS_KEY, JSON.stringify(existingFormulas));
      return corsResponse({
        success: true,
        message: "\u65B9\u5242\u5E93\u4FDD\u5B58\u6210\u529F",
        count: existingFormulas.length,
        data: existingFormulas,
        clinicId: currentUser.clinicId
      });
    }
    return corsResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Formulas API error:", error);
    return corsResponse({
      success: false,
      error: "Internal server error"
    }, { status: 500 });
  }
}
__name(onRequest2, "onRequest");

// api/init.js
async function onRequest3(context) {
  const { request, env } = context;
  const method = request.method;
  if (method === "OPTIONS") return handleOptions(request);
  try {
    const kv = getKV(env);
    if (!kv) {
      return corsResponse({
        success: false,
        error: "KV\u5B58\u50A8\u672A\u914D\u7F6E\u3002\u8BF7\u5728Cloudflare Pages\u8BBE\u7F6E\u4E2D\u914D\u7F6EKV binding",
        requireSetup: true
      }, { status: 500 });
    }
    const admins = await kv.get(KV_NS.PLATFORM_ADMINS, "json");
    const initialized = Array.isArray(admins) && admins.length > 0;
    if (method === "GET") {
      return corsResponse({
        success: true,
        initialized,
        platformAdminCount: initialized ? admins.length : 0
      });
    }
    if (method === "POST") {
      if (initialized) {
        return corsResponse({
          success: false,
          error: "\u7CFB\u7EDF\u5DF2\u521D\u59CB\u5316\uFF0C\u5982\u9700\u65B0\u589E\u5E73\u53F0\u7BA1\u7406\u5458\u8BF7\u8054\u7CFB\u73B0\u6709\u5E73\u53F0\u7BA1\u7406\u5458\u6216\u76F4\u63A5\u4FEE\u6539 KV",
          initialized: true
        }, { status: 403 });
      }
      const body = await request.json();
      if (!body.username || !body.password) {
        return corsResponse({ success: false, error: "\u7528\u6237\u540D\u4E0E\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A" }, { status: 400 });
      }
      if (body.password.length < 8) {
        return corsResponse({ success: false, error: "\u5BC6\u7801\u957F\u5EA6\u81F3\u5C11 8 \u4F4D" }, { status: 400 });
      }
      const salt = generateSalt();
      const passwordHash = await hashPassword(body.password, salt);
      const newAdmin = {
        username: body.username,
        name: body.name || body.username,
        role: ROLE.PLATFORM_ADMIN,
        passwordHash,
        salt,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await kv.put(KV_NS.PLATFORM_ADMINS, JSON.stringify([newAdmin]));
      return corsResponse({
        success: true,
        message: "\u5E73\u53F0\u603B\u7BA1\u7406\u5458\u521D\u59CB\u5316\u6210\u529F\uFF0C\u8BF7\u59A5\u5584\u4FDD\u7BA1\u8D26\u53F7",
        admin: { username: newAdmin.username, name: newAdmin.name, role: newAdmin.role }
      });
    }
    return corsResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Init API error:", error);
    return corsResponse({
      success: false,
      error: error.message || "Internal server error"
    }, { status: 500 });
  }
}
__name(onRequest3, "onRequest");

// api/medicines.js
var KV_PLATFORM_MEDICINES = "system:platform_medicines";
function getDefaultMedicines() {
  return [
    { id: 1, name: "\u9EBB\u9EC4", code: "mh", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 2, name: "\u6842\u679D", code: "gz", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 3, name: "\u674F\u4EC1", code: "xr", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 4, name: "\u7518\u8349", code: "gc", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 5, name: "\u77F3\u818F", code: "sg", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 6, name: "\u77E5\u6BCD", code: "zm", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 7, name: "\u9EC4\u8FDE", code: "hl", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 8, name: "\u9EC4\u82A9", code: "hq", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 9, name: "\u9EC4\u67CF", code: "hb", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false },
    { id: 10, name: "\u6800\u5B50", code: "zz", unit: "g", costPrice: 0, price: 0, dosage: 10, stock: 0, priority_use: false }
  ];
}
__name(getDefaultMedicines, "getDefaultMedicines");
function normalizeMedicines(list) {
  if (!Array.isArray(list)) return [];
  return list.map((m) => ({
    ...m,
    priority_use: m.priority_use === void 0 ? false : !!m.priority_use
  }));
}
__name(normalizeMedicines, "normalizeMedicines");
async function getPlatformMedicines(kv) {
  let list = await kv.get(KV_PLATFORM_MEDICINES, "json");
  if (!list || !Array.isArray(list) || list.length === 0) {
    list = getDefaultMedicines();
    await kv.put(KV_PLATFORM_MEDICINES, JSON.stringify(list));
  }
  return normalizeMedicines(list);
}
__name(getPlatformMedicines, "getPlatformMedicines");
async function onRequest4(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  const query = url.searchParams;
  if (method === "OPTIONS") return handleOptions(request);
  try {
    const kv = getKV(env);
    if (!kv) {
      return corsResponse({
        success: false,
        error: "KV\u5B58\u50A8\u672A\u914D\u7F6E\u3002\u8BF7\u5728Cloudflare Pages\u8BBE\u7F6E\u4E2D\u914D\u7F6EKV binding",
        requireSetup: true
      }, { status: 500 });
    }
    const currentUser = parseAuthHeader(request);
    if (!currentUser) {
      return corsResponse({ success: false, error: "\u672A\u6388\u6743\u8BBF\u95EE\uFF0C\u8BF7\u5148\u767B\u5F55" }, { status: 401 });
    }
    if (query.get("medicine") === "priority") {
      if (!currentUser.isClinicAdmin) {
        return corsResponse({ success: false, error: "\u6743\u9650\u4E0D\u8DB3\uFF0C\u4EC5\u8BCA\u6240\u7BA1\u7406\u5458\u53EF\u5207\u6362\u4F18\u5148\u6807\u8BB0" }, { status: 403 });
      }
      if (method !== "POST" && method !== "PUT") {
        return corsResponse({ success: false, error: "Method not allowed" }, { status: 405 });
      }
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return corsResponse({ success: false, error: "\u8BF7\u6C42\u6570\u636E\u683C\u5F0F\u9519\u8BEF" }, { status: 400 });
      }
      if (body.medicineId === void 0 || body.priorityUse === void 0) {
        return corsResponse({ success: false, error: "\u7F3A\u5C11 medicineId \u6216 priorityUse \u53C2\u6570" }, { status: 400 });
      }
      const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, "medicines");
      let medicines = await kv.get(KV_MEDICINES_KEY, "json");
      if (!medicines || !Array.isArray(medicines)) {
        return corsResponse({ success: false, error: "\u836F\u54C1\u5E93\u4E3A\u7A7A" }, { status: 404 });
      }
      const idx = medicines.findIndex((m) => m.id === body.medicineId);
      if (idx < 0) {
        return corsResponse({ success: false, error: "\u672A\u627E\u5230\u6307\u5B9A\u836F\u6750" }, { status: 404 });
      }
      medicines[idx].priority_use = !!body.priorityUse;
      await kv.put(KV_MEDICINES_KEY, JSON.stringify(medicines));
      return corsResponse({
        success: true,
        message: "\u4F18\u5148\u4F7F\u7528\u6807\u8BB0\u5DF2\u66F4\u65B0",
        medicine: medicines[idx]
      });
    }
    if (query.get("medicine") === "sync_platform") {
      if (!currentUser.isClinicAdmin) {
        return corsResponse({ success: false, error: "\u6743\u9650\u4E0D\u8DB3\uFF0C\u4EC5\u8BCA\u6240\u7BA1\u7406\u5458\u53EF\u540C\u6B65\u5E73\u53F0\u515C\u5E95\u5E93" }, { status: 403 });
      }
      if (method !== "POST" && method !== "PUT") {
        return corsResponse({ success: false, error: "Method not allowed" }, { status: 405 });
      }
      const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, "medicines");
      const platformList = await getPlatformMedicines(kv);
      const clinicList = await kv.get(KV_MEDICINES_KEY, "json");
      const clinicArr = Array.isArray(clinicList) ? clinicList : [];
      const clinicMap = /* @__PURE__ */ new Map();
      clinicArr.forEach((m) => {
        const key = (m.id !== void 0 ? "id:" + m.id : "") + "|name:" + (m.name || "");
        clinicMap.set(key, !!m.priority_use);
      });
      const synced = platformList.map((m) => {
        const key = (m.id !== void 0 ? "id:" + m.id : "") + "|name:" + (m.name || "");
        const preserved = clinicMap.has(key) ? clinicMap.get(key) : !!m.priority_use;
        return { ...m, priority_use: preserved };
      });
      await kv.put(KV_MEDICINES_KEY, JSON.stringify(synced));
      return corsResponse({
        success: true,
        message: "\u5DF2\u4ECE\u5E73\u53F0\u515C\u5E95\u5E93\u540C\u6B65\u81F3\u672C\u8BCA\u6240",
        data: synced,
        count: synced.length
      });
    }
    if (method === "GET") {
      if (currentUser.isPlatformAdmin) {
        const list = await getPlatformMedicines(kv);
        return corsResponse({ success: true, data: list, count: list.length, scope: "platform" });
      }
      if (!currentUser.clinicId) {
        return corsResponse({ success: false, error: "\u672A\u7ED1\u5B9A\u8BCA\u6240" }, { status: 403 });
      }
      const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, "medicines");
      let medicines = await kv.get(KV_MEDICINES_KEY, "json");
      if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
        medicines = await getPlatformMedicines(kv);
        await kv.put(KV_MEDICINES_KEY, JSON.stringify(medicines));
      }
      return corsResponse({ success: true, data: medicines, count: medicines.length, scope: "clinic" });
    }
    if (method === "POST" || method === "PUT") {
      if (!currentUser.isPlatformAdmin && !currentUser.isClinicAdmin) {
        return corsResponse({ success: false, error: "\u6743\u9650\u4E0D\u8DB3\uFF0C\u4EC5\u7BA1\u7406\u5458\u53EF\u7BA1\u7406\u836F\u54C1\u5E93" }, { status: 403 });
      }
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return corsResponse({ success: false, error: "\u8BF7\u6C42\u6570\u636E\u683C\u5F0F\u9519\u8BEF" }, { status: 400 });
      }
      if (!body.medicines || !Array.isArray(body.medicines)) {
        return corsResponse({ success: false, error: "\u65E0\u6548\u7684\u836F\u54C1\u6570\u636E" }, { status: 400 });
      }
      const normalized = normalizeMedicines(body.medicines);
      if (currentUser.isPlatformAdmin) {
        await kv.put(KV_PLATFORM_MEDICINES, JSON.stringify(normalized));
        return corsResponse({
          success: true,
          message: "\u5E73\u53F0\u515C\u5E95\u836F\u6750\u5E93\u4FDD\u5B58\u6210\u529F",
          count: normalized.length,
          scope: "platform"
        });
      }
      const KV_MEDICINES_KEY = clinicKey(currentUser.clinicId, "medicines");
      await kv.put(KV_MEDICINES_KEY, JSON.stringify(normalized));
      return corsResponse({
        success: true,
        message: "\u836F\u54C1\u5E93\u4FDD\u5B58\u6210\u529F",
        count: normalized.length,
        clinicId: currentUser.clinicId,
        scope: "clinic"
      });
    }
    return corsResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Medicines API error:", error);
    return corsResponse({
      success: false,
      error: "Internal server error"
    }, { status: 500 });
  }
}
__name(onRequest4, "onRequest");

// api/platform-prescriptions.js
function decoratePrescription(p, clinicName, clinicId) {
  return {
    id: p.id,
    cloudSeq: p.cloudSeq || p.prescriptionNo || "",
    patientName: p.patientName || p.name || "",
    gender: p.gender || "",
    age: p.age || "",
    diagnosis: p.diagnosis || "",
    doctorName: p.doctorName || p.createdBy || "",
    createdBy: p.createdBy || "",
    date: p.date || p.createdAt || "",
    medicines: p.medicines || [],
    medicineText: p.medicineText || "",
    dosage: p.dosage || "",
    usage: p.usage || "",
    fee: p.fee || p.totalFee || "",
    clinicName,
    clinicId,
    raw: p
  };
}
__name(decoratePrescription, "decoratePrescription");
function containsMedicine(p, medicineName) {
  if (!medicineName) return true;
  if (Array.isArray(p.medicines)) {
    return p.medicines.some(
      (m) => (m.name || "").includes(medicineName) || (m.pinyin || "").includes(medicineName.toLowerCase())
    );
  }
  if (p.medicineText) return p.medicineText.includes(medicineName);
  return false;
}
__name(containsMedicine, "containsMedicine");
async function onRequest5(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  if (method === "OPTIONS") return handleOptions(request);
  try {
    const kv = getKV(env);
    if (!kv) {
      return corsResponse({ success: false, error: "KV\u5B58\u50A8\u672A\u914D\u7F6E" }, { status: 500 });
    }
    const currentUser = parseAuthHeader(request);
    if (!currentUser || !currentUser.isPlatformAdmin) {
      return corsResponse({ success: false, error: "\u4EC5\u5E73\u53F0\u603B\u7BA1\u7406\u5458\u53EF\u8BBF\u95EE" }, { status: 403 });
    }
    const clinicsRaw = await kv.get("system:clinics", "json");
    const clinics = Array.isArray(clinicsRaw) ? clinicsRaw : [];
    const clinicMap = {};
    for (const c of clinics) {
      clinicMap[c.id] = c;
    }
    const filterClinic = url.searchParams.get("clinic") || "";
    const filterDoctor = url.searchParams.get("doctor") || "";
    const filterPatient = url.searchParams.get("patient") || "";
    const filterMedicine = url.searchParams.get("medicine") || "";
    const filterStartDate = url.searchParams.get("startDate") || "";
    const filterEndDate = url.searchParams.get("endDate") || "";
    const filterKeyword = url.searchParams.get("keyword") || "";
    const allPrescriptions = [];
    const targetClinics = filterClinic ? clinics.filter((c) => c.id === filterClinic) : clinics;
    const clinicResults = await Promise.all(
      targetClinics.map(async (clinic) => {
        try {
          const key = clinicKey(clinic.id, "prescriptions");
          let prescriptions = await kv.get(key, "json");
          if (!prescriptions || !Array.isArray(prescriptions)) return [];
          const collected = [];
          for (const p of prescriptions) {
            if (p.deleted) continue;
            const decorated = decoratePrescription(p, clinic.name, clinic.id);
            if (filterDoctor) {
              const dName = (decorated.doctorName || "").toLowerCase();
              const dBy = (decorated.createdBy || "").toLowerCase();
              if (!dName.includes(filterDoctor.toLowerCase()) && !dBy.includes(filterDoctor.toLowerCase())) continue;
            }
            if (filterPatient) {
              if (!(decorated.patientName || "").includes(filterPatient)) continue;
            }
            if (filterMedicine) {
              if (!containsMedicine(decorated, filterMedicine)) continue;
            }
            if (filterStartDate || filterEndDate) {
              const pDate = (decorated.date || "").slice(0, 10);
              if (filterStartDate && pDate < filterStartDate) continue;
              if (filterEndDate && pDate > filterEndDate) continue;
            }
            if (filterKeyword) {
              const kw = filterKeyword.toLowerCase();
              const haystack = [
                decorated.patientName,
                decorated.diagnosis,
                decorated.doctorName,
                decorated.clinicName,
                decorated.medicineText,
                JSON.stringify(decorated.medicines || [])
              ].join(" ").toLowerCase();
              if (!haystack.includes(kw)) continue;
            }
            collected.push(decorated);
          }
          return collected;
        } catch (e) {
          console.error(`\u8BFB\u53D6\u8BCA\u6240 ${clinic.id} \u5904\u65B9\u5931\u8D25:`, e);
          return [];
        }
      })
    );
    for (const list of clinicResults) allPrescriptions.push(...list);
    allPrescriptions.sort((a, b) => {
      const tA = new Date(a.date || a.id || 0).getTime();
      const tB = new Date(b.date || b.id || 0).getTime();
      return tB - tA;
    });
    const now = getBeijingTime();
    const todayStr = now.toISOString().slice(0, 10);
    const monthStr = todayStr.slice(0, 7);
    const clinicStats = {};
    const doctorStats = {};
    let todayCount = 0, monthCount = 0;
    for (const p of allPrescriptions) {
      const pDate = (p.date || "").slice(0, 10);
      const clinicKey2 = p.clinicName || "\u672A\u77E5\u8BCA\u6240";
      const doctorKey = p.doctorName || p.createdBy || "\u672A\u77E5";
      if (!clinicStats[clinicKey2]) clinicStats[clinicKey2] = { count: 0, todayCount: 0, monthCount: 0 };
      clinicStats[clinicKey2].count++;
      if (!doctorStats[doctorKey]) doctorStats[doctorKey] = { count: 0, clinic: p.clinicName || "" };
      doctorStats[doctorKey].count++;
      if (pDate === todayStr) {
        todayCount++;
        clinicStats[clinicKey2].todayCount++;
      }
      if (pDate.startsWith(monthStr)) {
        monthCount++;
        clinicStats[clinicKey2].monthCount++;
      }
    }
    const MAX_RETURN = 2e3;
    const truncated = allPrescriptions.length > MAX_RETURN;
    const returnedData = truncated ? allPrescriptions.slice(0, MAX_RETURN) : allPrescriptions;
    return corsResponse({
      success: true,
      data: returnedData,
      totalCount: allPrescriptions.length,
      truncated,
      stats: {
        total: allPrescriptions.length,
        todayCount,
        monthCount,
        clinicCount: clinics.length,
        doctorCount: Object.keys(doctorStats).length,
        clinicStats: Object.entries(clinicStats).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.count - a.count),
        doctorStats: Object.entries(doctorStats).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.count - a.count)
      },
      clinics: clinics.map((c) => ({ id: c.id, name: c.name }))
    });
  } catch (e) {
    console.error("\u5E73\u53F0\u5904\u65B9\u76D1\u7BA1 API \u5F02\u5E38:", e);
    return corsResponse({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
__name(onRequest5, "onRequest");

// api/prescriptions.js
function cleanHistoricalPrescriptionNo(prescription, index, dateGroups) {
  if (prescription.cloudSeq && /^\d{6,8}$/.test(prescription.cloudSeq)) {
    return prescription.cloudSeq;
  }
  let no = prescription.outpatientNo || prescription.prescriptionNo || "";
  if (/^\d{6,8}$/.test(no)) return no;
  if (no.startsWith("LOCAL-")) return no;
  let timestamp = null;
  if (/^\d{10}$/.test(no)) timestamp = parseInt(no) * 1e3;
  else if (/^\d{13}$/.test(no)) timestamp = parseInt(no);
  else if (prescription.id && /^\d{10,13}$/.test(prescription.id.toString())) {
    const idStr = prescription.id.toString();
    timestamp = idStr.length === 10 ? parseInt(idStr) * 1e3 : parseInt(idStr);
  } else if (prescription.createdAt) {
    timestamp = new Date(prescription.createdAt).getTime();
  }
  if (timestamp) {
    const date = new Date(timestamp);
    const beijingDate = new Date(date.getTime() + 8 * 60 * 60 * 1e3);
    const yymmdd2 = formatBeijingDateYYMMDD(beijingDate);
    if (!dateGroups[yymmdd2]) dateGroups[yymmdd2] = 0;
    dateGroups[yymmdd2]++;
    return yymmdd2 + String(dateGroups[yymmdd2]).padStart(2, "0");
  }
  const now = getBeijingTime();
  const yymmdd = formatBeijingDateYYMMDD(now);
  if (!dateGroups[yymmdd]) dateGroups[yymmdd] = 0;
  dateGroups[yymmdd]++;
  return yymmdd + String(dateGroups[yymmdd]).padStart(2, "0");
}
__name(cleanHistoricalPrescriptionNo, "cleanHistoricalPrescriptionNo");
async function generateClinicGlobalSeq(kv, clinicId) {
  const now = getBeijingTime();
  const yymmdd = formatBeijingDateYYMMDD(now);
  const seqKey = clinicKey(clinicId, `prescription_seq:${yymmdd}`);
  const stored = await kv.get(seqKey);
  let seq = stored ? parseInt(stored, 10) : 0;
  seq += 1;
  await kv.put(seqKey, seq.toString());
  return yymmdd + String(seq).padStart(2, "0");
}
__name(generateClinicGlobalSeq, "generateClinicGlobalSeq");
async function peekNextClinicGlobalSeq(kv, clinicId) {
  const now = getBeijingTime();
  const yymmdd = formatBeijingDateYYMMDD(now);
  const seqKey = clinicKey(clinicId, `prescription_seq:${yymmdd}`);
  const stored = await kv.get(seqKey);
  let seq = stored ? parseInt(stored, 10) : 0;
  seq += 1;
  return yymmdd + String(seq).padStart(2, "0");
}
__name(peekNextClinicGlobalSeq, "peekNextClinicGlobalSeq");
async function getPrescriptionHashes(kv, clinicId) {
  const key = clinicKey(clinicId, "prescription_hashes");
  const stored = await kv.get(key, "json");
  return stored && typeof stored === "object" ? stored : {};
}
__name(getPrescriptionHashes, "getPrescriptionHashes");
async function savePrescriptionHash(kv, clinicId, hash, prescriptionId) {
  const key = clinicKey(clinicId, "prescription_hashes");
  const hashes = await getPrescriptionHashes(kv, clinicId);
  hashes[hash] = prescriptionId;
  await kv.put(key, JSON.stringify(hashes));
}
__name(savePrescriptionHash, "savePrescriptionHash");
async function onRequest6(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  if (method === "OPTIONS") return handleOptions(request);
  try {
    const kv = getKV(env);
    if (!kv) {
      return corsResponse({
        success: false,
        error: "KV\u5B58\u50A8\u672A\u914D\u7F6E\u3002\u8BF7\u5728Cloudflare Pages\u8BBE\u7F6E\u4E2D\u914D\u7F6EKV binding",
        requireSetup: true
      }, { status: 500 });
    }
    const currentUser = parseAuthHeader(request);
    if (currentUser && currentUser.isPlatformAdmin) {
      return corsResponse({ success: false, error: "\u5E73\u53F0\u603B\u7BA1\u7406\u5458\u4E0D\u53C2\u4E0E\u5904\u65B9\u4E1A\u52A1" }, { status: 403 });
    }
    if (!currentUser || !currentUser.clinicId) {
      return corsResponse({
        success: false,
        error: "\u672A\u6388\u6743\u8BBF\u95EE\uFF0C\u8BF7\u5148\u767B\u5F55",
        requireAuth: true
      }, { status: 401 });
    }
    const clinicId = currentUser.clinicId;
    const KV_PRESCRIPTIONS_KEY = clinicKey(clinicId, "prescriptions");
    const KV_TRASH_KEY = clinicKey(clinicId, "prescriptions_trash");
    const NO_CLEANED_KEY = clinicKey(clinicId, "prescription_no_cleaned_v4");
    if (method === "GET") {
      if (url.pathname.includes("/current-prescription-no") || url.pathname.includes("/next-prescription-no")) {
        const type = url.searchParams.get("type") || "daily";
        const now2 = /* @__PURE__ */ new Date();
        const year2 = String(now2.getFullYear()).slice(-2);
        const month = String(now2.getMonth() + 1).padStart(2, "0");
        const day = String(now2.getDate()).padStart(2, "0");
        let prescriptionNo;
        if (type === "yearly") prescriptionNo = year2 + "000001";
        else prescriptionNo = year2 + month + day + "01";
        return corsResponse({ success: true, prescriptionNo, message: "Using fallback number (old API)" });
      }
      if (url.searchParams.get("stats") === "true") {
        if (!currentUser.isClinicAdmin && !currentUser.isPlatformAdmin) {
          return corsResponse({ success: false, error: "\u4EC5\u7BA1\u7406\u5458\u53EF\u67E5\u770B\u7EDF\u8BA1" }, { status: 403 });
        }
        let prescriptions2 = await kv.get(KV_PRESCRIPTIONS_KEY, "json");
        if (!prescriptions2) prescriptions2 = [];
        prescriptions2.sort((a, b) => {
          const noA = a.cloudSeq || a.prescriptionNo || "";
          const noB = b.cloudSeq || b.prescriptionNo || "";
          return noB.localeCompare(noA);
        });
        const now2 = getBeijingTime();
        const todayStr = now2.toISOString().slice(0, 10);
        const monthStr = todayStr.slice(0, 7);
        const doctorStats = {};
        let todayCount = 0, monthCount = 0;
        for (const p of prescriptions2) {
          const pDate = (p.date || p.createdAt || "").slice(0, 10);
          const doctor = p.createdBy || p.doctorName || "\u672A\u77E5";
          if (!doctorStats[doctor]) doctorStats[doctor] = { count: 0, todayCount: 0, monthCount: 0 };
          doctorStats[doctor].count++;
          if (pDate === todayStr) {
            todayCount++;
            doctorStats[doctor].todayCount++;
          }
          if (pDate.startsWith(monthStr)) {
            monthCount++;
            doctorStats[doctor].monthCount++;
          }
        }
        return corsResponse({
          success: true,
          stats: {
            total: prescriptions2.length,
            todayCount,
            monthCount,
            doctorStats: Object.entries(doctorStats).map(([doctor, s]) => ({ doctor, ...s }))
          }
        });
      }
      if (url.searchParams.get("trash") === "true") {
        let trash = await kv.get(KV_TRASH_KEY, "json");
        if (!trash || !Array.isArray(trash)) trash = [];
        let filteredTrash = trash;
        if (currentUser.isDoctor) {
          filteredTrash = trash.filter((p) => p.createdBy === currentUser.username);
        }
        filteredTrash.sort((a, b) => new Date(b.deletedAt || 0).getTime() - new Date(a.deletedAt || 0).getTime());
        return corsResponse({
          success: true,
          data: filteredTrash,
          count: filteredTrash.length,
          userRole: currentUser.role,
          isAdmin: currentUser.isAdmin,
          currentUsername: currentUser.username
        });
      }
      let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, "json");
      if (!prescriptions) prescriptions = [];
      const migrateKey = clinicKey(clinicId, "prescription_migrated_v3");
      const migrated = await kv.get(migrateKey);
      if (!migrated) {
        const needMigrate = prescriptions.filter((p) => {
          if (!p.cloudSeq) return true;
          if (/^\d{6}$/.test(p.cloudSeq)) return true;
          if (/^\d{9}$/.test(p.cloudSeq)) return true;
          if (/^\d{8}$/.test(p.cloudSeq)) return false;
          return true;
        });
        if (needMigrate.length > 0) {
          needMigrate.sort((a, b) => {
            const tA = new Date(a.createdAt || a.date || a.id || 0).getTime();
            const tB = new Date(b.createdAt || b.date || b.id || 0).getTime();
            return tA - tB;
          });
          const dailyCounters = {};
          for (const p of needMigrate) {
            const pDate = new Date(p.createdAt || p.date || p.id || 0);
            const beijingDate = new Date(pDate.getTime() + 8 * 60 * 60 * 1e3);
            const yymmdd = beijingDate.getUTCFullYear().toString().slice(-2) + String(beijingDate.getUTCMonth() + 1).padStart(2, "0") + String(beijingDate.getUTCDate()).padStart(2, "0");
            if (!dailyCounters[yymmdd]) dailyCounters[yymmdd] = 0;
            dailyCounters[yymmdd]++;
            const seq = yymmdd + String(dailyCounters[yymmdd]).padStart(2, "0");
            p.cloudSeq = seq;
            p.prescriptionNo = seq;
            p.outpatientNo = seq;
            const seqKey = clinicKey(clinicId, `prescription_seq:${yymmdd}`);
            const existing = await kv.get(seqKey);
            const existingSeq = existing ? parseInt(existing, 10) : 0;
            if (dailyCounters[yymmdd] > existingSeq) {
              await kv.put(seqKey, dailyCounters[yymmdd].toString());
            }
            const idx = prescriptions.findIndex((x) => x.id === p.id);
            if (idx >= 0) prescriptions[idx] = p;
          }
          await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
        }
        await kv.put(migrateKey, "1");
      }
      let filteredPrescriptions = prescriptions;
      if (currentUser.isDoctor) {
        filteredPrescriptions = prescriptions.filter((p) => p.createdBy === currentUser.username);
      }
      const noCleaned = await kv.get(NO_CLEANED_KEY);
      if (!noCleaned) {
        const sortedForSeq = [...filteredPrescriptions].sort((a, b) => {
          const idA = typeof a.id === "number" ? a.id : 0;
          const idB = typeof b.id === "number" ? b.id : 0;
          return idA - idB;
        });
        const dateCounter = {};
        let needsUpdate = false;
        filteredPrescriptions = sortedForSeq.map((p, index) => {
          const cleanNo = cleanHistoricalPrescriptionNo(p, index, dateCounter);
          const currentNo = p.outpatientNo || p.prescriptionNo || "";
          if (cleanNo !== currentNo) {
            needsUpdate = true;
            return { ...p, prescriptionNo: cleanNo, outpatientNo: cleanNo };
          }
          return p;
        });
        if (needsUpdate) {
          const updatedPrescriptions = [...prescriptions];
          filteredPrescriptions.forEach((p) => {
            const index = updatedPrescriptions.findIndex((item) => item.id === p.id);
            if (index !== -1) updatedPrescriptions[index] = p;
          });
          await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(updatedPrescriptions));
        }
        await kv.put(NO_CLEANED_KEY, "1");
      }
      filteredPrescriptions.sort((a, b) => {
        const noA = a.outpatientNo || a.prescriptionNo || "";
        const noB = b.outpatientNo || b.prescriptionNo || "";
        return noB.localeCompare(noA);
      });
      const now = getBeijingTime();
      const year = now.getUTCFullYear().toString().substring(2);
      const formattedTotalCount = year + prescriptions.length.toString().padStart(6, "0");
      return corsResponse({
        success: true,
        data: filteredPrescriptions,
        count: filteredPrescriptions.length,
        totalCount: formattedTotalCount,
        userRole: currentUser.role,
        isAdmin: currentUser.isAdmin,
        currentUsername: currentUser.username,
        clinicId,
        // 加固9：单 KV key 体积监控，超阈值返回性能警告（25MB 上限约 25000 张，1 万张起预警）
        performanceWarning: prescriptions.length > 1e4 ? `\u5F53\u524D\u8BCA\u6240\u5904\u65B9\u603B\u91CF ${prescriptions.length} \u6761\uFF0C\u5EFA\u8BAE\u8054\u7CFB\u5E73\u53F0\u7BA1\u7406\u5458\u5F52\u6863\u5386\u53F2\u6570\u636E\u4EE5\u7EF4\u6301\u6027\u80FD` : null,
        debug: {
          totalInKV: prescriptions.length,
          filteredCount: filteredPrescriptions.length
        }
      });
    }
    if (method === "POST" && url.searchParams.get("restore") !== "true") {
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return corsResponse({ success: false, error: "Failed to parse request body: " + error.message }, { status: 400 });
      }
      if (!body.prescription) {
        return corsResponse({ success: false, error: "Missing prescription data" }, { status: 400 });
      }
      let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, "json");
      if (!prescriptions) prescriptions = [];
      const now = getBeijingTime();
      const nowIso = now.toISOString();
      const prescriptionList = Array.isArray(body.prescription) ? body.prescription : [body.prescription];
      const savedPrescriptions = [];
      for (const p of prescriptionList) {
        let createdBy = currentUser.username;
        if (currentUser.isClinicAdmin && p.createdBy) {
          createdBy = p.createdBy;
        }
        const hash = p.prescriptionHash || "";
        if (hash) {
          const hashes = await getPrescriptionHashes(kv, clinicId);
          if (hashes[hash]) {
            const existing = prescriptions.find((x) => x.id.toString() === hashes[hash].toString());
            if (existing) {
              savedPrescriptions.push(existing);
              continue;
            }
          }
        }
        const globalSeq = await generateClinicGlobalSeq(kv, clinicId);
        const newId = p.id || Date.now();
        const newPrescription = {
          ...p,
          id: newId,
          prescriptionNo: globalSeq,
          outpatientNo: globalSeq,
          cloudSeq: globalSeq,
          createdAt: p.createdAt || nowIso,
          updatedAt: nowIso,
          createdBy,
          userId: createdBy,
          userRole: currentUser.role,
          clinicId
        };
        if (hash) {
          await savePrescriptionHash(kv, clinicId, hash, newId);
        }
        savedPrescriptions.push(newPrescription);
      }
      const idMap = /* @__PURE__ */ new Map();
      [...prescriptions, ...savedPrescriptions].forEach((p) => idMap.set(p.id, p));
      prescriptions = Array.from(idMap.values());
      prescriptions.sort((a, b) => {
        const noA = a.outpatientNo || a.prescriptionNo || "";
        const noB = b.outpatientNo || b.prescriptionNo || "";
        return noB.localeCompare(noA);
      });
      const nextPrescriptionNo = await peekNextClinicGlobalSeq(kv, clinicId);
      const nextClinicNo = nextPrescriptionNo;
      await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
      await kv.delete(NO_CLEANED_KEY);
      return corsResponse({
        success: true,
        data: prescriptions,
        savedPrescription: savedPrescriptions[0],
        count: prescriptions.length,
        message: "Prescriptions saved successfully",
        nextPrescriptionNo,
        nextClinicNo,
        userRole: currentUser.role,
        isAdmin: currentUser.isAdmin,
        clinicId
      });
    }
    if (method === "DELETE") {
      const prescriptionId = url.searchParams.get("id");
      const isPermanent = url.searchParams.get("permanent") === "true";
      if (!prescriptionId) {
        return corsResponse({ success: false, error: "Missing prescription ID" }, { status: 400 });
      }
      if (isPermanent) {
        let trash2 = await kv.get(KV_TRASH_KEY, "json");
        if (!trash2 || !Array.isArray(trash2)) trash2 = [];
        const prescriptionToDelete2 = trash2.find((p) => p.id.toString() === prescriptionId.toString());
        if (!prescriptionToDelete2) {
          return corsResponse({ success: false, error: "\u56DE\u6536\u7AD9\u4E2D\u672A\u627E\u5230\u6B64\u5904\u65B9" }, { status: 404 });
        }
        if (prescriptionToDelete2.createdBy !== currentUser.username && !currentUser.isAdmin) {
          return corsResponse({ success: false, error: "\u65E0\u6743\u5220\u9664\u6B64\u5904\u65B9" }, { status: 403 });
        }
        trash2 = trash2.filter((p) => p.id.toString() !== prescriptionId.toString());
        await kv.put(KV_TRASH_KEY, JSON.stringify(trash2));
        return corsResponse({ success: true, message: "\u5904\u65B9\u5DF2\u6C38\u4E45\u5220\u9664", deletedBy: currentUser.username });
      }
      let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, "json");
      if (!prescriptions) prescriptions = [];
      const prescriptionToDelete = prescriptions.find((p) => p.id.toString() === prescriptionId.toString());
      if (!prescriptionToDelete) {
        return corsResponse({ success: false, error: "Prescription not found" }, { status: 404 });
      }
      if (prescriptionToDelete.createdBy !== currentUser.username && !currentUser.isAdmin) {
        return corsResponse({ success: false, error: "\u65E0\u6743\u5220\u9664\u6B64\u5904\u65B9" }, { status: 403 });
      }
      prescriptions = prescriptions.filter((p) => p.id.toString() !== prescriptionId.toString());
      await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
      let trash = await kv.get(KV_TRASH_KEY, "json");
      if (!trash || !Array.isArray(trash)) trash = [];
      const nowIso = getBeijingTime().toISOString();
      trash.unshift({ ...prescriptionToDelete, deletedAt: nowIso, deletedBy: currentUser.username });
      const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1e3;
      const nowMs = Date.now();
      trash = trash.filter((item) => {
        const deletedMs = new Date(item.deletedAt || 0).getTime();
        return nowMs - deletedMs < SIX_MONTHS_MS;
      });
      if (trash.length > 5e3) trash = trash.slice(0, 5e3);
      await kv.put(KV_TRASH_KEY, JSON.stringify(trash));
      return corsResponse({
        success: true,
        message: "\u5904\u65B9\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u53EF\u6062\u590D",
        deletedBy: currentUser.username,
        softDeleted: true
      });
    }
    if (method === "POST" && url.searchParams.get("restore") === "true") {
      const prescriptionId = url.searchParams.get("id");
      if (!prescriptionId) {
        return corsResponse({ success: false, error: "Missing prescription ID" }, { status: 400 });
      }
      let trash = await kv.get(KV_TRASH_KEY, "json");
      if (!trash || !Array.isArray(trash)) trash = [];
      const prescriptionToRestore = trash.find((p) => p.id.toString() === prescriptionId.toString());
      if (!prescriptionToRestore) {
        return corsResponse({ success: false, error: "\u56DE\u6536\u7AD9\u4E2D\u672A\u627E\u5230\u6B64\u5904\u65B9" }, { status: 404 });
      }
      if (prescriptionToRestore.createdBy !== currentUser.username && !currentUser.isAdmin) {
        return corsResponse({ success: false, error: "\u65E0\u6743\u6062\u590D\u6B64\u5904\u65B9" }, { status: 403 });
      }
      trash = trash.filter((p) => p.id.toString() !== prescriptionId.toString());
      await kv.put(KV_TRASH_KEY, JSON.stringify(trash));
      let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, "json");
      if (!prescriptions) prescriptions = [];
      const { deletedAt, deletedBy, ...restoredPrescription } = prescriptionToRestore;
      const exists = prescriptions.some((p) => p.id.toString() === prescriptionId.toString());
      if (!exists) prescriptions.push(restoredPrescription);
      await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
      await kv.delete(NO_CLEANED_KEY);
      return corsResponse({
        success: true,
        message: "\u5904\u65B9\u5DF2\u6062\u590D",
        restoredBy: currentUser.username,
        data: restoredPrescription
      });
    }
    return corsResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Prescriptions API error:", error);
    return corsResponse({
      success: false,
      error: error.message || "Internal server error"
    }, { status: 500 });
  }
}
__name(onRequest6, "onRequest");

// api/restore-kv.js
async function onRequest7(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return handleOptions(request);
  const expectedSecret = env.BACKUP_SECRET;
  if (!expectedSecret) {
    return corsResponse({
      success: false,
      error: "\u6062\u590D\u529F\u80FD\u672A\u914D\u7F6E\uFF1A\u8BF7\u5728 Cloudflare Pages \u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF BACKUP_SECRET"
    }, { status: 503 });
  }
  const authHeader = request.headers.get("Authorization") || "";
  const providedSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (providedSecret !== expectedSecret) {
    return corsResponse({
      success: false,
      error: "Unauthorized: Invalid secret key"
    }, { status: 401 });
  }
  const backupKey = url.searchParams.get("backupKey");
  if (!backupKey) {
    return corsResponse({
      success: false,
      error: "Missing backupKey parameter"
    }, { status: 400 });
  }
  try {
    const kv = getKV(env);
    if (!kv) {
      return corsResponse({
        success: false,
        error: "KV\u5B58\u50A8\u672A\u914D\u7F6E"
      }, { status: 500 });
    }
    const backupData = await kv.get(backupKey, "json");
    if (!backupData) {
      return corsResponse({
        success: false,
        error: "Backup not found or expired"
      }, { status: 404 });
    }
    if (!backupData.keys || typeof backupData.keys !== "object") {
      return corsResponse({
        success: false,
        error: "Invalid backup data format"
      }, { status: 400 });
    }
    let restoredCount = 0;
    const errors = [];
    for (const [key, value] of Object.entries(backupData.keys)) {
      try {
        await kv.put(key, JSON.stringify(value));
        restoredCount++;
      } catch (error) {
        errors.push({ key, error: "restore_failed" });
      }
    }
    return corsResponse({
      success: true,
      message: "KV data restore completed",
      backupKey,
      backupTimestamp: backupData.timestamp,
      restoredCount,
      errorCount: errors.length,
      errors: errors.length > 0 ? errors : void 0
    });
  } catch (error) {
    console.error("Restore error:", error);
    return corsResponse({
      success: false,
      error: "Restore failed"
    }, { status: 500 });
  }
}
__name(onRequest7, "onRequest");

// api/users.js
async function loadClinics(kv) {
  const list = await kv.get(KV_NS.CLINICS, "json");
  return Array.isArray(list) ? list : [];
}
__name(loadClinics, "loadClinics");
async function saveClinics(kv, list) {
  await kv.put(KV_NS.CLINICS, JSON.stringify(list));
}
__name(saveClinics, "saveClinics");
async function loadClinicUsers(kv, clinicId) {
  const list = await kv.get(clinicKey(clinicId, "users"), "json");
  return Array.isArray(list) ? list : [];
}
__name(loadClinicUsers, "loadClinicUsers");
async function saveClinicUsers(kv, clinicId, users) {
  await kv.put(clinicKey(clinicId, "users"), JSON.stringify(users));
}
__name(saveClinicUsers, "saveClinicUsers");
async function loadPlatformAdmins(kv) {
  const list = await kv.get(KV_NS.PLATFORM_ADMINS, "json");
  return Array.isArray(list) ? list : [];
}
__name(loadPlatformAdmins, "loadPlatformAdmins");
function sanitizeUser(u) {
  if (!u) return null;
  const { passwordHash, salt, ...rest } = u;
  return rest;
}
__name(sanitizeUser, "sanitizeUser");
async function findUserAcrossClinics(kv, username) {
  const admins = await loadPlatformAdmins(kv);
  const pa = admins.find((u) => u.username === username);
  if (pa) {
    return {
      ...pa,
      role: ROLE.PLATFORM_ADMIN,
      clinicId: null,
      _source: "platform_admins"
    };
  }
  const clinics = await loadClinics(kv);
  for (const c of clinics) {
    if (c.status === "disabled") continue;
    const users = await loadClinicUsers(kv, c.id);
    const u = users.find((x) => x.username === username);
    if (u) {
      return {
        ...u,
        clinicId: c.id,
        clinicName: c.name,
        _source: "clinic:" + c.id
      };
    }
  }
  return null;
}
__name(findUserAcrossClinics, "findUserAcrossClinics");
async function onRequest8(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  if (method === "OPTIONS") return handleOptions(request);
  try {
    const kv = getKV(env);
    if (!kv) {
      return corsResponse({
        success: false,
        error: "KV binding not found. \u8BF7\u5728 Cloudflare Pages \u8BBE\u7F6E\u4E2D\u914D\u7F6E KV binding\u3002",
        requireSetup: true
      }, { status: 500 });
    }
    if (method === "POST" && url.searchParams.get("login") === "true") {
      const body = await request.json();
      if (!body.username || !body.password) {
        return corsResponse({ success: false, error: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A" }, { status: 400 });
      }
      const user = await findUserAcrossClinics(kv, body.username);
      if (!user) {
        return corsResponse({ success: false, error: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF" }, { status: 401 });
      }
      if (!user.passwordHash || !user.salt) {
        return corsResponse({ success: false, error: "\u8D26\u53F7\u5BC6\u7801\u683C\u5F0F\u5F02\u5E38\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u91CD\u7F6E\u5BC6\u7801" }, { status: 401 });
      }
      const passwordOk = await verifyPassword(body.password, user.salt, user.passwordHash);
      if (!passwordOk) {
        return corsResponse({ success: false, error: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF" }, { status: 401 });
      }
      if (user.role !== ROLE.PLATFORM_ADMIN) {
        const clinics = await loadClinics(kv);
        const c = clinics.find((x) => x.id === user.clinicId);
        if (!c || c.status === "disabled") {
          return corsResponse({ success: false, error: "\u6240\u5C5E\u8BCA\u6240\u5DF2\u505C\u7528\uFF0C\u8BF7\u8054\u7CFB\u5E73\u53F0\u7BA1\u7406\u5458" }, { status: 403 });
        }
      }
      return corsResponse({
        success: true,
        user: sanitizeUser(user)
      });
    }
    if (method === "GET" && url.searchParams.get("clinics") === "true") {
      const currentUser = parseAuthHeader(request);
      if (!currentUser || !currentUser.isPlatformAdmin) {
        return corsResponse({ success: false, error: "\u4EC5\u5E73\u53F0\u603B\u7BA1\u7406\u5458\u53EF\u67E5\u770B\u8BCA\u6240\u5217\u8868" }, { status: 403 });
      }
      const clinics = await loadClinics(kv);
      const enriched = [];
      for (const c of clinics) {
        const users = await loadClinicUsers(kv, c.id);
        const admin = users.find((u) => u.role === ROLE.CLINIC_ADMIN);
        enriched.push({
          ...c,
          adminUsername: admin ? admin.username : null,
          adminName: admin ? admin.name : null,
          userCount: users.length,
          adminCount: users.filter((u) => u.role === ROLE.CLINIC_ADMIN).length,
          doctorCount: users.filter((u) => u.role === ROLE.DOCTOR).length
        });
      }
      return corsResponse({ success: true, data: enriched });
    }
    if (method === "POST" && url.searchParams.get("clinic")) {
      const currentUser = parseAuthHeader(request);
      if (!currentUser || !currentUser.isPlatformAdmin) {
        return corsResponse({ success: false, error: "\u4EC5\u5E73\u53F0\u603B\u7BA1\u7406\u5458\u53EF\u7BA1\u7406\u8BCA\u6240" }, { status: 403 });
      }
      const body = await request.json();
      const action = url.searchParams.get("clinic");
      if (action === "create") {
        if (!body.clinicName || !body.adminUsername || !body.adminPassword) {
          return corsResponse({ success: false, error: "\u7F3A\u5C11\u8BCA\u6240\u540D\u79F0/\u7BA1\u7406\u5458\u8D26\u53F7/\u7BA1\u7406\u5458\u5BC6\u7801" }, { status: 400 });
        }
        const clinics = await loadClinics(kv);
        const clinicId = "clinic_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const exists = await findUserAcrossClinics(kv, body.adminUsername);
        if (exists) {
          return corsResponse({ success: false, error: "\u7BA1\u7406\u5458\u7528\u6237\u540D\u5DF2\u88AB\u5360\u7528" }, { status: 400 });
        }
        clinics.push({
          id: clinicId,
          name: body.clinicName,
          status: "active",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        await saveClinics(kv, clinics);
        const salt = generateSalt();
        const passwordHash = await hashPassword(body.adminPassword, salt);
        const admin = {
          username: body.adminUsername,
          name: body.adminName || body.adminUsername,
          role: ROLE.CLINIC_ADMIN,
          passwordHash,
          salt,
          allowedMode: "both",
          cloudEnabled: true,
          allowSavePrescription: true,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await saveClinicUsers(kv, clinicId, [admin]);
        return corsResponse({
          success: true,
          message: "\u8BCA\u6240\u521B\u5EFA\u6210\u529F",
          clinic: { id: clinicId, name: body.clinicName },
          admin: sanitizeUser(admin)
        });
      }
      if (action === "update") {
        if (!body.clinicId) {
          return corsResponse({ success: false, error: "\u7F3A\u5C11 clinicId" }, { status: 400 });
        }
        const clinics = await loadClinics(kv);
        const idx = clinics.findIndex((c) => c.id === body.clinicId);
        if (idx === -1) {
          return corsResponse({ success: false, error: "\u8BCA\u6240\u4E0D\u5B58\u5728" }, { status: 404 });
        }
        if (currentUser.isClinicAdmin) {
          if (currentUser.clinicId !== body.clinicId) {
            return corsResponse({ success: false, error: "\u4EC5\u53EF\u4FEE\u6539\u672C\u8BCA\u6240\u540D\u79F0" }, { status: 403 });
          }
          if (body.status && body.status !== clinics[idx].status) {
            return corsResponse({ success: false, error: "\u8BCA\u6240\u72B6\u6001\u4EC5\u5E73\u53F0\u603B\u7BA1\u7406\u5458\u53EF\u4FEE\u6539" }, { status: 403 });
          }
        } else if (!currentUser.isPlatformAdmin) {
          return corsResponse({ success: false, error: "\u65E0\u6743\u4FEE\u6539\u8BCA\u6240" }, { status: 403 });
        }
        if (body.name) clinics[idx].name = body.name;
        if (body.status) clinics[idx].status = body.status;
        clinics[idx].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await saveClinics(kv, clinics);
        if (currentUser.isPlatformAdmin && (body.adminUsername || body.adminPassword || body.adminName)) {
          const users = await loadClinicUsers(kv, body.clinicId);
          const adminIdx = users.findIndex((u) => u.role === ROLE.CLINIC_ADMIN);
          if (adminIdx >= 0) {
            if (body.adminUsername && body.adminUsername !== users[adminIdx].username) {
              const exists = await findUserAcrossClinics(kv, body.adminUsername);
              if (exists) {
                return corsResponse({ success: false, error: "\u7BA1\u7406\u5458\u7528\u6237\u540D\u5DF2\u88AB\u5360\u7528" }, { status: 400 });
              }
              users[adminIdx].username = body.adminUsername;
            }
            if (body.adminName) {
              users[adminIdx].name = body.adminName;
            }
            if (body.adminPassword) {
              const salt = generateSalt();
              users[adminIdx].passwordHash = await hashPassword(body.adminPassword, salt);
              users[adminIdx].salt = salt;
            }
            users[adminIdx].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
            await saveClinicUsers(kv, body.clinicId, users);
          }
        }
        return corsResponse({ success: true, message: "\u8BCA\u6240\u66F4\u65B0\u6210\u529F", clinic: clinics[idx] });
      }
    }
    if (method === "GET") {
      const currentUser = parseAuthHeader(request);
      if (!currentUser) {
        return corsResponse({ success: false, error: "\u672A\u6388\u6743\u8BBF\u95EE" }, { status: 401 });
      }
      if (currentUser.isPlatformAdmin) {
        const clinics = await loadClinics(kv);
        const allUsers = [];
        for (const c of clinics) {
          const users2 = await loadClinicUsers(kv, c.id);
          users2.forEach((u) => allUsers.push({
            ...sanitizeUser(u),
            clinicId: c.id,
            clinicName: c.name
          }));
        }
        return corsResponse({ success: true, data: allUsers, count: allUsers.length });
      }
      if (currentUser.isClinicAdmin) {
        const users2 = await loadClinicUsers(kv, currentUser.clinicId);
        const clinics = await loadClinics(kv);
        const c = clinics.find((x) => x.id === currentUser.clinicId);
        const enriched = users2.map((u) => ({
          ...sanitizeUser(u),
          clinicId: currentUser.clinicId,
          clinicName: c ? c.name : ""
        }));
        return corsResponse({ success: true, data: enriched, count: enriched.length });
      }
      const users = await loadClinicUsers(kv, currentUser.clinicId);
      const self = users.find((u) => u.username === currentUser.username);
      return corsResponse({
        success: true,
        data: self ? [sanitizeUser({ ...self, clinicId: currentUser.clinicId })] : [],
        count: self ? 1 : 0
      });
    }
    if (method === "POST") {
      const currentUser = parseAuthHeader(request);
      if (!currentUser) {
        return corsResponse({ success: false, error: "\u672A\u6388\u6743\u8BBF\u95EE" }, { status: 401 });
      }
      const body = await request.json();
      if (!body.users || !Array.isArray(body.users)) {
        return corsResponse({ success: false, error: "Missing or invalid users data" }, { status: 400 });
      }
      if (currentUser.isDoctor) {
        const existing = await loadClinicUsers(kv, currentUser.clinicId);
        if (body.users.length !== existing.length) {
          return corsResponse({ success: false, error: "\u4EC5\u53EF\u4FEE\u6539\u81EA\u5DF1\u7684\u5BC6\u7801\uFF0C\u4E0D\u53EF\u589E\u5220\u7528\u6237" }, { status: 403 });
        }
        const keysEqualExcept = /* @__PURE__ */ __name((a, b, except) => {
          const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
          for (const k of keys) {
            if (except.includes(k)) continue;
            if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
          }
          return true;
        }, "keysEqualExcept");
        for (const bu of body.users) {
          const ku = existing.find((u) => u.username === bu.username);
          if (!ku) return corsResponse({ success: false, error: "\u7528\u6237\u5217\u8868\u4E0D\u53EF\u53D8\u66F4" }, { status: 403 });
          if (bu.username !== currentUser.username) {
            if (!keysEqualExcept(bu, ku, [])) {
              return corsResponse({ success: false, error: "\u4E0D\u53EF\u4FEE\u6539\u4ED6\u4EBA\u4FE1\u606F" }, { status: 403 });
            }
          } else {
            if (!keysEqualExcept(bu, ku, ["password"])) {
              return corsResponse({ success: false, error: "\u4EC5\u53EF\u4FEE\u6539\u5BC6\u7801\u5B57\u6BB5" }, { status: 403 });
            }
            if (bu.password && bu.password !== ku.password) {
              const salt = generateSalt();
              const passwordHash = await hashPassword(bu.password, salt);
              ku.passwordHash = passwordHash;
              ku.salt = salt;
              ku.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
            }
          }
        }
        await saveClinicUsers(kv, currentUser.clinicId, existing);
        return corsResponse({ success: true, message: "\u5BC6\u7801\u4FEE\u6539\u6210\u529F" });
      }
      if (currentUser.isClinicAdmin) {
        const existing = await loadClinicUsers(kv, currentUser.clinicId);
        const existingMap = new Map(existing.map((u) => [u.username, u]));
        const otherAdmins = existing.filter((u) => u.role === ROLE.CLINIC_ADMIN && u.username !== currentUser.username);
        if (otherAdmins.length > 0) {
        }
        const newUsers = [];
        for (const bu of body.users) {
          if (bu.username === currentUser.username) {
            const old = existingMap.get(bu.username);
            if (!old) {
              return corsResponse({ success: false, error: "\u5F53\u524D\u8D26\u53F7\u4E0D\u5B58\u5728" }, { status: 400 });
            }
            const updated = {
              ...old,
              name: bu.name || old.name,
              allowedMode: bu.allowedMode || old.allowedMode,
              cloudEnabled: bu.cloudEnabled !== void 0 ? bu.cloudEnabled : old.cloudEnabled,
              allowSavePrescription: bu.allowSavePrescription !== void 0 ? bu.allowSavePrescription : old.allowSavePrescription,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            };
            if (bu.password && bu.password !== old.password) {
              const salt2 = generateSalt();
              updated.passwordHash = await hashPassword(bu.password, salt2);
              updated.salt = salt2;
            }
            newUsers.push(updated);
            existingMap.delete(bu.username);
            continue;
          }
          if (existingMap.has(bu.username)) {
            const old = existingMap.get(bu.username);
            if (bu.role === ROLE.CLINIC_ADMIN && old.role !== ROLE.CLINIC_ADMIN) {
              return corsResponse({ success: false, error: "\u4E0D\u53EF\u5C06\u533B\u5E08\u63D0\u5347\u4E3A\u8BCA\u6240\u7BA1\u7406\u5458\uFF0C\u8BF7\u8054\u7CFB\u5E73\u53F0\u603B\u7BA1\u7406\u5458" }, { status: 403 });
            }
            const updated = {
              ...old,
              name: bu.name || old.name,
              role: old.role,
              // 不允许通过此接口改角色
              allowedMode: bu.allowedMode !== void 0 ? bu.allowedMode : old.allowedMode,
              cloudEnabled: bu.cloudEnabled !== void 0 ? bu.cloudEnabled : old.cloudEnabled,
              allowSavePrescription: bu.allowSavePrescription !== void 0 ? bu.allowSavePrescription : old.allowSavePrescription,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            };
            if (bu.password && bu.password !== old.password) {
              const salt2 = generateSalt();
              updated.passwordHash = await hashPassword(bu.password, salt2);
              updated.salt = salt2;
            }
            newUsers.push(updated);
            existingMap.delete(bu.username);
            continue;
          }
          if (!bu.username || !bu.password) {
            return corsResponse({ success: false, error: "\u65B0\u5EFA\u7528\u6237\u5FC5\u987B\u63D0\u4F9B username \u548C password" }, { status: 400 });
          }
          const exists = await findUserAcrossClinics(kv, bu.username);
          if (exists) {
            return corsResponse({ success: false, error: `\u7528\u6237\u540D ${bu.username} \u5DF2\u88AB\u5360\u7528` }, { status: 400 });
          }
          if (bu.role && bu.role !== ROLE.DOCTOR) {
            return corsResponse({ success: false, error: "\u8BCA\u6240\u7BA1\u7406\u5458\u4EC5\u53EF\u521B\u5EFA\u533B\u5E08\u8D26\u53F7" }, { status: 403 });
          }
          const salt = generateSalt();
          const passwordHash = await hashPassword(bu.password, salt);
          newUsers.push({
            username: bu.username,
            name: bu.name || bu.username,
            role: ROLE.DOCTOR,
            passwordHash,
            salt,
            allowedMode: bu.allowedMode || "local",
            cloudEnabled: bu.cloudEnabled !== void 0 ? bu.cloudEnabled : false,
            allowSavePrescription: bu.allowSavePrescription !== void 0 ? bu.allowSavePrescription : true,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        const deleted = Array.from(existingMap.values()).filter((u) => u.username !== currentUser.username);
        for (const d of deleted) {
          if (d.role === ROLE.CLINIC_ADMIN) {
            return corsResponse({ success: false, error: "\u4E0D\u53EF\u5220\u9664\u8BCA\u6240\u7BA1\u7406\u5458\u8D26\u53F7" }, { status: 403 });
          }
        }
        await saveClinicUsers(kv, currentUser.clinicId, newUsers);
        return corsResponse({
          success: true,
          message: "\u7528\u6237\u5217\u8868\u4FDD\u5B58\u6210\u529F",
          count: newUsers.length,
          data: newUsers.map(sanitizeUser)
        });
      }
      return corsResponse({ success: false, error: "\u5E73\u53F0\u7BA1\u7406\u5458\u8BF7\u4F7F\u7528 ?clinic=create \u521B\u5EFA\u8BCA\u6240" }, { status: 400 });
    }
    return corsResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Users API error:", error);
    return corsResponse({
      success: false,
      error: "Internal server error"
    }, { status: 500 });
  }
}
__name(onRequest8, "onRequest");

// ../.wrangler/tmp/pages-W20trV/functionsRoutes-0.00976238000491736.mjs
var routes = [
  {
    routePath: "/api/backup-kv",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/api/formulas",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/init",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  },
  {
    routePath: "/api/medicines",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest4]
  },
  {
    routePath: "/api/platform-prescriptions",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest5]
  },
  {
    routePath: "/api/prescriptions",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest6]
  },
  {
    routePath: "/api/restore-kv",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest7]
  },
  {
    routePath: "/api/users",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest8]
  }
];

// ../../../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../../AppData/Roaming/npm/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
