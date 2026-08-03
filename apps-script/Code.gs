/**
 * ===================================================================================
 * ㄚ倫老師魔法實驗室 — AI 創作畫廊 Google Apps Script 後端（v2）
 * ===================================================================================
 * 部署與設定完整步驟請見 README.md。本檔案只留下（1）設定常數 CONFIG，
 * 與（2）Script Properties 需要手動填入的機密值，其餘欄位/資料表結構一律由
 * setupOrMigrate() 自動建立與升級，安全可重複執行、不會刪除或覆蓋既有資料。
 *
 * 需要在「專案設定 → Script Properties」填入：
 *   GOOGLE_CLIENT_ID   Google OAuth 2.0 用戶端 ID（Web application）
 *   SESSION_SECRET     任意一串長亂數字串，用來簽署網站自己的登入 session token
 *   OPENAI_API_KEY     OpenAI API Key（僅用於 AI 作圖，不填則 AI 作圖頁顯示未設定）
 *   DRIVE_BACKUP_FOLDER_ID  圖片上傳/備份用的 Google Drive 資料夾 ID
 *
 * 部署後第一次使用，請在 Apps Script 編輯器上方函式選單選 setupOrMigrate，按執行一次。
 * ===================================================================================
 */

const CONFIG = {
  SHEET_ARTWORKS: "Artworks",
  SHEET_USERS: "AuthorizedUsers",
  SHEET_COMMENTS: "Comments",
  SHEET_STORY_CHAIN: "StoryChain", // 舊版資料保留備存，新版不再寫入
  SHEET_STORY_ROUNDS: "StoryRounds",
  SHEET_STORY_VOTES: "StoryVotes",
  SHEET_HONOR_BOARD: "HonorBoard",
  SHEET_STORY_BOOKS: "StoryBooks",
  SHEET_AI_USAGE: "AIUsage",
  SHEET_SETTINGS: "Settings",
  SESSION_TTL_MS: 7 * 24 * 3600 * 1000, // 登入 session 有效期：7 天
};

const DEFAULT_SETTINGS = {
  STORY_CANDIDATES_PER_ROUND: 4,
  STORY_DAILY_ROLLOVER_HOUR: 12, // Asia/Taipei，24 小時制
  STORY_BOOK_MAX_PAGES: 30,
  STORY_BOOK_CHARS_PER_PAGE: 200,
  STORY_BOOK_MAX_ACTIVE: 3,
  AI_DEFAULT_QUOTA_LIMIT: 5,
  AI_DEFAULT_RESET_HOUR: 0, // Asia/Taipei
  AI_MODEL: "gpt-image-1",
  AI_SIZE: "1024x1024",
  AI_QUALITY: "medium",
  STALE_PRIVATE_AI_DAYS: 60, // 超過這麼多天還維持「私人」的 AI 產圖，清理函式會視為可刪除的候選
};

/* =========================================================================
   分頁欄位定義（新增分頁一律用這裡的完整欄位清單；migrate 只會「補上缺少的欄位」，
   絕不刪除或搬動既有欄位，確保與舊資料相容）
   ========================================================================= */

const ARTWORK_HEADERS = [
  // 舊欄位（原始順序，勿更動）
  "ID", "Timestamp", "StudentName", "ClassName", "ImageURL", "DriveBackupURL",
  "Prompt", "Description", "AITool", "Tags", "Likes", "Approved",
  // 新欄位
  "OwnerUserID", "Nickname", "DriveFileID", "Visibility", "AllowStory", "Source",
];

const USER_HEADERS = [
  "UserID", "GoogleSub", "Email", "StudentName", "Nickname", "ClassName", "Role",
  "Status", "ArtworkAutoApprove", "QuotaMode", "QuotaLimit", "ResetHour",
  "SessionVersion", "CreatedAt", "ApprovedAt", "CharacterSheet",
];

// Status 欄位的合法值清單，同時用來設定 Google Sheet 下拉選單（僅顯示警告，不會拒絕輸入，
// 老師仍可打入清單外的文字，後端邏輯只認「Active」以外一律視為不可用）
const STATUS_VALUES = ["Pending", "Active", "Disabled", "Suspended", "Inactive"];

const COMMENT_HEADERS = ["ArtworkID", "CommenterName", "Comment", "Timestamp"];
const STORY_CHAIN_HEADERS = [
  "Order", "ArtworkID", "StudentName", "ClassName", "ImageURL", "AITool", "WinningVotes", "Timestamp",
];
const STORY_ROUNDS_HEADERS = ["RoundID", "ClassName", "Status", "CandidateIDsJSON", "StartedAt", "EndsAt", "ClosedAt"];
const STORY_VOTES_HEADERS = ["RoundID", "UserID", "ArtworkID", "UpdatedAt"];
const HONOR_BOARD_HEADERS = ["RoundID", "ClassName", "Rank", "ArtworkID", "Votes", "ClosedAt"];
const STORY_BOOKS_HEADERS = ["BookID", "OwnerUserID", "Title", "FramesJSON", "Status", "CreatedAt", "UpdatedAt"];
const AI_USAGE_HEADERS = ["DateKey", "UserID", "Mode", "UsedCount", "InputTokens", "OutputTokens", "UpdatedAt"];
const SETTINGS_HEADERS = ["Key", "Value"];

/* =========================================================================
   共用工具
   ========================================================================= */

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`找不到分頁「${name}」，請先在 Apps Script 編輯器執行 setupOrMigrate()`);
  return sheet;
}

function getHeaderRow_(sheet) {
  if (sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

/** 將整個分頁（含表頭）轉成物件陣列（依表頭名稱動態對應，欄位順序改變也不受影響） */
function sheetToObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  const rows = data.slice(1);
  return rows
    .filter((row) => row.some((cell) => cell !== "" && cell !== null))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function colIndex_(sheet, headerName) {
  const headers = getHeaderRow_(sheet);
  const idx = headers.indexOf(headerName);
  if (idx === -1) throw new Error(`分頁「${sheet.getName()}」找不到欄位「${headerName}」，請先執行 setupOrMigrate()`);
  return idx + 1;
}

/** 讀出每一列「實際的列號 + 物件內容」，跳過完全空白的列，但保證 rowNum 永遠對應
 *  到真正的分頁列號（不像 sheetToObjects_ 回傳的陣列，中間若曾經刪除過列，索引不再
 *  等於列號 - 2）。用在需要「先找到符合條件的那一列、緊接著要更新/刪除同一列」的地方，
 *  避免陣列索引與實際列號對不齊而更新錯列。 */
function rowsWithLineNumbers_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row.some((c) => c !== "" && c !== null)) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = row[idx]; });
    result.push({ rowNum: i + 1, obj });
  }
  return result;
}

/** 依 ID 欄位找出資料列（回傳 1-based row number，找不到回傳 -1） */
function findRowByValue_(sheet, colName, value) {
  const col = colIndex_(sheet, colName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(value)) return i + 2;
  }
  return -1;
}

/** 依表頭名稱把物件寫成一列 appendRow（欄位順序照實際表頭走，缺的填空字串） */
function appendObjectRow_(sheet, obj) {
  const headers = getHeaderRow_(sheet);
  const row = headers.map((h) => (Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ""));
  sheet.appendRow(row);
}

/** 依表頭名稱局部更新既有的一列（只更新 obj 裡有出現的欄位） */
function updateObjectRow_(sheet, rowNum, obj) {
  const headers = getHeaderRow_(sheet);
  headers.forEach((h, i) => {
    if (Object.prototype.hasOwnProperty.call(obj, h)) {
      sheet.getRange(rowNum, i + 1).setValue(obj[h]);
    }
  });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function textOut_(msg) {
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}

function parseBoolean_(val) {
  if (typeof val === "boolean") return val;
  const s = String(val).trim().toUpperCase();
  return s === "TRUE" || s === "1" || s === "YES";
}

function getProp_(key, required) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (required && (!v || v.indexOf("PASTE_YOUR") === 0)) {
    throw new Error(`尚未設定 Script Property「${key}」，請至專案設定填入`);
  }
  return v || "";
}

/** 極簡快取版 sheetToObjects_，用於高頻讀取（畫廊列表、故事投票輪詢等），
 *  寫入後務必呼叫 invalidateCache_ 清除，快取只是加速，不是唯一資料來源。 */
function cachedSheetObjects_(sheetName, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  const key = "SHEETOBJ_" + sheetName;
  try {
    const cached = cache.get(key);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* 快取讀取失敗就直接查表，不影響正確性 */ }

  const objs = sheetToObjects_(getSheet_(sheetName));
  try {
    const json = JSON.stringify(objs);
    if (json.length < 95000) cache.put(key, json, ttlSeconds || 20);
  } catch (e) { /* 資料太大存不進快取就算了 */ }
  return objs;
}

function invalidateCache_(sheetName) {
  try { CacheService.getScriptCache().remove("SHEETOBJ_" + sheetName); } catch (e) { /* ignore */ }
}

function uuid_() { return Utilities.getUuid(); }

function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function timingSafeEqual_(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normalizeNickname_(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

function sanitizeFileNamePart_(s) {
  return String(s || "user").replace(/[^\w\u4e00-\u9fa5]/g, "_").slice(0, 40) || "user";
}

/* =========================================================================
   Settings（可調全域設定）
   ========================================================================= */

function getSettings_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("SETTINGS_V1");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough */ }
  }
  let map = {};
  try {
    const rows = sheetToObjects_(getSheet_(CONFIG.SHEET_SETTINGS));
    rows.forEach((r) => { map[String(r.Key)] = r.Value; });
  } catch (e) { /* Settings 分頁還沒建立時，直接用預設值 */ }
  const merged = Object.assign({}, DEFAULT_SETTINGS, map);
  cache.put("SETTINGS_V1", JSON.stringify(merged), 300);
  return merged;
}

