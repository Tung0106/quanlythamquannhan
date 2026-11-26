import qrcode from "qrcode-generator";

const RELATIONSHIP_OPTIONS = [
  "Bố đẻ",
  "Mẹ đẻ",
  "Vợ / Chồng",
  "Con",
  "Anh / Chị / Em ruột",
  "Ông / Bà",
  "Cô / Dì / Chú / Bác",
  "Người yêu / Bạn bè",
  "Khác",
];

const STATUS_LABELS = {
  pending: "Chờ vào cổng",
  checked_in: "Đã vào thăm",
  checked_out: "Đã ra về",
};

const NAME_REGEX = /^[\p{L}]+(?:[\s'.-][\p{L}]+)*$/u;
const SESSION_TTL_SEC = 12 * 3600;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SEC = 60;
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_WINDOW_SEC = 300;

let dbInitPromise = null;

function nowVnDate() {
  return new Date(Date.now() + 7 * 3600 * 1000);
}

function todayVnStr() {
  return nowVnDate().toISOString().slice(0, 10);
}

function nowVnStr() {
  return nowVnDate().toISOString().replace("T", " ").slice(0, 19);
}

function nowEpochSec() {
  return Math.floor(Date.now() / 1000);
}

function randomHex(byteCount = 16) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function pbkdf2Hex(password, saltHex, iterations = 100000) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const saltBytes = new Uint8Array(
    saltHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const saltHex = randomHex(16);
  const iterations = 100000;
  const hashHex = await pbkdf2Hex(password, saltHex, iterations);
  return `pbkdf2$${iterations}$${saltHex}$${hashHex}`;
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!iterations || !saltHex || !expectedHex) return false;
  const actualHex = await pbkdf2Hex(password, saltHex, iterations);
  return timingSafeEqual(actualHex, expectedHex);
}

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function getSecurityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    ...extra,
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: getSecurityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

function parseCookies(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const map = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  }
  return map;
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "unknown").split(",")[0].trim()
  );
}