function settingNum_(settings, key) {
  const v = Number(settings[key]);
  return isFinite(v) ? v : DEFAULT_SETTINGS[key];
}

/* =========================================================================
   Google Identity 驗證 + 網站自己的 Session Token
   ========================================================================= */

/** 使用 Google 官方 tokeninfo 端點驗證 ID Token 的簽章、aud、iss、exp、email_verified。
 *  Apps Script 沒有內建 RSA 簽章驗證，官方文件建議在此情境下改用這個端點，
 *  由 Google 伺服器端完成簽章驗證，我們仍必須自行檢查 aud/iss/exp/email_verified。 */
function verifyGoogleIdToken_(idToken) {
  if (!idToken) throw new Error("缺少 Google 登入憑證");
  const resp = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) throw new Error("Google 登入驗證失敗，請重新登入");
  const data = JSON.parse(resp.getContentText());

  const clientId = getProp_("GOOGLE_CLIENT_ID", true);
  if (!data.aud || data.aud !== clientId) throw new Error("憑證的 aud 與網站設定不符");
  if (data.iss !== "accounts.google.com" && data.iss !== "https://accounts.google.com") {
    throw new Error("憑證的 iss 不是 Google");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (!data.exp || Number(data.exp) <= nowSec) throw new Error("憑證已過期，請重新登入");
  if (data.email_verified !== "true" && data.email_verified !== true) {
    throw new Error("此 Google 帳號的 Email 尚未驗證");
  }
  if (!data.sub) throw new Error("憑證缺少使用者識別碼");

  return { sub: String(data.sub), email: String(data.email || "") };
}

function signSessionToken_(payloadObj) {
  const secret = getProp_("SESSION_SECRET", true);
  const payloadStr = JSON.stringify(payloadObj);
  const payloadB64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(payloadStr).getBytes());
  const sigBytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  const sigB64 = Utilities.base64EncodeWebSafe(sigBytes);
  return payloadB64 + "." + sigB64;
}

function issueSessionToken_(user) {
  return signSessionToken_({
    uid: user.UserID,
    sv: Number(user.SessionVersion || 1),
    exp: Date.now() + CONFIG.SESSION_TTL_MS,
  });
}

/** 驗證 session token：檢查簽章防竄改、檢查是否過期、檢查 SessionVersion 是否仍相符
 *  （老師停用帳號或使用者登出時只要 bump SessionVersion，所有舊 token 立刻失效）。
 *  驗證失敗一律回傳 null，不丟例外，方便呼叫端自行決定要不要視為「未登入」。 */
function verifySessionToken_(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let secret;
  try { secret = getProp_("SESSION_SECRET", true); } catch (e) { return null; }
  const expectedSig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payloadB64, secret));
  if (!timingSafeEqual_(expectedSig, sigB64)) return null;

  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString());
  } catch (e) { return null; }
  if (!payload || !payload.uid || !payload.exp) return null;
  if (Date.now() > Number(payload.exp)) return null;

  const user = findUserById_(payload.uid);
  if (!user) return null;
  if (Number(user.SessionVersion || 0) !== Number(payload.sv || 0)) return null;
  return user;
}

function requireAuthUser_(body) {
  const user = verifySessionToken_(body && body.sessionToken);
  if (!user) throw new Error("請先登入");
  return user;
}

function requireActiveUser_(body) {
  const user = requireAuthUser_(body);
  const status = String(user.Status || "").trim().toLowerCase();
  if (status === "pending") throw new Error("你的帳號正在等待老師審核，審核通過後才能使用此功能");
  if (status !== "active") throw new Error("你的帳號目前無法使用此功能，請聯絡老師確認狀態");
  return user;
}

function sanitizeUserForClient_(user) {
  return {
    userId: user.UserID,
    nickname: user.Nickname,
    className: user.ClassName,
    status: String(user.Status || ""),
    role: user.Role || "student",
    quotaMode: user.QuotaMode || "count",
    quotaLimit: user.QuotaLimit,
    characterSheet: user.CharacterSheet || "",
  };
}

/* =========================================================================
   AuthorizedUsers 存取
   ========================================================================= */

function findUserByGoogleSub_(sub) {
  const users = cachedSheetObjects_(CONFIG.SHEET_USERS, 15);
  return users.find((u) => String(u.GoogleSub) === String(sub)) || null;
}

function findUserById_(userId) {
  const users = cachedSheetObjects_(CONFIG.SHEET_USERS, 15);
  return users.find((u) => String(u.UserID) === String(userId)) || null;
}

function nicknameTakenInClass_(className, nickname, excludeUserId) {
  const norm = normalizeNickname_(nickname).toLowerCase();
  const users = sheetToObjects_(getSheet_(CONFIG.SHEET_USERS));
  return users.some((u) => {
    if (excludeUserId && String(u.UserID) === String(excludeUserId)) return false;
    if (String(u.ClassName).trim() !== String(className).trim()) return false;
    return normalizeNickname_(u.Nickname).toLowerCase() === norm;
  });
}

/* =========================================================================
   Auth actions
   ========================================================================= */

function handleAuthLogin_(body) {
  const { sub } = verifyGoogleIdToken_(body.idToken);
  const user = findUserByGoogleSub_(sub);
  if (!user) return jsonOut_({ needsRegistration: true });
  const sessionToken = issueSessionToken_(user);
  return jsonOut_({ sessionToken, user: sanitizeUserForClient_(user) });
}

function handleAuthRegister_(body) {
  const { sub, email } = verifyGoogleIdToken_(body.idToken);

  const existing = findUserByGoogleSub_(sub);
  if (existing) {
    // 這個 Google 帳號其實已經申請過了，直接視同登入，避免重複建立帳號
    const sessionToken = issueSessionToken_(existing);
    return jsonOut_({ sessionToken, user: sanitizeUserForClient_(existing) });
  }

  const studentName = String(body.studentName || "").trim().slice(0, 40);
  const className = String(body.className || "").trim().slice(0, 40);
  const nickname = normalizeNickname_(body.nickname).slice(0, 40);

  if (!studentName) throw new Error("請填寫真實姓名");
  if (!className) throw new Error("請填寫班級");
  if (!nickname) throw new Error("請填寫暱稱");
  if (nicknameTakenInClass_(className, nickname, null)) {
    throw new Error("這個暱稱在你的班級裡已經有人使用了，請換一個暱稱");
  }

  const settings = getSettings_();
  const now = new Date();
  const userId = uuid_();
  const usersSheet = getSheet_(CONFIG.SHEET_USERS);
  appendObjectRow_(usersSheet, {
    UserID: userId,
    GoogleSub: sub,
    Email: email,
    StudentName: studentName,
    Nickname: nickname,
    ClassName: className,
    Role: "student",
    Status: "Pending",
    ArtworkAutoApprove: false,
    QuotaMode: "count",
    QuotaLimit: settingNum_(settings, "AI_DEFAULT_QUOTA_LIMIT"),
    ResetHour: settingNum_(settings, "AI_DEFAULT_RESET_HOUR"),
    SessionVersion: 1,
    CreatedAt: now,
    ApprovedAt: "",
  });
  invalidateCache_(CONFIG.SHEET_USERS);

  const user = findUserByGoogleSub_(sub); // 重新讀取（快取已清）確保拿到完整列
  const sessionToken = issueSessionToken_(user);
  return jsonOut_({ sessionToken, user: sanitizeUserForClient_(user) });
}

function handleAuthMe_(body) {
  const user = verifySessionToken_(body && body.sessionToken);
  if (!user) return jsonOut_({ loggedIn: false });
  return jsonOut_({ loggedIn: true, user: sanitizeUserForClient_(user) });
}

function handleAuthUpdateNickname_(body) {
  const user = requireActiveUser_(body);
  const nickname = normalizeNickname_(body.nickname).slice(0, 40);
  if (!nickname) throw new Error("暱稱不能是空的");
  if (nicknameTakenInClass_(user.ClassName, nickname, user.UserID)) {
    throw new Error("這個暱稱在你的班級裡已經有人使用了，請換一個暱稱");
  }

  const usersSheet = getSheet_(CONFIG.SHEET_USERS);
  const rowNum = findRowByValue_(usersSheet, "UserID", user.UserID);
  if (rowNum === -1) throw new Error("找不到你的帳號資料");
  updateObjectRow_(usersSheet, rowNum, { Nickname: nickname });
  invalidateCache_(CONFIG.SHEET_USERS);

  // 同步更新這個使用者名下所有作品的暱稱快照，讓畫廊顯示跟著更新
  const artworksSheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  const nickCol = colIndex_(artworksSheet, "Nickname");
  const ownerCol = colIndex_(artworksSheet, "OwnerUserID");
  const lastRow = artworksSheet.getLastRow();
  if (lastRow >= 2) {
    const owners = artworksSheet.getRange(2, ownerCol, lastRow - 1, 1).getValues();
    owners.forEach((row, i) => {
      if (String(row[0]) === String(user.UserID)) {
        artworksSheet.getRange(i + 2, nickCol).setValue(nickname);
      }
    });
  }
  invalidateCache_(CONFIG.SHEET_ARTWORKS);

  const updated = findUserById_(user.UserID);
  return jsonOut_({ success: true, user: sanitizeUserForClient_(updated) });
}

/** 儲存學生的「角色設定小抄」（AI 作圖用，讓同一個角色在故事的不同頁面盡量長得一樣）。
 *  存在 AuthorizedUsers 這個人自己的那一列，之後每次 AI 作圖頁載入都會自動帶出來。 */
function handleAuthUpdateCharacterSheet_(body) {
  const user = requireActiveUser_(body);
  const characterSheet = String(body.characterSheet || "").trim().slice(0, 800);

  const usersSheet = getSheet_(CONFIG.SHEET_USERS);
  const rowNum = findRowByValue_(usersSheet, "UserID", user.UserID);
  if (rowNum === -1) throw new Error("找不到你的帳號資料");
  updateObjectRow_(usersSheet, rowNum, { CharacterSheet: characterSheet });
  invalidateCache_(CONFIG.SHEET_USERS);

  const updated = findUserById_(user.UserID);
  return jsonOut_({ success: true, user: sanitizeUserForClient_(updated) });
}

function handleAuthLogout_(body) {
  const user = requireAuthUser_(body);
  const usersSheet = getSheet_(CONFIG.SHEET_USERS);
  const rowNum = findRowByValue_(usersSheet, "UserID", user.UserID);
  if (rowNum !== -1) {
    updateObjectRow_(usersSheet, rowNum, { SessionVersion: Number(user.SessionVersion || 1) + 1 });
    invalidateCache_(CONFIG.SHEET_USERS);
  }
  return jsonOut_({ success: true });
}

/* =========================================================================
   Artworks 可視範圍與圖片來源
   ========================================================================= */

const VISIBILITY_VALUES = ["public", "gallery_only", "private"];

function normalizeVisibility_(v) {
  const s = String(v || "public").trim().toLowerCase();
  return VISIBILITY_VALUES.includes(s) ? s : "public";
}

/** 這個作品目前能不能給這個使用者（可能是 null=訪客）看到完整內容/圖片 */
function isArtworkViewableBy_(art, user) {
  const vis = normalizeVisibility_(art.Visibility);
  if (vis !== "private") return true;
  return !!user && String(art.OwnerUserID) === String(user.UserID);
}

/** 對外公開（畫廊 / 訪客）呈現用的欄位，絕不包含 StudentName / Email / GoogleSub / OwnerUserID / DriveFileID */
function sanitizeArtworkPublic_(a) {
  return {
    ID: a.ID,
    Timestamp: a.Timestamp,
    ClassName: a.ClassName,
    DisplayName: a.Nickname || a.StudentName || "匿名",
    ImageURL: a.ImageURL || "",
    DriveBackupURL: a.DriveBackupURL || "",
    Prompt: a.Prompt || "",
    Description: a.Description || "",
    AITool: a.AITool || "",
    Tags: a.Tags || "",
    Likes: Number(a.Likes || 0),
    Visibility: normalizeVisibility_(a.Visibility),
    AllowStory: parseBoolean_(a.AllowStory),
  };
}

/** 給作品擁有者自己看的版本（我的投稿列表 / 素材庫裡的「我的」項目），多帶 needsProxy 供前端建構私人圖片網址 */
function sanitizeArtworkOwnerView_(a, user) {
  const base = sanitizeArtworkPublic_(a);
  base.OwnerUserID = a.OwnerUserID;
  base.Approved = parseBoolean_(a.Approved);
  base.isMine = !!user && String(a.OwnerUserID) === String(user.UserID);
  base.needsProxy = base.Visibility === "private" && !base.ImageURL;
  base.canGoPrivate = !!a.DriveFileID; // 透過網址匯入（無 DriveFileID）的作品無法設為私人
  return base;
}

function getArtworksAll_() {
  return cachedSheetObjects_(CONFIG.SHEET_ARTWORKS, 15);
}

/* -------------------------------------------------------------------------
   doGet action=list：公開畫廊清單（public + gallery_only 且 Approved）
   ------------------------------------------------------------------------- */
function handleListPublic_() {
  const all = getArtworksAll_();
  const visible = all
    .filter((a) => parseBoolean_(a.Approved))
    .filter((a) => {
      const vis = normalizeVisibility_(a.Visibility);
      return vis === "public" || vis === "gallery_only";
    })
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .map(sanitizeArtworkPublic_);
  return jsonOut_({ artworks: visible });
}

/* -------------------------------------------------------------------------
   materialLibrary（登入後）：public 已核准作品 + 自己名下所有作品（任何可見度/審核狀態）
   ------------------------------------------------------------------------- */
function handleMaterialLibrary_(body) {
  const user = requireActiveUser_(body);
  const all = getArtworksAll_();
  const result = all
    .filter((a) => {
      const isMine = String(a.OwnerUserID) === String(user.UserID);
      if (isMine) return true;
      const vis = normalizeVisibility_(a.Visibility);
      return parseBoolean_(a.Approved) && vis === "public";
    })
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .map((a) => sanitizeArtworkOwnerView_(a, user));
  return jsonOut_({ artworks: result });
}

function handleListMine_(body) {
  const user = requireActiveUser_(body);
  const all = getArtworksAll_();
  const mine = all
    .filter((a) => String(a.OwnerUserID) === String(user.UserID))
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .map((a) => sanitizeArtworkOwnerView_(a, user));
  return jsonOut_({ artworks: mine });
}

/* -------------------------------------------------------------------------
   POST action=image/get：私人圖片內容（改走 POST + base64，doGet 不能直接回傳 Blob）
   ------------------------------------------------------------------------- */
/**
 * 重要更正：Apps Script 的 doGet/doPost 只能回傳 HtmlOutput 或 TextOutput，
 * 直接 return 一個 Blob 會出現「指令碼已完成，但傳回值的類型不是支援的傳回類型」
 * 這個錯誤（實測證實，網路上很多教學誤傳可以直接回傳 Blob，並不正確）。
 * 因此私人圖片一律改成：前端用一般的 POST 呼叫（帶 sessionToken）換回
 * base64 圖片內容 + mimeType，前端再組成 data: URI 設定給 <img> 的 src。
 */
/**
 * 重要更正 v2：連 setSharing()／getBlob() 都出現「Access denied: DriveApp.」，
 * 即使是剛剛才用 folder.createFile() 建立、還沒被別的程式碼碰過的檔案也一樣失敗
 * ——代表問題不是「建立 vs 存取既有檔案」，而是內建 DriveApp 服務本身在這個專案的
 * 執行環境裡，管理分享權限／讀取內容這幾個方法會被擋下來。
 *
 * 解法：改用「進階 Drive API 服務」（左側「服務」＋ Drive API，選 v3）呼叫同樣的功能，
 * 這是完全不同的呼叫路徑（直接呼叫 Drive REST API v3），繞過內建 DriveApp 封裝。
 * 檔案的「建立」仍然用 DriveApp.folder.createFile()（這個操作本來就正常運作），
 * 只有「讀取內容」「修改分享權限」這兩件事改走 Drive 進階服務。
 */
function getDriveFileBlob_(driveFileId) {
  return Drive.Files.get(driveFileId, { alt: "media" });
}

/** 幫某個檔案設定「任何知道連結的人都能檢視（不能編輯）」的分享權限（進階 Drive API 版本） */
function makeDriveFileViewableByLink_(driveFileId) {
  try {
    Drive.Permissions.create({ role: "reader", type: "anyone" }, driveFileId);
  } catch (e) {
    // 可能已經有一樣的分享設定存在，屬於正常情況，忽略即可
  }
}

/** 移除某個檔案所有「anyone（知道連結的任何人）」類型的分享權限，只留擁有者自己看得到 */
function makeDriveFilePrivate_(driveFileId) {
  const res = Drive.Permissions.list(driveFileId, { fields: "permissions(id,type)" });
  (res.permissions || []).forEach((p) => {
    if (p.type === "anyone") {
      try { Drive.Permissions.remove(driveFileId, p.id); } catch (e) { /* 移除失敗（例如已經被移除過）忽略即可 */ }
    }
  });
}

function handleImageGet_(body) {
  const artworkId = String(body.artworkId || "");
  if (!artworkId) throw new Error("缺少 artworkId");

  const all = getArtworksAll_();
  const art = all.find((a) => String(a.ID) === artworkId);
  if (!art) throw new Error("找不到這件作品");
  if (!art.DriveFileID) throw new Error("這件作品沒有可代理的圖片");

  const vis = normalizeVisibility_(art.Visibility);
  if (vis === "private") {
    const user = requireActiveUser_(body);
    if (String(user.UserID) !== String(art.OwnerUserID)) {
      throw new Error("沒有權限查看這張私人圖片");
    }
  }

  try {
    const blob = getDriveFileBlob_(art.DriveFileID);
    return jsonOut_({
      success: true,
      base64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType() || "image/png",
    });
  } catch (e) {
    throw new Error("圖片讀取失敗：" + e.message);
  }
}

/* =========================================================================
   投稿 / 圖片上傳 / 隱私設定
   ========================================================================= */

function guessExtension_(contentType) {
  if (!contentType) return "jpg";
  if (contentType.indexOf("png") !== -1) return "png";
  if (contentType.indexOf("gif") !== -1) return "gif";
  if (contentType.indexOf("webp") !== -1) return "webp";
  return "jpg";
}

function getBackupFolder_() {
  const folderId = getProp_("DRIVE_BACKUP_FOLDER_ID", true);
  return DriveApp.getFolderById(folderId);
}

/** 把外部圖片網址抓下來存進 Drive（給網址匯入相容流程與舊投稿方式使用）。永遠設為公開可檢視，
 *  因為透過網址匯入的圖片本來就已經有一個外部可公開存取的原始連結，設為私人並無意義且會誤導使用者。 */