async function ensureDb(env) {
  if (!env.DB) {
    throw new Error("Chưa gắn D1 Database binding tên DB trong Cloudflare Worker.");
  }
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const stmts = [
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'officer',
          password_hash TEXT NOT NULL,
          must_change_password INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS visitors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reg_code TEXT UNIQUE NOT NULL,
          full_name TEXT NOT NULL,
          date_of_birth TEXT NOT NULL,
          relationship TEXT NOT NULL,
          cccd TEXT NOT NULL,
          soldier_name TEXT NOT NULL,
          unit_name TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          visit_location TEXT NOT NULL DEFAULT '',
          visitor_count INTEGER NOT NULL DEFAULT 1,
          note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          visit_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          checked_by TEXT NOT NULL DEFAULT ''
        )`,
        `CREATE INDEX IF NOT EXISTS idx_visitors_visit_date ON visitors (visit_date)`,
        `CREATE INDEX IF NOT EXISTS idx_visitors_soldier ON visitors (soldier_name)`,
        `CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          csrf_token TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS login_attempts (
          ip TEXT NOT NULL,
          attempted_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip, attempted_at)`,
        `CREATE TABLE IF NOT EXISTS rate_limits (
          ip TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_rate_limits_ip ON rate_limits (ip, created_at)`,
        `CREATE TABLE IF NOT EXISTS soldiers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          name_norm TEXT NOT NULL,
          unit_name TEXT NOT NULL DEFAULT '',
          rank_title TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_soldiers_name_norm ON soldiers (name_norm)`,
      ];
      for (const sql of stmts) {
        await env.DB.prepare(sql).run();
      }

      // Safe column migrations for existing D1 databases
      try {
        await env.DB.prepare(
          "ALTER TABLE visitors ADD COLUMN visit_location TEXT NOT NULL DEFAULT ''"
        ).run();
      } catch {}
      try {
        await env.DB.prepare(
          "ALTER TABLE visitors ADD COLUMN visitor_count INTEGER NOT NULL DEFAULT 1"
        ).run();
      } catch {}

      const newDefaultUnit = "Bộ Chỉ huy quân sự tỉnh Gia Lai\nTrung đoàn 739";
      const defaults = {
        unit_name: env.DEFAULT_UNIT_NAME || newDefaultUnit,
        gate_title: env.DEFAULT_GATE_TITLE || "CỔNG TRỰC BAN - NHÀ TIẾP ĐÓN THÂN NHÂN",
        welcome_note:
          "Quý thân nhân vui lòng điền đầy đủ, chính xác thông tin theo Căn cước công dân để phục vụ công tác kiểm tra và tiếp đón tại đơn vị.",
        public_url: env.PUBLIC_URL || "",
        _system_secret: env.SECRET_KEY || randomHex(32),
      };

      for (const [k, v] of Object.entries(defaults)) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
        )
          .bind(k, v)
          .run();
      }

      if (!env.DEFAULT_UNIT_NAME) {
        await env.DB.prepare(
          "UPDATE settings SET value = ? WHERE key = 'unit_name' AND value = 'ĐƠN VỊ QUÂN ĐỘI NHÂN DÂN VIỆT NAM'"
        )
          .bind(newDefaultUnit)
          .run();
      }

      const adminUser = (env.ADMIN_USERNAME || "e739").trim() || "e739";
      const defaultPass = (env.ADMIN_PASSWORD || "").trim() || "739999";

      const countRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM users").first();
      if (!countRow || countRow.cnt === 0) {
        const pwHash = await hashPassword(defaultPass);
        await env.DB.prepare(
          `INSERT INTO users (username, full_name, role, password_hash, must_change_password, created_at)
           VALUES (?, ?, 'admin', ?, 0, ?)`
        )
          .bind(adminUser, "Quản trị viên Trung đoàn 739", pwHash, nowVnStr())
          .run();
      } else if (!env.ADMIN_USERNAME) {
        const hasE739 = await env.DB.prepare(
          "SELECT id FROM users WHERE username = 'e739'"
        ).first();
        if (!hasE739) {
          const oldTrucban = await env.DB.prepare(
            "SELECT id FROM users WHERE username = 'trucban'"
          ).first();
          if (oldTrucban) {
            const pwHash = await hashPassword(defaultPass);
            await env.DB.prepare(
              `UPDATE users
               SET username = 'e739', full_name = 'Quản trị viên Trung đoàn 739',
                   role = 'admin', password_hash = ?, must_change_password = 0
               WHERE id = ?`
            )
              .bind(pwHash, oldTrucban.id)
              .run();
          }
        }
      }
    })().catch((err) => {
      dbInitPromise = null;
      throw err;
    });
  }
  await dbInitPromise;
}

async function getSettings(env) {
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key != '_system_secret'"
  ).all();
  const map = {};
  for (const row of results || []) {
    map[row.key] = row.value;
  }
  return map;
}

async function getSystemSecret(env) {
  if (env.SECRET_KEY) return env.SECRET_KEY;
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = '_system_secret'"
  ).first();
  return row ? row.value : "fallback-secret-key";
}

function isValidPersonName(name) {
  return name.length >= 2 && name.length <= 80 && NAME_REGEX.test(name);
}

function normalizeDob(raw) {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  if (y < 1910 || s > todayVnStr()) return null;
  return s;
}

function formatDobVn(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return isoDate;
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function validateVisitorPayload(data) {
  const cleanSpaces = (v) => String(v || "").trim().replace(/\s+/g, " ");
  const full_name = cleanSpaces(data.full_name);
  const dob_raw = data.date_of_birth || "";
  let relationship = cleanSpaces(data.relationship);
  const relationship_other = cleanSpaces(data.relationship_other);
  const cccd = String(data.cccd || "").trim();
  const soldier_name = cleanSpaces(data.soldier_name);
  const unit_name = cleanSpaces(data.unit_name);
  const phone = String(data.phone || "").trim();
  const visit_location = cleanSpaces(data.visit_location);
  const rawCount = data.visitor_count === undefined || data.visitor_count === "" ? "1" : String(data.visitor_count).trim();
  const note = cleanSpaces(data.note);

  if (!isValidPersonName(full_name)) {
    return {
      error:
        "Họ tên người thăm không hợp lệ (từ 2 - 80 ký tự, chỉ dùng chữ cái và khoảng trắng, không nhập số hay ký tự đặc biệt).",
    };
  }

  const dob = normalizeDob(dob_raw);
  if (!dob) {
    return {
      error: "Ngày tháng năm sinh không hợp lệ (không được vượt quá ngày hiện tại).",
    };
  }

  if (!RELATIONSHIP_OPTIONS.includes(relationship)) {
    return { error: "Vui lòng chọn quan hệ với quân nhân trong danh sách." };
  }

  if (relationship === "Khác") {
    if (!isValidPersonName(relationship_other) || relationship_other.length > 50) {
      return {
        error: "Vui lòng ghi rõ quan hệ khác hợp lệ (chỉ nhập chữ cái, 2 - 50 ký tự).",
      };
    }
    relationship = `Khác (${relationship_other})`;
  }

  if (!/^\d{12}$/.test(cccd)) {
    return {
      error: "Số CCCD phải gồm đúng 12 chữ số, không được nhập chữ hoặc ký tự khác.",
    };
  }
  if (/^(\d)\1{11}$/.test(cccd)) {
    return {
      error: "Số CCCD không hợp lệ (12 chữ số không được giống nhau toàn bộ như 000000000000 hoặc 111111111111).",
    };
  }

  if (!isValidPersonName(soldier_name)) {
    return {
      error:
        "Tên quân nhân được thăm không hợp lệ (từ 2 - 80 ký tự, chỉ dùng chữ cái và khoảng trắng, không nhập số hay ký tự đặc biệt).",
    };
  }

  if (!/^0\d{9}$/.test(phone)) {
    return {
      error:
        "Số điện thoại phải gồm đúng 10 chữ số, bắt đầu bằng số 0 và không được nhập chữ.",
    };
  }

  if (unit_name && (unit_name.length > 80 || /[<>]/.test(unit_name))) {
    return { error: "Tên đơn vị không hợp lệ (tối đa 80 ký tự, không chứa < hoặc >)." };
  }

  if (visit_location && (visit_location.length > 100 || /[<>]/.test(visit_location))) {
    return { error: "Vị trí thăm thân không hợp lệ (tối đa 100 ký tự, không chứa < hoặc >)." };
  }

  if (!/^\d+$/.test(rawCount)) {
    return { error: "Số lượng người nhà vào thăm phải là số nguyên từ 1 đến 50." };
  }
  const visitor_count = parseInt(rawCount, 10);
  if (visitor_count < 1 || visitor_count > 50) {
    return { error: "Số lượng người nhà vào thăm phải từ 1 đến 50 người." };
  }

  if (note && (note.length > 250 || /[<>]/.test(note))) {
    return { error: "Ghi chú không hợp lệ (tối đa 250 ký tự, không chứa < hoặc >)." };
  }

  let visit_date = String(data.visit_date || "").trim() || todayVnStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visit_date)) {
    visit_date = todayVnStr();
  }

  return {
    cleaned: {
      full_name,
      date_of_birth: dob,
      relationship,
      cccd,
      soldier_name,
      unit_name,
      phone,
      visit_location,
      visitor_count,
      note,
      visit_date,
    },
  };
}

function buildRegCode() {
  const vn = nowVnDate();
  const yy = String(vn.getUTCFullYear()).slice(2);
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  return `TN-${yy}${mm}${dd}-${randomHex(2).toUpperCase()}`;
}

function safeCsvCell(val) {
  const s = String(val ?? "");
  const safe = s && ["=", "+", "-", "@", "\t", "\r"].includes(s[0]) ? "'" + s : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function resolveTargetQrUrl(settings, requestUrl, explicitUrl = "") {
  const checkHttp = (raw) => {
    try {
      const u = new URL(raw);
      return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  };
  if (explicitUrl.trim()) {
    const valid = checkHttp(explicitUrl.trim());
    if (valid) return valid;
  }
  if ((settings.public_url || "").trim()) {
    const valid = checkHttp(settings.public_url.trim());
    if (valid) return valid;
  }
  const u = new URL(requestUrl);
  return `${u.protocol}//${u.host}/`;
}

function buildFilterClause(searchParams) {
  const clauses = [];
  const params = [];

  const fromDate = (searchParams.get("from_date") || "").trim();
  const toDate = (searchParams.get("to_date") || "").trim();
  const status = (searchParams.get("status") || "").trim();
  const relationship = (searchParams.get("relationship") || "").trim();
  const q = (searchParams.get("q") || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    clauses.push("visit_date >= ?");
    params.push(fromDate);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    clauses.push("visit_date <= ?");
    params.push(toDate);
  }
  if (STATUS_LABELS[status]) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (relationship) {
    clauses.push("relationship LIKE ?");
    params.push(`%${relationship}%`);
  }
  if (q) {
    const likeQ = `%${q.toLowerCase()}%`;
    clauses.push(
      "(LOWER(full_name) LIKE ? OR LOWER(soldier_name) LIKE ? OR cccd LIKE ? OR LOWER(unit_name) LIKE ? OR LOWER(reg_code) LIKE ?)"
    );
    params.push(likeQ, likeQ, `%${q}%`, likeQ, likeQ);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

async function getSessionAuth(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.sid;
  if (!token) return null;
  const now = nowEpochSec();

  const sess = await env.DB.prepare(
    "SELECT token, user_id, csrf_token, expires_at FROM sessions WHERE token = ?"
  )
    .bind(token)
    .first();

  if (!sess || sess.expires_at < now) {
    if (sess) {
      await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    }
    return null;
  }

  const user = await env.DB.prepare(
    "SELECT id, username, full_name, role, must_change_password FROM users WHERE id = ?"
  )
    .bind(sess.user_id)
    .first();
  if (!user) return null;

  return { user, csrfToken: sess.csrf_token, sessionToken: sess.token };
}

function normalizeVi(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

async function readJsonBody(request, maxBytes = 64 * 1024) {
  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > maxBytes) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const isHttps = url.protocol === "https:";
    const secureFlag = isHttps ? "; Secure" : "";

    if (!path.startsWith("/api/")) {
      if (env.ASSETS) {
        const assetResp = await env.ASSETS.fetch(request);
        const newHeaders = new Headers(assetResp.headers);
        for (const [k, v] of Object.entries(getSecurityHeaders())) {
          newHeaders.set(k, v);
        }
        return new Response(assetResp.body, {
          status: assetResp.status,
          statusText: assetResp.statusText,
          headers: newHeaders,
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    try {
      await ensureDb(env);
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Lỗi kết nối cơ sở dữ liệu D1. Hãy kiểm tra bạn đã tạo D1 Database và điền database_id vào wrangler.jsonc chưa. Chi tiết: " +
            err.message,
        },
        500
      );
    }

    // Health check
    if (path === "/api/healthz" && method === "GET") {
      return jsonResponse({ ok: true, time: nowVnStr() });
    }

    // Public info + signed login CSRF token
    if (path === "/api/public-info" && method === "GET") {
      const settings = await getSettings(env);
      const secret = await getSystemSecret(env);
      const nonce = randomHex(16);
      const sig = await hmacSign(secret, nonce);
      const loginCsrf = `${nonce}.${sig}`;
      const soldierCountRow = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM soldiers"
      ).first();
      const soldiersCount = soldierCountRow?.cnt || 0;
      return jsonResponse({
        ok: true,
        settings,
        relationships: RELATIONSHIP_OPTIONS,
        today: todayVnStr(),
        login_csrf: loginCsrf,
        has_soldier_roster: soldiersCount > 0,
        soldiers_count: soldiersCount,
      });
    }

    // Public soldier search (accent-insensitive, returns top 20 matches)
    if (path === "/api/soldiers/search" && method === "GET") {
      const qRaw = (url.searchParams.get("q") || "").trim();
      const qNorm = normalizeVi(qRaw);
      if (qNorm.length < 1) {
        return jsonResponse({ ok: true, soldiers: [] });
      }
      const rows = await env.DB.prepare(
        `SELECT id, full_name, unit_name, rank_title
         FROM soldiers
         WHERE name_norm LIKE ? OR LOWER(unit_name) LIKE ?
         ORDER BY full_name ASC
         LIMIT 20`
      )
        .bind(`%${qNorm}%`, `%${qRaw.toLowerCase()}%`)
        .all();
      return jsonResponse({ ok: true, soldiers: rows.results || [] });
    }

    // Public visitor registration
    if (path === "/api/register" && method === "POST") {
      const ip = getClientIp(request);
      const cutoff = nowEpochSec() - RATE_LIMIT_WINDOW_SEC;
      await env.DB.prepare("DELETE FROM rate_limits WHERE created_at < ?").bind(cutoff).run();
      const rateRow = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM rate_limits WHERE ip = ? AND created_at >= ?"
      )
        .bind(ip, cutoff)
        .first();
      if (rateRow && rateRow.cnt >= RATE_LIMIT_MAX) {
        return jsonResponse(
          { ok: false, error: "Gửi quá nhanh. Vui lòng thử lại sau ít phút." },
          429
        );
      }
      await env.DB.prepare("INSERT INTO rate_limits (ip, created_at) VALUES (?, ?)")
        .bind(ip, nowEpochSec())
        .run();

      let payload;
      try {
        payload = await readJsonBody(request);
      } catch {
        return jsonResponse({ ok: false, error: "Dữ liệu gửi lên quá lớn." }, 413);
      }

      const rosterRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM soldiers").first();
      const hasRoster = (rosterRow?.cnt || 0) > 0;
      let matchedSoldier = null;

      if (hasRoster) {
        const sid = parseInt(payload.soldier_id || "0", 10);
        if (sid > 0) {
          matchedSoldier = await env.DB.prepare(
            "SELECT id, full_name, unit_name FROM soldiers WHERE id = ?"
          )
            .bind(sid)
            .first();
        }
        if (!matchedSoldier) {
          const sNorm = normalizeVi(payload.soldier_name || "");
          if (sNorm) {
            matchedSoldier = await env.DB.prepare(
              "SELECT id, full_name, unit_name FROM soldiers WHERE name_norm = ? LIMIT 1"
            )
              .bind(sNorm)
              .first();
          }
        }
        if (!matchedSoldier) {
          return jsonResponse(
            {
              ok: false,
              error: "Vui lòng tìm kiếm và bấm chọn đúng tên quân nhân từ danh sách đơn vị.",
            },
            400
          );
        }
        payload.soldier_name = matchedSoldier.full_name;
        if (!String(payload.unit_name || "").trim() && matchedSoldier.unit_name) {
          payload.unit_name = matchedSoldier.unit_name;
        }
      }

      const { cleaned, error } = validateVisitorPayload(payload);
      if (error) {
        return jsonResponse({ ok: false, error }, 400);
      }

      const nowStr = nowVnStr();
      const regCode = buildRegCode();
      const result = await env.DB.prepare(
        `INSERT INTO visitors (
          reg_code, full_name, date_of_birth, relationship, cccd,
          soldier_name, unit_name, phone, visit_location, visitor_count, note, status,
          visit_date, created_at, updated_at, checked_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, '')`
      )
        .bind(
          regCode,
          cleaned.full_name,
          cleaned.date_of_birth,
          cleaned.relationship,
          cleaned.cccd,
          cleaned.soldier_name,
          cleaned.unit_name,
          cleaned.phone,
          cleaned.visit_location,
          cleaned.visitor_count,
          cleaned.note,
          cleaned.visit_date,
          nowStr,
          nowStr
        )
        .run();

      return jsonResponse(
        {
          ok: true,
          visitor: {
            id: result.meta?.last_row_id || 0,
            reg_code: regCode,
            full_name: cleaned.full_name,
            date_of_birth_vn: formatDobVn(cleaned.date_of_birth),
            relationship: cleaned.relationship,
            cccd_masked: `${cleaned.cccd.slice(0, 4)}****${cleaned.cccd.slice(-4)}`,
            soldier_name: cleaned.soldier_name,
            unit_name: cleaned.unit_name,
            visit_location: cleaned.visit_location,
            visitor_count: cleaned.visitor_count,
            visit_date_vn: formatDobVn(cleaned.visit_date),
            created_at: nowStr,
            status_label: STATUS_LABELS.pending,
          },
        },
        201
      );
    }

    // Login
    if (path === "/api/login" && method === "POST") {
      let payload;
      try {
        payload = await readJsonBody(request);
      } catch {
        return jsonResponse({ ok: false, error: "Dữ liệu không hợp lệ." }, 400);
      }

      const secret = await getSystemSecret(env);
      const csrfParts = String(payload.login_csrf || "").split(".");
      if (csrfParts.length !== 2) {
        return jsonResponse({ ok: false, error: "Phiên bảo mật không hợp lệ. Vui lòng tải lại trang." }, 403);
      }
      const expectedSig = await hmacSign(secret, csrfParts[0]);
      if (!timingSafeEqual(expectedSig, csrfParts[1])) {
        return jsonResponse({ ok: false, error: "Phiên bảo mật không hợp lệ. Vui lòng tải lại trang." }, 403);
      }

      const ip = getClientIp(request);
      const lockCutoff = nowEpochSec() - LOGIN_WINDOW_SEC;
      await env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < ?")
        .bind(lockCutoff)
        .run();
      const failRow = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM login_attempts WHERE ip = ? AND attempted_at >= ?"
      )
        .bind(ip, lockCutoff)
        .first();
      if (failRow && failRow.cnt >= LOGIN_MAX_ATTEMPTS) {
        return jsonResponse(
          { ok: false, error: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút." },
          429
        );
      }

      const username = String(payload.username || "").trim();
      const password = String(payload.password || "");
      const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?")
        .bind(username)
        .first();

      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await env.DB.prepare("INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)")
          .bind(ip, nowEpochSec())
          .run();
        return jsonResponse(
          { ok: false, error: "Tên đăng nhập hoặc mật khẩu không đúng." },
          401
        );
      }

      await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
      const sessionToken = randomHex(32);
      const csrfToken = randomHex(24);
      const expiresAt = nowEpochSec() + SESSION_TTL_SEC;

      await env.DB.prepare(
        "INSERT INTO sessions (token, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)"
      )
        .bind(sessionToken, user.id, csrfToken, expiresAt)
        .run();

      return jsonResponse(
        { ok: true },
        200,
        {
          "Set-Cookie": `sid=${encodeURIComponent(sessionToken)}; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`,
        }
      );
    }

    // Logout
    if (path === "/api/logout" && method === "POST") {
      const cookies = parseCookies(request);
      if (cookies.sid) {
        await env.DB.prepare("DELETE FROM sessions WHERE token = ?")
          .bind(cookies.sid)
          .run();
      }
      return jsonResponse(
        { ok: true },
        200,
        {
          "Set-Cookie": `sid=; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=0`,
        }
      );
    }

    // All remaining /api/admin/* and /api/qr.svg require authentication
    const auth = await getSessionAuth(request, env);
    if (!auth) {
      return jsonResponse({ ok: false, error: "Chưa đăng nhập hoặc phiên đã hết hạn." }, 401);
    }

    // Enforce CSRF on all mutating admin endpoints
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const providedCsrf = request.headers.get("X-CSRF-Token") || "";
      if (!timingSafeEqual(auth.csrfToken, providedCsrf)) {
        return jsonResponse(
          { ok: false, error: "Phiên bảo mật không hợp lệ (CSRF). Vui lòng tải lại trang." },
          403
        );
      }
    }

    // Current admin info & QR target URL
    if (path === "/api/admin/me" && method === "GET") {
      const settings = await getSettings(env);
      const targetUrl = resolveTargetQrUrl(settings, request.url, url.searchParams.get("url") || "");
      return jsonResponse({
        ok: true,
        user: auth.user,
        csrf_token: auth.csrfToken,
        settings,
        target_url: targetUrl,
        today: todayVnStr(),
        relationships: RELATIONSHIP_OPTIONS,
      });
    }

    // QR Code SVG generator (sharp vector QR, works 100% on Cloudflare Workers)
    if (path === "/api/qr.svg" && method === "GET") {
      const settings = await getSettings(env);
      const targetUrl = resolveTargetQrUrl(
        settings,
        request.url,
        url.searchParams.get("url") || ""
      );

      const qr = qrcode(0, "M");
      qr.addData(targetUrl);
      qr.make();
      const svg = qr.createSvgTag(10, 4);
      const headers = getSecurityHeaders({
        "Content-Type": "image/svg+xml; charset=utf-8",
      });
      if (url.searchParams.get("download") === "1") {
        headers["Content-Disposition"] = 'attachment; filename="qr-dang-ky-tham-quan-nhan.svg"';
      }
      return new Response(svg, { status: 200, headers });
    }

    // Admin Dashboard summary + aggregations
    if (path === "/api/admin/dashboard" && method === "GET") {
      const { whereSql, params } = buildFilterClause(url.searchParams);
      const today = todayVnStr();
      const vnNow = nowVnDate();
      const dayOfWeek = (vnNow.getUTCDay() + 6) % 7; // Monday = 0
      const weekStartDate = new Date(vnNow.getTime() - dayOfWeek * 86400 * 1000);
      const weekStart = weekStartDate.toISOString().slice(0, 10);
      const monthStart = today.slice(0, 8) + "01";

      const visitorsRes = await env.DB.prepare(
        `SELECT * FROM visitors ${whereSql} ORDER BY visit_date DESC, created_at DESC LIMIT 1000`
      )
        .bind(...params)
        .all();
      const visitors = (visitorsRes.results || []).map((v) => ({
        ...v,
        dob_vn: formatDobVn(v.date_of_birth),
        visit_date_vn: formatDobVn(v.visit_date),
        status_label: STATUS_LABELS[v.status] || v.status,
      }));

      const bySoldierRes = await env.DB.prepare(
        `SELECT
           soldier_name,
           MAX(unit_name) AS unit_name,
           COALESCE(SUM(COALESCE(visitor_count, 1)), 0) AS total_visitors,
           COALESCE(SUM(CASE WHEN status = 'checked_in' THEN COALESCE(visitor_count, 1) ELSE 0 END), 0) AS checked_in_count,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN COALESCE(visitor_count, 1) ELSE 0 END), 0) AS pending_count,
           COALESCE(SUM(CASE WHEN status = 'checked_out' THEN COALESCE(visitor_count, 1) ELSE 0 END), 0) AS checked_out_count,
           MAX(visit_date) AS latest_visit
         FROM visitors ${whereSql}
         GROUP BY soldier_name
         ORDER BY total_visitors DESC, soldier_name ASC`
      )
        .bind(...params)
        .all();
      const by_soldier = (bySoldierRes.results || []).map((s) => ({
        ...s,
        latest_visit_vn: formatDobVn(s.latest_visit),
      }));

      const byDateRes = await env.DB.prepare(
        `SELECT
           visit_date,
           COALESCE(SUM(COALESCE(visitor_count, 1)), 0) AS total_visitors,
           COALESCE(SUM(CASE WHEN status = 'checked_in' THEN COALESCE(visitor_count, 1) ELSE 0 END), 0) AS checked_in_count,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN COALESCE(visitor_count, 1) ELSE 0 END), 0) AS pending_count,
           COALESCE(SUM(CASE WHEN status = 'checked_out' THEN COALESCE(visitor_count, 1) ELSE 0 END), 0) AS checked_out_count
         FROM visitors ${whereSql}
         GROUP BY visit_date
         ORDER BY visit_date DESC
         LIMIT 90`
      )
        .bind(...params)
        .all();
      const by_date = (byDateRes.results || []).map((d) => ({
        ...d,
        visit_date_vn: formatDobVn(d.visit_date),
      }));

      const byRelRes = await env.DB.prepare(
        `SELECT relationship, COALESCE(SUM(COALESCE(visitor_count, 1)), 0) AS total_visitors
         FROM visitors ${whereSql}
         GROUP BY relationship
         ORDER BY total_visitors DESC`
      )
        .bind(...params)
        .all();

      const todayRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(COALESCE(visitor_count, 1)), 0) AS cnt FROM visitors WHERE visit_date = ?"
      )
        .bind(today)
        .first();
      const activeRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(COALESCE(visitor_count, 1)), 0) AS cnt FROM visitors WHERE visit_date = ? AND status = 'checked_in'"
      )
        .bind(today)
        .first();
      const weekRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(COALESCE(visitor_count, 1)), 0) AS cnt FROM visitors WHERE visit_date >= ?"
      )
        .bind(weekStart)
        .first();
      const monthRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(COALESCE(visitor_count, 1)), 0) AS cnt FROM visitors WHERE visit_date >= ?"
      )
        .bind(monthStart)
        .first();
      const allRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(COALESCE(visitor_count, 1)), 0) AS cnt FROM visitors"
      ).first();

      const filteredPeople = visitors.reduce(
        (sum, v) => sum + (parseInt(v.visitor_count || 1, 10) || 1),
        0
      );

      return jsonResponse({
        ok: true,
        summary: {
          today_count: todayRow?.cnt || 0,
          today_active: activeRow?.cnt || 0,
          week_count: weekRow?.cnt || 0,
          month_count: monthRow?.cnt || 0,
          all_count: allRow?.cnt || 0,
          filtered_total: filteredPeople,
          unique_soldiers: by_soldier.length,
        },
        visitors,
        by_soldier,
        by_date,
        by_relationship: byRelRes.results || [],
      });
    }

    // Manual visitor entry
    if (path === "/api/admin/visitors" && method === "POST") {
      const payload = await readJsonBody(request);
      const { cleaned, error } = validateVisitorPayload(payload);
      if (error) return jsonResponse({ ok: false, error }, 400);

      const status = STATUS_LABELS[payload.status] ? payload.status : "checked_in";
      const nowStr = nowVnStr();
      const regCode = buildRegCode();

      const res = await env.DB.prepare(
        `INSERT INTO visitors (
          reg_code, full_name, date_of_birth, relationship, cccd,
          soldier_name, unit_name, phone, visit_location, visitor_count, note, status,
          visit_date, created_at, updated_at, checked_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          regCode,
          cleaned.full_name,
          cleaned.date_of_birth,
          cleaned.relationship,
          cleaned.cccd,
          cleaned.soldier_name,
          cleaned.unit_name,
          cleaned.phone,
          cleaned.visit_location,
          cleaned.visitor_count,
          cleaned.note,
          status,
          cleaned.visit_date,
          nowStr,
          nowStr,
          auth.user.full_name
        )
        .run();

      return jsonResponse({ ok: true, id: res.meta?.last_row_id || 0, reg_code: regCode }, 201);
    }

    // Update visitor status
    const statusMatch = path.match(/^\/api\/admin\/visitors\/(\d+)\/status$/);
    if (statusMatch && method === "PATCH") {
      const visitorId = parseInt(statusMatch[1], 10);
      const payload = await readJsonBody(request);
      const newStatus = String(payload.status || "").trim();
      if (!STATUS_LABELS[newStatus]) {
        return jsonResponse({ ok: false, error: "Trạng thái không hợp lệ." }, 400);
      }
      const existing = await env.DB.prepare("SELECT id FROM visitors WHERE id = ?")
        .bind(visitorId)
        .first();
      if (!existing) {
        return jsonResponse({ ok: false, error: "Không tìm thấy hồ sơ đăng ký." }, 404);
      }
      await env.DB.prepare(
        "UPDATE visitors SET status = ?, updated_at = ?, checked_by = ? WHERE id = ?"
      )
        .bind(newStatus, nowVnStr(), auth.user.full_name, visitorId)
        .run();
      return jsonResponse({ ok: true });
    }

    // Delete visitor
    const delVisitorMatch = path.match(/^\/api\/admin\/visitors\/(\d+)$/);
    if (delVisitorMatch && method === "DELETE") {
      const visitorId = parseInt(delVisitorMatch[1], 10);
      await env.DB.prepare("DELETE FROM visitors WHERE id = ?").bind(visitorId).run();
      return jsonResponse({ ok: true });
    }

    // Export CSV
    if (path === "/api/admin/export.csv" && method === "GET") {
      const { whereSql, params } = buildFilterClause(url.searchParams);
      const rowsRes = await env.DB.prepare(
        `SELECT * FROM visitors ${whereSql} ORDER BY visit_date DESC, created_at DESC`
      )
        .bind(...params)
        .all();

      const header = [
        "STT",
        "Mã đăng ký",
        "Ngày thăm",
        "Họ tên người thăm",
        "Ngày sinh",
        "Quan hệ quân nhân",
        "Số CCCD",
        "Tên (quân nhân) được thăm",
        "Đơn vị",
        "Số điện thoại",
        "Vị trí thăm thân",
        "Số lượng người nhà",
        "Ghi chú",
        "Trạng thái",
        "Thời gian đăng ký",
        "Cán bộ kiểm tra",
      ]
        .map(safeCsvCell)
        .join(",");

      const lines = [header];
      (rowsRes.results || []).forEach((r, idx) => {
        lines.push(
          [
            idx + 1,
            r.reg_code,
            formatDobVn(r.visit_date),
            r.full_name,
            formatDobVn(r.date_of_birth),
            r.relationship,
            `'${r.cccd}`,
            r.soldier_name,
            r.unit_name,
            r.phone ? `'${r.phone}` : "",
            r.visit_location || "",
            r.visitor_count || 1,
            r.note,
            STATUS_LABELS[r.status] || r.status,
            r.created_at,
            r.checked_by,
          ]
            .map(safeCsvCell)
            .join(",")
        );
      });

      const bom = "\uFEFF";
      const csvText = bom + lines.join("\r\n");
      const filename = `tong-hop-tham-quan-nhan-${todayVnStr()}.csv`;
      return new Response(csvText, {
        status: 200,
        headers: getSecurityHeaders({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        }),
      });
    }

    // Save settings
    if (path === "/api/admin/settings" && method === "POST") {
      const payload = await readJsonBody(request);
      for (const key of ["unit_name", "gate_title", "welcome_note", "public_url"]) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          await env.DB.prepare(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
          )
            .bind(key, String(payload[key] ?? "").trim())
            .run();
        }
      }
      return jsonResponse({ ok: true });
    }

    // Update own profile
    if (path === "/api/admin/profile" && method === "POST") {
      const payload = await readJsonBody(request);
      const username = String(payload.username || "")
        .trim()
        .replace(/[^a-zA-Z0-9_.-]/g, "");
      const full_name = String(payload.full_name || "")
        .trim()
        .replace(/\s+/g, " ");

      if (username.length < 3 || username.length > 50) {
        return jsonResponse(
          { ok: false, error: "Tên đăng nhập phải từ 3 - 50 ký tự (chữ, số, _ . -)." },
          400
        );
      }
      if (full_name.length < 2 || full_name.length > 100) {
        return jsonResponse(
          { ok: false, error: "Họ tên / chức vụ phải từ 2 - 100 ký tự." },
          400
        );
      }

      const conflict = await env.DB.prepare(
        "SELECT id FROM users WHERE username = ? AND id != ?"
      )
        .bind(username, auth.user.id)
        .first();
      if (conflict) {
        return jsonResponse(
          { ok: false, error: "Tên đăng nhập này đã có tài khoản khác sử dụng." },
          400
        );
      }
      await env.DB.prepare("UPDATE users SET username = ?, full_name = ? WHERE id = ?")
        .bind(username, full_name, auth.user.id)
        .run();
      return jsonResponse({ ok: true, username, full_name });
    }

    // Change own password
    if (path === "/api/admin/change-password" && method === "POST") {
      const payload = await readJsonBody(request);
      const currentPw = String(payload.current_password || "");
      const newPw = String(payload.new_password || "");
      if (newPw.length < 6) {
        return jsonResponse(
          { ok: false, error: "Mật khẩu mới phải từ 6 ký tự trở lên." },
          400
        );
      }
      const dbUser = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
        .bind(auth.user.id)
        .first();
      if (!dbUser || !(await verifyPassword(currentPw, dbUser.password_hash))) {
        return jsonResponse({ ok: false, error: "Mật khẩu hiện tại không đúng." }, 400);
      }
      const newHash = await hashPassword(newPw);
      await env.DB.prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?"
      )
        .bind(newHash, auth.user.id)
        .run();
      return jsonResponse({ ok: true });
    }

    // Admin-only user management
    if (path.startsWith("/api/admin/users")) {
      if (auth.user.role !== "admin") {
        return jsonResponse(
          { ok: false, error: "Chỉ tài khoản Quản trị mới có quyền thực hiện." },
          403
        );
      }

      if (path === "/api/admin/users" && method === "GET") {
        const usersRes = await env.DB.prepare(
          "SELECT id, username, full_name, role, created_at FROM users ORDER BY id ASC"
        ).all();
        return jsonResponse({ ok: true, users: usersRes.results || [] });
      }

      if (path === "/api/admin/users" && method === "POST") {
        const payload = await readJsonBody(request);
        const username = String(payload.username || "")
          .trim()
          .replace(/[^a-zA-Z0-9_.-]/g, "");
        const full_name = String(payload.full_name || "")
          .trim()
          .replace(/\s+/g, " ");
        const password = String(payload.password || "");
        const role = payload.role === "admin" ? "admin" : "officer";

        if (username.length < 3) {
          return jsonResponse(
            { ok: false, error: "Tên đăng nhập phải từ 3 ký tự (chữ, số, _)." },
            400
          );
        }
        if (full_name.length < 2) {
          return jsonResponse({ ok: false, error: "Vui lòng nhập họ tên cán bộ." }, 400);
        }
        if (password.length < 6) {
          return jsonResponse(
            { ok: false, error: "Mật khẩu phải từ 6 ký tự trở lên." },
            400
          );
        }

        const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
          .bind(username)
          .first();
        if (existing) {
          return jsonResponse({ ok: false, error: "Tên đăng nhập này đã tồn tại." }, 400);
        }

        const pwHash = await hashPassword(password);
        await env.DB.prepare(
          `INSERT INTO users (username, full_name, role, password_hash, must_change_password, created_at)
           VALUES (?, ?, ?, ?, 0, ?)`
        )
          .bind(username, full_name, role, pwHash, nowVnStr())
          .run();
        return jsonResponse({ ok: true }, 201);
      }

      const userMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
      if (userMatch && method === "PATCH") {
        const uid = parseInt(userMatch[1], 10);
        const payload = await readJsonBody(request);
        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
          .bind(uid)
          .first();
        if (!target) {
          return jsonResponse({ ok: false, error: "Không tìm thấy tài khoản." }, 404);
        }

        const full_name = String(payload.full_name || "")
          .trim()
          .replace(/\s+/g, " ");
        if (full_name) {
          if (full_name.length < 2) {
            return jsonResponse({ ok: false, error: "Họ tên / chức vụ quá ngắn." }, 400);
          }
          await env.DB.prepare("UPDATE users SET full_name = ? WHERE id = ?")
            .bind(full_name, uid)
            .run();
        }

        const role = payload.role;
        if ((role === "admin" || role === "officer") && role !== target.role) {
          if (target.role === "admin" && role === "officer") {
            const cntRow = await env.DB.prepare(
              "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'"
            ).first();
            if ((cntRow?.cnt || 0) <= 1) {
              return jsonResponse(
                {
                  ok: false,
                  error: "Phải giữ lại ít nhất 1 tài khoản Quản trị viên (Admin).",
                },
                400
              );
            }
          }
          await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?")
            .bind(role, uid)
            .run();
        }

        const newPw = String(payload.new_password || "");
        if (newPw) {
          if (newPw.length < 6) {
            return jsonResponse(
              { ok: false, error: "Mật khẩu mới phải từ 6 ký tự trở lên." },
              400
            );
          }
          const newHash = await hashPassword(newPw);
          await env.DB.prepare(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?"
          )
            .bind(newHash, uid)
            .run();
        }

        return jsonResponse({ ok: true });
      }

      if (userMatch && method === "DELETE") {
        const uid = parseInt(userMatch[1], 10);
        if (uid === auth.user.id) {
          return jsonResponse(
            { ok: false, error: "Không thể xóa tài khoản đang đăng nhập." },
            400
          );
        }
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid).run();
        await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(uid).run();
        return jsonResponse({ ok: true });
      }
    }

    // Admin Soldier Roster (List, Import from Excel, Add, Delete, Clear)
    if (path === "/api/admin/soldiers" && method === "GET") {
      const qRaw = (url.searchParams.get("q") || "").trim();
      const qNorm = normalizeVi(qRaw);
      let rowsRes;
      if (qNorm) {
        rowsRes = await env.DB.prepare(
          `SELECT id, full_name, unit_name, rank_title, created_at
           FROM soldiers
           WHERE name_norm LIKE ? OR LOWER(unit_name) LIKE ? OR LOWER(rank_title) LIKE ?
           ORDER BY full_name ASC
           LIMIT 500`
        )
          .bind(`%${qNorm}%`, `%${qRaw.toLowerCase()}%`, `%${qRaw.toLowerCase()}%`)
          .all();
      } else {
        rowsRes = await env.DB.prepare(
          `SELECT id, full_name, unit_name, rank_title, created_at
           FROM soldiers
           ORDER BY full_name ASC
           LIMIT 500`
        ).all();
      }
      const countRow = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM soldiers").first();
      return jsonResponse({
        ok: true,
        total: countRow?.cnt || 0,
        soldiers: rowsRes.results || [],
      });
    }

    if (path === "/api/admin/soldiers" && method === "POST") {
      const payload = await readJsonBody(request);
      const full_name = String(payload.full_name || "").trim().replace(/\s+/g, " ");
      const unit_name = String(payload.unit_name || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const rank_title = String(payload.rank_title || "").trim().replace(/\s+/g, " ").slice(0, 50);

      if (!isValidPersonName(full_name)) {
        return jsonResponse(
          {
            ok: false,
            error: "Họ tên quân nhân không hợp lệ (2 - 80 ký tự, chỉ nhập chữ cái và khoảng trắng).",
          },
          400
        );
      }

      const nameNorm = normalizeVi(full_name);
      await env.DB.prepare(
        "INSERT INTO soldiers (full_name, name_norm, unit_name, rank_title, created_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(full_name, nameNorm, unit_name, rank_title, nowVnStr())
        .run();
      return jsonResponse({ ok: true }, 201);
    }

    if (path === "/api/admin/soldiers/import" && method === "POST") {
      let payload;
      try {
        payload = await readJsonBody(request, 2 * 1024 * 1024);
      } catch {
        return jsonResponse({ ok: false, error: "File tải lên quá lớn (tối đa 2MB)." }, 413);
      }

      const items = Array.isArray(payload.soldiers) ? payload.soldiers : [];
      if (!items.length) {
        return jsonResponse({ ok: false, error: "Danh sách tải lên bị trống." }, 400);
      }
      if (items.length > 5000) {
        return jsonResponse({ ok: false, error: "Tối đa 5.000 quân nhân mỗi lần nhập." }, 400);
      }

      const mode = payload.mode === "append" ? "append" : "replace";
      const nowStr = nowVnStr();
      const validRows = [];
      const seenKeys = new Set();

      if (mode === "append") {
        const existingRes = await env.DB.prepare("SELECT name_norm, unit_name FROM soldiers").all();
        for (const r of existingRes.results || []) {
          seenKeys.add(`${r.name_norm}|${String(r.unit_name || "").toLowerCase()}`);
        }
      }

      let skipped = 0;
      for (const item of items) {
        const full_name = String(item?.full_name || "").trim().replace(/\s+/g, " ");
        const unit_name = String(item?.unit_name || "").trim().replace(/\s+/g, " ").slice(0, 80);
        const rank_title = String(item?.rank_title || "").trim().replace(/\s+/g, " ").slice(0, 50);

        if (!isValidPersonName(full_name) || /[<>]/.test(unit_name) || /[<>]/.test(rank_title)) {
          skipped++;
          continue;
        }
        const nameNorm = normalizeVi(full_name);
        const dedupKey = `${nameNorm}|${unit_name.toLowerCase()}`;
        if (seenKeys.has(dedupKey)) {
          skipped++;
          continue;
        }
        seenKeys.add(dedupKey);
        validRows.push({ full_name, name_norm: nameNorm, unit_name, rank_title });
      }

      if (!validRows.length) {
        return jsonResponse(
          {
            ok: false,
            error: "Không có dòng hợp lệ nào để lưu (họ tên phải từ 2-80 chữ cái, không chứa số hay trùng lặp).",
          },
          400
        );
      }

      if (mode === "replace") {
        await env.DB.prepare("DELETE FROM soldiers").run();
      }

      const insertStmt = env.DB.prepare(
        "INSERT INTO soldiers (full_name, name_norm, unit_name, rank_title, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      for (let i = 0; i < validRows.length; i += 100) {
        const chunk = validRows.slice(i, i + 100).map((r) =>
          insertStmt.bind(r.full_name, r.name_norm, r.unit_name, r.rank_title, nowStr)
        );
        await env.DB.batch(chunk);
      }

      return jsonResponse({
        ok: true,
        imported: validRows.length,
        skipped,
      });
    }

    if (path === "/api/admin/soldiers" && method === "DELETE") {
      await env.DB.prepare("DELETE FROM soldiers").run();
      return jsonResponse({ ok: true });
    }

    const delSoldierMatch = path.match(/^\/api\/admin\/soldiers\/(\d+)$/);
    if (delSoldierMatch && method === "DELETE") {
      const sid = parseInt(delSoldierMatch[1], 10);
      await env.DB.prepare("DELETE FROM soldiers WHERE id = ?").bind(sid).run();
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: "Không tìm thấy API." }, 404);
  },
};