function backupUrlToDrive_(imageUrl, ownerLabel) {
  const response = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error("無法下載圖片，HTTP " + response.getResponseCode());
  const blob = response.getBlob();
  const folder = getBackupFolder_();
  const fileName = sanitizeFileNamePart_(ownerLabel) + "_" + Date.now() + "." + guessExtension_(blob.getContentType());
  const file = folder.createFile(blob).setName(fileName);
  makeDriveFileViewableByLink_(file.getId());
  return { driveFileId: file.getId(), publicUrl: "https://drive.google.com/uc?export=view&id=" + file.getId() };
}

/** 把使用者上傳的 base64 圖片存進 Drive；visibility='private' 時完全不設公開分享權限 */
function uploadBase64ToDrive_(base64Data, mimeType, ownerLabel, visibility) {
  if (!mimeType || mimeType.indexOf("image/") !== 0) throw new Error("檔案類型不是圖片");
  let bytes;
  try {
    bytes = Utilities.base64Decode(base64Data);
  } catch (e) {
    throw new Error("圖片資料格式錯誤");
  }
  const MAX_BYTES = 9 * 1024 * 1024;
  if (bytes.length > MAX_BYTES) throw new Error("圖片檔案太大，請壓縮到 9MB 以內再上傳");

  const ext = guessExtension_(mimeType);
  const fileName = sanitizeFileNamePart_(ownerLabel) + "_" + Date.now() + "." + ext;
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const folder = getBackupFolder_();
  const file = folder.createFile(blob);

  let publicUrl = "";
  if (visibility !== "private") {
    makeDriveFileViewableByLink_(file.getId());
    publicUrl = "https://drive.google.com/uc?export=view&id=" + file.getId();
  }
  return { driveFileId: file.getId(), publicUrl };
}

function setDriveFileSharing_(driveFileId, visibility) {
  if (!driveFileId) return "";
  if (visibility === "private") {
    makeDriveFilePrivate_(driveFileId);
    return "";
  }
  makeDriveFileViewableByLink_(driveFileId);
  return "https://drive.google.com/uc?export=view&id=" + driveFileId;
}

function handleSubmit_(body) {
  const user = requireActiveUser_(body);

  const visibility = normalizeVisibility_(body.visibility);
  const aiTool = String(body.aiTool || "").trim().slice(0, 60);
  const prompt = String(body.prompt || "").trim().slice(0, 4000);
  const description = String(body.description || "").trim().slice(0, 4000);
  const tags = String(body.tags || "").trim().slice(0, 400);
  const imageMode = body.imageMode === "url" ? "url" : "upload";

  if (imageMode === "url" && visibility === "private") {
    throw new Error("透過網址匯入的圖片本身就有一個公開連結，無法設為「私人」，請改選「僅畫廊」或「公開」");
  }

  let imageUrl = "";
  let driveFileId = "";
  let backupUrl = "";

  if (imageMode === "url") {
    const url = String(body.imageUrl || "").trim();
    if (!url) throw new Error("請貼上圖片網址");
    imageUrl = url;
    try {
      const backed = backupUrlToDrive_(url, user.Nickname);
      driveFileId = backed.driveFileId;
      backupUrl = backed.publicUrl;
    } catch (e) {
      backupUrl = ""; // 備份失敗不擋投稿
    }
  } else {
    const base64Data = String(body.imageBase64 || "");
    const mimeType = String(body.mimeType || "");
    if (!base64Data) throw new Error("請選擇要上傳的圖片");
    const uploaded = uploadBase64ToDrive_(base64Data, mimeType, user.Nickname, visibility);
    driveFileId = uploaded.driveFileId;
    imageUrl = uploaded.publicUrl;
  }

  const allowStory = visibility === "public" ? !!body.allowStory : false;
  const autoApprove = parseBoolean_(user.ArtworkAutoApprove);
  const approved = visibility === "private" ? false : autoApprove;

  const artworksSheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  const id = uuid_();
  appendObjectRow_(artworksSheet, {
    ID: id,
    Timestamp: new Date(),
    StudentName: user.StudentName,
    ClassName: user.ClassName,
    ImageURL: imageUrl,
    DriveBackupURL: backupUrl,
    Prompt: prompt,
    Description: description,
    AITool: aiTool,
    Tags: tags,
    Likes: 0,
    Approved: approved,
    OwnerUserID: user.UserID,
    Nickname: user.Nickname,
    DriveFileID: driveFileId,
    Visibility: visibility,
    AllowStory: allowStory,
    Source: "User",
  });
  invalidateCache_(CONFIG.SHEET_ARTWORKS);

  return jsonOut_({ success: true, id, approved, visibility });
}

function handleUpdateVisibility_(body) {
  const user = requireActiveUser_(body);
  const artworkId = String(body.artworkId || "");
  if (!artworkId) throw new Error("缺少 artworkId");

  const artworksSheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  const all = sheetToObjects_(artworksSheet);
  const art = all.find((a) => String(a.ID) === artworkId);
  if (!art) throw new Error("找不到這件作品");
  if (String(art.OwnerUserID) !== String(user.UserID)) throw new Error("沒有權限修改別人的作品");

  const oldVisibility = normalizeVisibility_(art.Visibility);
  const newVisibility = normalizeVisibility_(body.visibility);
  const newAllowStory = newVisibility === "public" ? !!body.allowStory : false;

  if (newVisibility === "private" && !art.DriveFileID) {
    throw new Error("這件作品是透過網址匯入的，原始網址仍可公開存取，無法設為私人");
  }

  const rowNum = findRowByValue_(artworksSheet, "ID", artworkId);
  if (rowNum === -1) throw new Error("找不到這件作品");

  const update = { Visibility: newVisibility, AllowStory: newAllowStory };

  if (art.DriveFileID) {
    update.ImageURL = setDriveFileSharing_(art.DriveFileID, newVisibility);
  }

  // 只有「私人 → 非私人」才需要重新走一次審核流程；在 public/gallery_only 之間互換不影響審核狀態
  if (oldVisibility === "private" && newVisibility !== "private") {
    update.Approved = parseBoolean_(user.ArtworkAutoApprove);
  }

  updateObjectRow_(artworksSheet, rowNum, update);
  invalidateCache_(CONFIG.SHEET_ARTWORKS);

  const updatedAll = sheetToObjects_(artworksSheet);
  const updatedArt = updatedAll.find((a) => String(a.ID) === artworkId);
  return jsonOut_({ success: true, artwork: sanitizeArtworkOwnerView_(updatedArt, user) });
}

/* -------------------------------------------------------------------------
   Like / Comment（公開功能，畫廊瀏覽不需登入）
   ------------------------------------------------------------------------- */
function handleLike_(body) {
  const artworkId = body.artworkId;
  if (!artworkId) return jsonOut_({ error: "缺少 artworkId" });

  const sheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  const rowNum = findRowByValue_(sheet, "ID", artworkId);
  if (rowNum === -1) return jsonOut_({ error: "找不到對應的作品 ID" });

  const likesCol = colIndex_(sheet, "Likes");
  const cell = sheet.getRange(rowNum, likesCol);
  const updated = (Number(cell.getValue()) || 0) + 1;
  cell.setValue(updated);
  invalidateCache_(CONFIG.SHEET_ARTWORKS);

  return jsonOut_({ success: true, likes: updated });
}

function handleComment_(body) {
  const artworkId = body.artworkId;
  const commenterName = String(body.commenterName || "").trim().slice(0, 40);
  const comment = String(body.comment || "").trim().slice(0, 400);
  if (!artworkId || !commenterName || !comment) {
    return jsonOut_({ error: "缺少必要欄位（artworkId / commenterName / comment）" });
  }
  const sheet = getSheet_(CONFIG.SHEET_COMMENTS);
  appendObjectRow_(sheet, { ArtworkID: artworkId, CommenterName: commenterName, Comment: comment, Timestamp: new Date() });
  return jsonOut_({ success: true });
}

function handleComments_(artworkId) {
  if (!artworkId) return jsonOut_({ error: "缺少 artworkId 參數" });
  const all = sheetToObjects_(getSheet_(CONFIG.SHEET_COMMENTS));
  const comments = all
    .filter((c) => String(c.ArtworkID) === String(artworkId))
    .sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp))
    .map((c) => ({ CommenterName: c.CommenterName, Comment: c.Comment, Timestamp: c.Timestamp }));
  return jsonOut_({ comments });
}

/* =========================================================================
   故事接龍投票（每班獨立輪次 / 候選 / 結算 / 榮譽榜）
   ========================================================================= */

const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

function getNextRolloverIso_(fromDate, hour) {
  const taipeiMs = fromDate.getTime() + TAIPEI_OFFSET_MS;
  const t = new Date(taipeiMs);
  const y = t.getUTCFullYear(), m = t.getUTCMonth(), d = t.getUTCDate();
  let candidateUtcMs = Date.UTC(y, m, d, hour, 0, 0) - TAIPEI_OFFSET_MS;
  if (candidateUtcMs <= fromDate.getTime()) candidateUtcMs += 24 * 3600 * 1000;
  return new Date(candidateUtcMs).toISOString();
}

function getStoryRoundsAll_() { return sheetToObjects_(getSheet_(CONFIG.SHEET_STORY_ROUNDS)); }
function getStoryVotesAll_() { return sheetToObjects_(getSheet_(CONFIG.SHEET_STORY_VOTES)); }
function getHonorBoardAll_() { return sheetToObjects_(getSheet_(CONFIG.SHEET_HONOR_BOARD)); }

function findOpenRoundForClass_(className) {
  const rounds = getStoryRoundsAll_();
  const open = rounds.filter((r) => String(r.ClassName) === String(className) && String(r.Status) === "open");
  if (!open.length) return null;
  // 理論上每班同時只會有一個 open round；若異常出現多筆，取最新開的那筆
  open.sort((a, b) => new Date(b.StartedAt) - new Date(a.StartedAt));
  return open[0];
}

function classAlreadyHonoredArtworkIds_(className) {
  const rows = getHonorBoardAll_().filter((r) => String(r.ClassName) === String(className));
  return new Set(rows.map((r) => String(r.ArtworkID)));
}

/** 若該班沒有進行中的輪次，且還有可用素材，就開新的一輪；回傳目前（可能剛開好的）open round，
 *  素材不足時回傳 null。 */
function ensureRoundForClass_(className) {
  const existing = findOpenRoundForClass_(className);
  if (existing) return existing;

  const settings = getSettings_();
  const already = classAlreadyHonoredArtworkIds_(className);
  const pool = getArtworksAll_().filter((a) =>
    String(a.ClassName) === String(className) &&
    parseBoolean_(a.Approved) &&
    normalizeVisibility_(a.Visibility) === "public" &&
    parseBoolean_(a.AllowStory) &&
    !already.has(String(a.ID))
  );
  if (!pool.length) return null;

  const perRound = settingNum_(settings, "STORY_CANDIDATES_PER_ROUND");
  const candidates = shuffle_(pool).slice(0, Math.max(1, perRound)).map((a) => String(a.ID));

  const roundsSheet = getSheet_(CONFIG.SHEET_STORY_ROUNDS);
  const roundId = uuid_();
  const now = new Date();
  appendObjectRow_(roundsSheet, {
    RoundID: roundId,
    ClassName: className,
    Status: "open",
    CandidateIDsJSON: JSON.stringify(candidates),
    StartedAt: now,
    EndsAt: "",
    ClosedAt: "",
  });
  return { RoundID: roundId, ClassName: className, Status: "open", CandidateIDsJSON: JSON.stringify(candidates), StartedAt: now.toISOString() };
}

/** 結算某班目前進行中的輪次：計票、依規則決定名次、寫入榮譽榜、關閉輪次，然後嘗試開下一輪。
 *  同票規則：Votes desc → 作品 Timestamp asc → ArtworkID asc（結果固定，不含隨機成份）。 */
function finalizeRoundForClass_(className) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const round = findOpenRoundForClass_(className);
    if (!round) { ensureRoundForClass_(className); return; }

    const candidateIds = JSON.parse(round.CandidateIDsJSON || "[]").map(String);
    const votes = getStoryVotesAll_().filter((v) => String(v.RoundID) === String(round.RoundID));
    const voteCount = {};
    candidateIds.forEach((id) => { voteCount[id] = 0; });
    votes.forEach((v) => {
      const id = String(v.ArtworkID);
      if (Object.prototype.hasOwnProperty.call(voteCount, id)) voteCount[id] += 1;
    });

    const artworksById = {};
    getArtworksAll_().forEach((a) => { artworksById[String(a.ID)] = a; });

    const ranked = candidateIds
      .filter((id) => artworksById[id])
      .sort((a, b) => {
        if (voteCount[b] !== voteCount[a]) return voteCount[b] - voteCount[a];
        const ta = new Date(artworksById[a].Timestamp).getTime();
        const tb = new Date(artworksById[b].Timestamp).getTime();
        if (ta !== tb) return ta - tb;
        return a < b ? -1 : a > b ? 1 : 0;
      });

    const top3 = ranked.slice(0, 3);
    const honorSheet = getSheet_(CONFIG.SHEET_HONOR_BOARD);
    const closedAt = new Date();
    top3.forEach((id, i) => {
      appendObjectRow_(honorSheet, {
        RoundID: round.RoundID,
        ClassName: className,
        Rank: i + 1,
        ArtworkID: id,
        Votes: voteCount[id] || 0,
        ClosedAt: closedAt,
      });
    });

    const roundsSheet = getSheet_(CONFIG.SHEET_STORY_ROUNDS);
    const rowNum = findRowByValue_(roundsSheet, "RoundID", round.RoundID);
    if (rowNum !== -1) updateObjectRow_(roundsSheet, rowNum, { Status: "closed", ClosedAt: closedAt });

    ensureRoundForClass_(className);
  } finally {
    lock.releaseLock();
  }
}

function finalizeAllOpenRounds_() {
  const classNames = Array.from(new Set(sheetToObjects_(getSheet_(CONFIG.SHEET_USERS)).map((u) => String(u.ClassName).trim()).filter(Boolean)));
  classNames.forEach((cn) => {
    try { finalizeRoundForClass_(cn); } catch (e) { Logger.log("結算「" + cn + "」失敗：" + e.message); }
  });
}

function buildRoundPayload_(round, user) {
  if (!round) return null;
  const settings = getSettings_();
  const candidateIds = JSON.parse(round.CandidateIDsJSON || "[]").map(String);
  const artworksById = {};
  getArtworksAll_().forEach((a) => { artworksById[String(a.ID)] = a; });

  const votes = getStoryVotesAll_().filter((v) => String(v.RoundID) === String(round.RoundID));
  const voteCount = {};
  candidateIds.forEach((id) => { voteCount[id] = 0; });
  votes.forEach((v) => {
    const id = String(v.ArtworkID);
    if (Object.prototype.hasOwnProperty.call(voteCount, id)) voteCount[id] += 1;
  });
  const myVote = votes.find((v) => String(v.UserID) === String(user.UserID));

  const candidates = candidateIds
    .map((id) => artworksById[id])
    .filter(Boolean)
    .map((a) => ({
      artworkId: String(a.ID),
      nickname: a.Nickname || a.StudentName || "匿名",
      imageUrl: a.ImageURL,
      voteCount: voteCount[String(a.ID)] || 0,
      isMine: String(a.OwnerUserID) === String(user.UserID),
    }));

  return {
    roundId: round.RoundID,
    startedAt: round.StartedAt,
    estimatedEndsAt: getNextRolloverIso_(new Date(round.StartedAt), settingNum_(settings, "STORY_DAILY_ROLLOVER_HOUR")),
    candidates,
    myVoteArtworkId: myVote ? String(myVote.ArtworkID) : "",
  };
}

function buildHonorBoardPayload_(className) {
  const rows = getHonorBoardAll_().filter((r) => String(r.ClassName) === String(className));
  const artworksById = {};
  getArtworksAll_().forEach((a) => { artworksById[String(a.ID)] = a; });

  const byRound = {};
  rows.forEach((r) => {
    const key = String(r.RoundID);
    if (!byRound[key]) byRound[key] = { roundId: key, closedAt: r.ClosedAt, entries: [] };
    const art = artworksById[String(r.ArtworkID)];
    byRound[key].entries.push({
      rank: Number(r.Rank),
      artworkId: String(r.ArtworkID),
      votes: Number(r.Votes),
      nickname: art ? (art.Nickname || art.StudentName || "匿名") : "（作品已不存在）",
      imageUrl: art ? art.ImageURL : "",
    });
  });

  return Object.values(byRound)
    .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
    .slice(0, 12)
    .map((r) => Object.assign({}, r, { entries: r.entries.sort((a, b) => a.rank - b.rank) }));
}

function handleStoryGetRound_(body) {
  const user = requireActiveUser_(body);
  const round = ensureRoundForClass_(user.ClassName);
  return jsonOut_({
    round: buildRoundPayload_(round, user),
    honorBoard: buildHonorBoardPayload_(user.ClassName),
  });
}

function handleStoryGetHonorBoard_(body) {
  const user = requireActiveUser_(body);
  return jsonOut_({ honorBoard: buildHonorBoardPayload_(user.ClassName) });
}

function handleStoryVote_(body) {
  const user = requireActiveUser_(body);
  const artworkId = String(body.artworkId || "");

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const round = findOpenRoundForClass_(user.ClassName);
    if (!round) throw new Error("目前沒有進行中的投票輪次");
    const candidateIds = JSON.parse(round.CandidateIDsJSON || "[]").map(String);

    if (artworkId) {
      if (!candidateIds.includes(artworkId)) throw new Error("這一輪投票已經結束囉，頁面即將更新，請重新整理再投一次");
      const art = getArtworksAll_().find((a) => String(a.ID) === artworkId);
      if (art && String(art.OwnerUserID) === String(user.UserID)) throw new Error("不能投給自己的作品");
    }

    const votesSheet = getSheet_(CONFIG.SHEET_STORY_VOTES);
    const existing = rowsWithLineNumbers_(votesSheet).find(
      (r) => String(r.obj.RoundID) === String(round.RoundID) && String(r.obj.UserID) === String(user.UserID)
    );

    if (!existing) {
      if (artworkId) {
        appendObjectRow_(votesSheet, { RoundID: round.RoundID, UserID: user.UserID, ArtworkID: artworkId, UpdatedAt: new Date() });
      }
    } else if (artworkId) {
      updateObjectRow_(votesSheet, existing.rowNum, { ArtworkID: artworkId, UpdatedAt: new Date() });
    } else {
      votesSheet.deleteRow(existing.rowNum); // 收回投票
    }

    return jsonOut_({ success: true, round: buildRoundPayload_(round, user) });
  } finally {
    lock.releaseLock();
  }
}

/* 🔧 老師手動結算（在 Apps Script 編輯器函式選單執行）*/
function advanceStoryRoundForClass(className) { finalizeRoundForClass_(className); }
function advanceAllStoryRounds() { finalizeAllOpenRounds_(); }

function dailyStoryRollover() { finalizeAllOpenRounds_(); }

function installDailyStoryTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "dailyStoryRollover") ScriptApp.deleteTrigger(t);
  });
  const settings = getSettings_();
  ScriptApp.newTrigger("dailyStoryRollover")
    .timeBased()
    .atHour(settingNum_(settings, "STORY_DAILY_ROLLOVER_HOUR"))
    .everyDays(1)
    .create();
  Logger.log("✅ 已安裝每日故事接龍自動結算 trigger（Asia/Taipei，請確認專案時區設定正確）");
}

/**
 * 🔧 老師專用（選用功能，預設不會自動執行）：清理「AI 產圖但一直維持私人狀態」超過
 * Settings.STALE_PRIVATE_AI_DAYS 天（預設 60 天）的作品——同時刪除 Google Drive 上的
 * 原始檔案與 Artworks 分頁裡的那一列。
 *
 * 刻意只清理 Source="OpenAI" 的作品，不動任何「使用者自己上傳/網址匯入」的私人作品——
 * 因為 AI 測試圖大多是隨手產生、忘記處理的暫存內容，但使用者自己上傳的私人作品可能是
 * 特意想保留、不想公開的東西，不應該被系統自動刪除。
 *
 * 這個函式預設不會自動執行；要啟用請執行一次 installStaleImageCleanupTrigger()。
 * 也可以隨時手動執行 cleanupStalePrivateAiArtworks() 立即清一次。
 */
function cleanupStalePrivateAiArtworks() {
  const settings = getSettings_();
  const days = settingNum_(settings, "STALE_PRIVATE_AI_DAYS");
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const sheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  const rows = rowsWithLineNumbers_(sheet);
  let deletedCount = 0;

  // 從後面往前刪，避免刪除中間列造成後續列號位移的問題
  for (let i = rows.length - 1; i >= 0; i--) {
    const { rowNum, obj: art } = rows[i];
    if (normalizeVisibility_(art.Visibility) !== "private") continue;
    if (String(art.Source) !== "OpenAI") continue;
    const ts = new Date(art.Timestamp);
    if (isNaN(ts.getTime()) || ts > cutoff) continue;

    if (art.DriveFileID) {
      try { Drive.Files.update({ trashed: true }, art.DriveFileID); } catch (e) { /* 檔案可能已經被手動刪除，忽略 */ }
    }
    sheet.deleteRow(rowNum);
    deletedCount++;
  }

  invalidateCache_(CONFIG.SHEET_ARTWORKS);
  Logger.log(`✅ 清理完成：刪除了 ${deletedCount} 件超過 ${days} 天仍維持私人狀態的 AI 產圖`);
  return { success: true, deletedCount, days };
}

/** 啟用「每日自動清理過期私人 AI 產圖」（選用；不啟用的話 cleanupStalePrivateAiArtworks 只能手動執行）。
 *  可安全重複執行，會先移除舊的同名 trigger 再重新安裝，不會裝兩份。 */
function installStaleImageCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "cleanupStalePrivateAiArtworks") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cleanupStalePrivateAiArtworks").timeBased().everyDays(1).atHour(3).create();
  Logger.log("✅ 已安裝每日自動清理過期私人 AI 產圖的 trigger（每天凌晨 3 點執行一次）");
}

/** 🔧 老師專用：重置指定班級（或傳入空字串／不傳參數＝全部班級）的故事接龍狀態。
 *  只清除 StoryRounds / StoryVotes / HonorBoard，不動舊版 StoryChain（保留為 archive），
 *  也完全不影響 Artworks 本身。 */
function resetStoryForClass(className) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const roundsSheet = getSheet_(CONFIG.SHEET_STORY_ROUNDS);
    const votesSheet = getSheet_(CONFIG.SHEET_STORY_VOTES);
    const honorSheet = getSheet_(CONFIG.SHEET_HONOR_BOARD);

    deleteRowsWhere_(roundsSheet, "ClassName", className);
    deleteRowsWhere_(votesSheet, null, null); // StoryVotes 沒有 ClassName 欄位，靠 RoundID 對應太複雜，全部清空即可（票數本來就只在單一輪次內有意義）
    deleteRowsWhere_(honorSheet, "ClassName", className);

    Logger.log("✅ 已重置故事接龍狀態：" + (className || "全部班級"));
  } finally {
    lock.releaseLock();
  }
}
function resetAllStory() { resetStoryForClass(""); }

/** 刪除某分頁中符合條件的資料列（colName 為 null 時代表清空全部資料列，保留表頭） */
function deleteRowsWhere_(sheet, colName, matchValue) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  if (!colName) {
    sheet.deleteRows(2, lastRow - 1);
    return;
  }
  const col = colIndex_(sheet, colName);
  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (!matchValue || String(values[i][0]) === String(matchValue)) {
      sheet.deleteRow(i + 2);
    }
  }
}

/* =========================================================================
   我的故事本（雲端保存、可跨裝置、省 Sheet 空間版本）
   ========================================================================= */

function getStoryBooksAll_() { return sheetToObjects_(getSheet_(CONFIG.SHEET_STORY_BOOKS)); }

/** FramesJSON 只存 [{artworkId, caption, order}]，圖片/作者/班級一律即時查 Artworks 取得 */
function hydrateBookFrames_(frames, user) {
  const artworksById = {};
  getArtworksAll_().forEach((a) => { artworksById[String(a.ID)] = a; });

  return (frames || []).map((f) => {
    const art = artworksById[String(f.artworkId)];
    if (!art || !isArtworkViewableBy_(art, user)) {
      return { artworkId: f.artworkId, caption: f.caption || "", unavailable: true };
    }
    return {
      artworkId: f.artworkId,
      ID: f.artworkId,
      caption: f.caption || "",
      nickname: art.Nickname || art.StudentName || "匿名",
      className: art.ClassName,
      ImageURL: art.ImageURL || "",
      needsProxy: normalizeVisibility_(art.Visibility) === "private" && !art.ImageURL,
    };
  });
}

function handleBooksList_(body) {
  const user = requireActiveUser_(body);
  const books = getStoryBooksAll_().filter((b) => String(b.OwnerUserID) === String(user.UserID));
  const summarized = books
    .sort((a, b) => new Date(b.UpdatedAt) - new Date(a.UpdatedAt))
    .map((b) => {
      let frames = [];
      try { frames = JSON.parse(b.FramesJSON || "[]"); } catch (e) { frames = []; }
      return { bookId: b.BookID, title: b.Title, status: b.Status, pageCount: frames.length, updatedAt: b.UpdatedAt };
    });
  return jsonOut_({ books: summarized });
}

function handleBooksGet_(body) {
  const user = requireActiveUser_(body);
  const bookId = String(body.bookId || "");
  const book = getStoryBooksAll_().find((b) => String(b.BookID) === bookId);
  if (!book) throw new Error("找不到這本故事本");
  if (String(book.OwnerUserID) !== String(user.UserID)) throw new Error("沒有權限查看別人的故事本");

  let frames = [];
  try { frames = JSON.parse(book.FramesJSON || "[]"); } catch (e) { frames = []; }
  return jsonOut_({
    book: { bookId: book.BookID, title: book.Title, status: book.Status, frames: hydrateBookFrames_(frames, user) },
  });
}

function handleBooksSave_(body) {
  const user = requireActiveUser_(body);
  const settings = getSettings_();
  const maxPages = settingNum_(settings, "STORY_BOOK_MAX_PAGES");
  const charsPerPage = settingNum_(settings, "STORY_BOOK_CHARS_PER_PAGE");
  const maxActive = settingNum_(settings, "STORY_BOOK_MAX_ACTIVE");

  const title = String(body.title || "未命名故事本").trim().slice(0, 60);
  const framesInput = Array.isArray(body.frames) ? body.frames : [];
  if (framesInput.length > maxPages) throw new Error(`故事本最多 ${maxPages} 頁，請刪減內容`);

  const frames = framesInput.map((f, i) => ({
    artworkId: String(f.artworkId || ""),
    caption: String(f.caption || "").slice(0, charsPerPage),
    order: i,
  })).filter((f) => f.artworkId);

  const booksSheet = getSheet_(CONFIG.SHEET_STORY_BOOKS);
  const bookId = String(body.bookId || "");
  const now = new Date();

  if (bookId) {
    const existing = rowsWithLineNumbers_(booksSheet).find((r) => String(r.obj.BookID) === bookId);
    if (!existing) throw new Error("找不到這本故事本");
    if (String(existing.obj.OwnerUserID) !== String(user.UserID)) throw new Error("沒有權限修改別人的故事本");
    updateObjectRow_(booksSheet, existing.rowNum, { Title: title, FramesJSON: JSON.stringify(frames), UpdatedAt: now });
    return jsonOut_({ success: true, bookId, updatedAt: now.toISOString() });
  }

  const activeCount = getStoryBooksAll_().filter((b) => String(b.OwnerUserID) === String(user.UserID) && String(b.Status) === "active").length;
  if (activeCount >= maxActive) throw new Error(`最多只能同時建立 ${maxActive} 本故事本，請先刪除舊的再新增`);

  const newId = uuid_();
  appendObjectRow_(booksSheet, {
    BookID: newId, OwnerUserID: user.UserID, Title: title, FramesJSON: JSON.stringify(frames),
    Status: "active", CreatedAt: now, UpdatedAt: now,
  });
  return jsonOut_({ success: true, bookId: newId, updatedAt: now.toISOString() });
}

function handleBooksDelete_(body) {
  const user = requireActiveUser_(body);
  const bookId = String(body.bookId || "");
  const booksSheet = getSheet_(CONFIG.SHEET_STORY_BOOKS);
  const existing = rowsWithLineNumbers_(booksSheet).find((r) => String(r.obj.BookID) === bookId);
  if (!existing) throw new Error("找不到這本故事本");
  if (String(existing.obj.OwnerUserID) !== String(user.UserID)) throw new Error("沒有權限刪除別人的故事本");
  booksSheet.deleteRow(existing.rowNum);
  return jsonOut_({ success: true });
}

/* =========================================================================
   AI 作圖（額度以 LockService 原子預留，失敗自動退還）
   ========================================================================= */

/** 計算目前所在的「額度日」窗口起點（Asia/Taipei，依 resetHour 決定每天幾點重置），
 *  回傳格式如 2026-08-01，同一個窗口期間內共用同一組配額。 */
function getQuotaDateKey_(now, resetHour) {
  const taipeiMs = now.getTime() + TAIPEI_OFFSET_MS;
  const t = new Date(taipeiMs);
  let y = t.getUTCFullYear(), m = t.getUTCMonth(), d = t.getUTCDate();
  const boundaryTodayUtcMs = Date.UTC(y, m, d, resetHour, 0, 0) - TAIPEI_OFFSET_MS;
  let windowStartMs = boundaryTodayUtcMs;
  if (now.getTime() < boundaryTodayUtcMs) windowStartMs -= 24 * 3600 * 1000;
  const windowStartTaipei = new Date(windowStartMs + TAIPEI_OFFSET_MS);
  const y2 = windowStartTaipei.getUTCFullYear();
  const m2 = String(windowStartTaipei.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(windowStartTaipei.getUTCDate()).padStart(2, "0");
  return { dateKey: `${y2}-${m2}-${d2}`, nextResetIso: new Date(windowStartMs + 24 * 3600 * 1000).toISOString() };
}

function findAIUsageRow_(userId, dateKey) {
  const found = rowsWithLineNumbers_(getSheet_(CONFIG.SHEET_AI_USAGE)).find(
    (r) => String(r.obj.UserID) === String(userId) && String(r.obj.DateKey) === String(dateKey)
  );
  return found ? { rowNum: found.rowNum, row: found.obj } : { rowNum: -1, row: null };
}

function computeQuotaSnapshot_(user) {
  const quotaLimit = Number(user.QuotaLimit);
  const resetHour = Number(user.ResetHour) || 0;
  const { dateKey, nextResetIso } = getQuotaDateKey_(new Date(), resetHour);
  const { row } = findAIUsageRow_(user.UserID, dateKey);
  const usedCount = row ? Number(row.UsedCount || 0) : 0;
  return { dateKey, nextResetIso, quotaLimit: isFinite(quotaLimit) ? quotaLimit : 5, usedCount, mode: user.QuotaMode || "count" };
}

function handleAiQuota_(body) {
  const user = requireActiveUser_(body);
  return jsonOut_({ quota: computeQuotaSnapshot_(user) });
}

/** 原子「預留」一次額度：在 lock 保護下，若還沒到上限就先把 UsedCount +1 寫回 Sheet，
 *  回傳是否成功預留；即使兩個分頁同時點兩下，也只有一個請求能搶到最後一次額度。 */
function reserveAiQuota_(user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const quotaLimit = Number(user.QuotaLimit);
    const limit = isFinite(quotaLimit) ? quotaLimit : 5;
    const resetHour = Number(user.ResetHour) || 0;
    const { dateKey } = getQuotaDateKey_(new Date(), resetHour);
    const sheet = getSheet_(CONFIG.SHEET_AI_USAGE);
    const { rowNum, row } = findAIUsageRow_(user.UserID, dateKey);
    const used = row ? Number(row.UsedCount || 0) : 0;

    if (limit > 0 && used >= limit) return { ok: false, dateKey, rowNum: -1 };

    if (rowNum === -1) {
      appendObjectRow_(sheet, { DateKey: dateKey, UserID: user.UserID, Mode: user.QuotaMode || "count", UsedCount: 1, InputTokens: 0, OutputTokens: 0, UpdatedAt: new Date() });
      return { ok: true, dateKey, rowNum: -1 };
    }
    sheet.getRange(rowNum, colIndex_(sheet, "UsedCount")).setValue(used + 1);
    sheet.getRange(rowNum, colIndex_(sheet, "UpdatedAt")).setValue(new Date());
    return { ok: true, dateKey, rowNum };
  } finally {
    lock.releaseLock();
  }
}

/** API 呼叫失敗時退還剛剛預留的那 1 次額度（不會退到負數以下） */
function refundAiQuota_(userId, dateKey) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_(CONFIG.SHEET_AI_USAGE);
    const { rowNum, row } = findAIUsageRow_(userId, dateKey);
    if (rowNum === -1) return;
    const current = Number(row.UsedCount || 0);
    sheet.getRange(rowNum, colIndex_(sheet, "UsedCount")).setValue(Math.max(0, current - 1));
  } finally {
    lock.releaseLock();
  }
}

function recordAiTokenUsage_(userId, dateKey, inputTokens, outputTokens) {
  if (!inputTokens && !outputTokens) return;
  const sheet = getSheet_(CONFIG.SHEET_AI_USAGE);
  const { rowNum, row } = findAIUsageRow_(userId, dateKey);
  if (rowNum === -1) return;
  const curIn = Number(row.InputTokens || 0);
  const curOut = Number(row.OutputTokens || 0);
  updateObjectRow_(sheet, rowNum, {
    InputTokens: curIn + (Number(inputTokens) || 0),
    OutputTokens: curOut + (Number(outputTokens) || 0),
  });
}

/** 取出某件作品的圖片 Blob，作為 AI 圖片編輯（角色參考）的輸入。只允許：
 *  自己名下的作品（任何可見度），或別人「公開」且已上架的作品——不允許讀取別人未公開/未審核的東西。 */
function getReferenceImageBlob_(artworkId, user) {
  const art = getArtworksAll_().find((a) => String(a.ID) === String(artworkId));
  if (!art) throw new Error("找不到指定的參考作品");

  const isOwner = String(art.OwnerUserID) === String(user.UserID);
  const isPublicApproved = normalizeVisibility_(art.Visibility) === "public" && parseBoolean_(art.Approved);
  if (!isOwner && !isPublicApproved) throw new Error("沒有權限使用這張作品當作參考圖");

  if (art.DriveFileID) {
    return getDriveFileBlob_(art.DriveFileID);
  }
  if (art.ImageURL) {
    const resp = UrlFetchApp.fetch(art.ImageURL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error("參考圖片下載失敗");
    return resp.getBlob();
  }
  throw new Error("這張作品沒有可用的圖片資料");
}

/** gpt-image-1 系列只接受 low/medium/high/auto；如果 Settings 分頁裡還留著舊版
 *  （dall-e-3 時代）的 standard/hd，或任何看不懂的值，自動修正成安全的預設值，
 *  避免因為 Sheet 裡一個過期的字串就讓每次生成都失敗。 */
function normalizeAiQuality_(v) {
  const s = String(v || "").trim().toLowerCase();
  if (["low", "medium", "high", "auto"].includes(s)) return s;
  if (s === "standard") return "medium";
  if (s === "hd") return "high";
  return "medium";
}

function handleAiGenerate_(body) {
  const user = requireActiveUser_(body);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new Error("請輸入 Prompt");
  if (prompt.length > 2000) throw new Error("Prompt 太長了，請精簡在 2000 字以內");

  const referenceArtworkId = String(body.referenceArtworkId || "").trim();
  const referenceImageBase64 = String(body.referenceImageBase64 || "").trim();
  const referenceImageMimeType = String(body.referenceImageMimeType || "").trim();

  const reservation = reserveAiQuota_(user);
  if (!reservation.ok) throw new Error("你今天的 AI 作圖額度已經用完了，請明天再來，或請老師調整額度");

  try {
    const apiKey = getProp_("OPENAI_API_KEY", true);
    const settings = getSettings_();
    const model = settings.AI_MODEL || DEFAULT_SETTINGS.AI_MODEL;
    const size = settings.AI_SIZE || DEFAULT_SETTINGS.AI_SIZE;
    const quality = normalizeAiQuality_(settings.AI_QUALITY || DEFAULT_SETTINGS.AI_QUALITY);

    // 參考圖優先順序：這次現場上傳的圖 > 選中的舊作品 > 都沒有就走純文字生成
    let refBlob = null;
    if (referenceImageBase64) {
      if (referenceImageMimeType.indexOf("image/") !== 0) throw new Error("參考圖檔案類型不是圖片");
      let bytes;
      try {
        bytes = Utilities.base64Decode(referenceImageBase64);
      } catch (e) {
        throw new Error("參考圖資料格式錯誤");
      }
      if (bytes.length > 9 * 1024 * 1024) throw new Error("參考圖檔案太大，請壓縮到 9MB 以內");
      refBlob = Utilities.newBlob(bytes, referenceImageMimeType, "reference." + guessExtension_(referenceImageMimeType));
    } else if (referenceArtworkId) {
      refBlob = getReferenceImageBlob_(referenceArtworkId, user);
    }

    let resp;
    if (refBlob) {
      // 有參考圖：走 /images/edits，帶 input_fidelity=high 盡量保留角色的臉部/風格特徵
      resp = UrlFetchApp.fetch("https://api.openai.com/v1/images/edits", {
        method: "post",
        headers: { Authorization: "Bearer " + apiKey },
        payload: {
          model: model,
          prompt: prompt,
          size: size,
          quality: quality,
          input_fidelity: "high",
          n: "1",
          image: refBlob,
        },
        muteHttpExceptions: true,
      });
    } else {
      // 沒有參考圖：走一般文字生成 /images/generations
      resp = UrlFetchApp.fetch("https://api.openai.com/v1/images/generations", {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + apiKey },
        payload: JSON.stringify({ model, prompt, size, quality, n: 1 }),
        muteHttpExceptions: true,
      });
    }

    if (resp.getResponseCode() !== 200) {
      let msg = "OpenAI 圖片產生失敗（HTTP " + resp.getResponseCode() + "）";
      try {
        const errBody = JSON.parse(resp.getContentText());
        if (errBody.error && errBody.error.message) msg = "圖片產生失敗：" + errBody.error.message;
      } catch (e) { /* ignore parse error */ }
      throw new Error(msg);
    }

    const data = JSON.parse(resp.getContentText());
    const item = data.data && data.data[0];
    if (!item) throw new Error("圖片產生失敗：回應內容是空的");

    let bytes;
    if (item.b64_json) {
      bytes = Utilities.base64Decode(item.b64_json);
    } else if (item.url) {
      const imgResp = UrlFetchApp.fetch(item.url, { muteHttpExceptions: true });
      if (imgResp.getResponseCode() !== 200) throw new Error("圖片下載失敗");
      bytes = imgResp.getBlob().getBytes();
    } else {
      throw new Error("圖片產生失敗：回應格式無法解析");
    }

    const blob = Utilities.newBlob(bytes, "image/png", sanitizeFileNamePart_(user.Nickname) + "_ai_" + Date.now() + ".png");
    const folder = getBackupFolder_();
    const file = folder.createFile(blob); // AI 產圖預設為私人，不設公開分享

    const id = uuid_();
    appendObjectRow_(getSheet_(CONFIG.SHEET_ARTWORKS), {
      ID: id, Timestamp: new Date(), StudentName: user.StudentName, ClassName: user.ClassName,
      ImageURL: "", DriveBackupURL: "", Prompt: prompt, Description: "", AITool: "OpenAI",
      Tags: "", Likes: 0, Approved: false,
      OwnerUserID: user.UserID, Nickname: user.Nickname, DriveFileID: file.getId(),
      Visibility: "private", AllowStory: false, Source: "OpenAI",
    });
    invalidateCache_(CONFIG.SHEET_ARTWORKS);

    if (data.usage) {
      recordAiTokenUsage_(user.UserID, reservation.dateKey, data.usage.input_tokens, data.usage.output_tokens);
    }

    const refreshedUser = findUserById_(user.UserID);
    return jsonOut_({
      success: true,
      artwork: sanitizeArtworkOwnerView_({
        ID: id, Timestamp: new Date().toISOString(), ClassName: user.ClassName, Nickname: user.Nickname,
        ImageURL: "", DriveBackupURL: "", Prompt: prompt, Description: "", AITool: "OpenAI", Tags: "",
        Likes: 0, Approved: false, OwnerUserID: user.UserID, Visibility: "private", AllowStory: false,
      }, refreshedUser),
      quota: computeQuotaSnapshot_(refreshedUser),
    });
  } catch (err) {
    refundAiQuota_(user.UserID, reservation.dateKey);
    throw err;
  }
}

/* =========================================================================
   doGet / doPost 統一入口
   ========================================================================= */

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || "list";
    if (action === "comments") return handleComments_(e.parameter.artworkId);
    return handleListPublic_();
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

const POST_ACTIONS = {
  "auth/login": handleAuthLogin_,
  "auth/register": handleAuthRegister_,
  "auth/me": handleAuthMe_,
  "auth/updateNickname": handleAuthUpdateNickname_,
  "auth/updateCharacterSheet": handleAuthUpdateCharacterSheet_,
  "auth/logout": handleAuthLogout_,

  "submit": handleSubmit_,
  "listMine": handleListMine_,
  "materialLibrary": handleMaterialLibrary_,
  "updateVisibility": handleUpdateVisibility_,
  "image/get": handleImageGet_,

  "like": handleLike_,
  "comment": handleComment_,

  "story/getRound": handleStoryGetRound_,
  "story/vote": handleStoryVote_,
  "story/getHonorBoard": handleStoryGetHonorBoard_,

  "books/list": handleBooksList_,
  "books/get": handleBooksGet_,
  "books/save": handleBooksSave_,
  "books/delete": handleBooksDelete_,

  "ai/quota": handleAiQuota_,
  "ai/generate": handleAiGenerate_,
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const handler = POST_ACTIONS[action];
    if (!handler) return jsonOut_({ error: "未知的 action：" + action });
    return handler(body);
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

/* =========================================================================
   Setup / Migrate — 安全可重複執行，只新增缺少的分頁/欄位/設定值，絕不刪除或覆蓋
   ========================================================================= */

function ensureSheetWithHeaders_(ss, name, expectedHeaders) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(expectedHeaders);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(expectedHeaders);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = expectedHeaders.filter((h) => existingHeaders.indexOf(h) === -1);
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
  if (sheet.getFrozenRows() === 0) sheet.setFrozenRows(1);
  return sheet;
}

/** 幫 AuthorizedUsers 的 Status 欄設定/更新下拉選單清單（僅顯示警告，setAllowInvalid(true)
 *  代表老師仍可以直接打字打入清單外的任何文字，不會被卡住——後端邏輯本來就只認 "Active"，
 *  這裡只是讓下拉選單的選項跟 README 描述的四種狀態一致，方便老師用點的而不必手動打字）。
 *  可安全重複執行：每次都是整欄重新套用同一份清單，不影響儲存格裡既有的值。 */
function applyStatusDataValidation_(usersSheet) {
  const colIdx = colIndex_(usersSheet, "Status");
  const numRows = Math.max(usersSheet.getMaxRows() - 1, 500);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true)
    .setAllowInvalid(true)
    .build();
  usersSheet.getRange(2, colIdx, numRows, 1).setDataValidation(rule);
}

/**
 * 🔧 部署後請先執行一次這個函式（Apps Script 編輯器上方函式選單選 setupOrMigrate → 執行）。
 * 之後每次程式更新想確保 Sheet 結構齊全，也可以放心重複執行，不會刪除或覆蓋任何既有資料。
 */
function setupOrMigrate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheetWithHeaders_(ss, CONFIG.SHEET_ARTWORKS, ARTWORK_HEADERS);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_USERS, USER_HEADERS);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_COMMENTS, COMMENT_HEADERS);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_STORY_CHAIN, STORY_CHAIN_HEADERS);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_STORY_ROUNDS, STORY_ROUNDS_HEADERS);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_STORY_VOTES, STORY_VOTES_HEADERS);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_HONOR_BOARD, HONOR_BOARD_HEADERS);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_STORY_BOOKS, STORY_BOOKS_HEADERS);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_AI_USAGE, AI_USAGE_HEADERS);
  const settingsSheet = ensureSheetWithHeaders_(ss, CONFIG.SHEET_SETTINGS, SETTINGS_HEADERS);

  // Settings 分頁：只新增缺少的 key，已存在的 key 保留老師原本設定的值
  const existingKeys = new Set(sheetToObjects_(settingsSheet).map((r) => String(r.Key)));
  Object.keys(DEFAULT_SETTINGS).forEach((key) => {
    if (!existingKeys.has(key)) {
      appendObjectRow_(settingsSheet, { Key: key, Value: DEFAULT_SETTINGS[key] });
    }
  });

  // 既有的 AuthorizedUsers 若是舊格式（只有 StudentName/ClassName/Status/AutoApprove），
  // 幫每一列補上必要的新欄位預設值，讓舊帳號至少能維持原本能瀏覽/投稿的狀態（沒有 GoogleSub 就無法登入，
  // 老師仍需請這些學生改用 Google 登入重新申請帳號一次，取得 UserID 才能使用新版所有功能）。
  const usersSheet = getSheet_(CONFIG.SHEET_USERS);
  applyStatusDataValidation_(usersSheet);
  const userRows = rowsWithLineNumbers_(usersSheet);
  userRows.forEach(({ rowNum, obj: row }) => {
    const patch = {};
    if (!row.UserID) patch.UserID = uuid_();
    if (!row.Nickname) patch.Nickname = row.StudentName || "";
    if (!row.Role) patch.Role = "student";
    if (row.SessionVersion === "" || row.SessionVersion === undefined || row.SessionVersion === null) patch.SessionVersion = 1;
    if (row.QuotaMode === "" || row.QuotaMode === undefined) patch.QuotaMode = "count";
    if (row.QuotaLimit === "" || row.QuotaLimit === undefined) patch.QuotaLimit = DEFAULT_SETTINGS.AI_DEFAULT_QUOTA_LIMIT;
    if (row.ResetHour === "" || row.ResetHour === undefined) patch.ResetHour = DEFAULT_SETTINGS.AI_DEFAULT_RESET_HOUR;
    if (row.ArtworkAutoApprove === "" || row.ArtworkAutoApprove === undefined) patch.ArtworkAutoApprove = false;
    if (Object.keys(patch).length) updateObjectRow_(usersSheet, rowNum, patch);
  });

  // 既有 Artworks 若是舊格式，補上新欄位的合理預設值：沒有 OwnerUserID 代表是舊資料，
  // 一律視為 public（維持「舊資料相容」，畫廊照常顯示），AllowStory 預設允許（維持舊行為）。
  const artworksSheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  const artRows = rowsWithLineNumbers_(artworksSheet);
  artRows.forEach(({ rowNum, obj: row }) => {
    const patch = {};
    if (row.Visibility === "" || row.Visibility === undefined) patch.Visibility = "public";
    if (row.AllowStory === "" || row.AllowStory === undefined) patch.AllowStory = true;
    if (row.Source === "" || row.Source === undefined) patch.Source = "User";
    if (Object.keys(patch).length) updateObjectRow_(artworksSheet, rowNum, patch);
  });

  invalidateCache_(CONFIG.SHEET_USERS);
  invalidateCache_(CONFIG.SHEET_ARTWORKS);
  CacheService.getScriptCache().remove("SETTINGS_V1");

  Logger.log("✅ setupOrMigrate 完成：所有分頁與欄位已確保存在，Status 下拉選單清單已更新，舊資料未被刪除或覆蓋。");
  return { success: true };
}
