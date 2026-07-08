/**
 * ===================================================================================
 * OO班 AI 創作畫廊 — Google Apps Script 後端
 * ===================================================================================
 *
 * 使用方式：
 * 1. 建立一份 Google Sheet，並依照 README.md 建立三個分頁：
 *    Artworks / AuthorizedUsers / Comments（欄位順序請務必照抄）
 * 2. 在該 Google Sheet 中：擴充功能 > Apps Script，把這個檔案的內容整份貼上
 *    （這是「綁定腳本 bound script」，會自動抓到目前這份 Sheet，不需要填 Sheet ID）
 * 3. 修改下方 CONFIG.DRIVE_BACKUP_FOLDER_ID，填入你的 Google Drive 備份資料夾 ID
 * 4. 部署 > 新增部署作業 > 類型選「網頁應用程式」
 *      - 執行身分：我
 *      - 具有存取權的使用者：任何人
 * 5. 授權時會跳出 Google 帳號授權畫面，需同意「查看、編輯、建立及刪除您的 Google 試算表」
 *    與「查看、編輯、建立及刪除您在 Google 雲端硬碟中的檔案」等權限（因為要寫入 Sheet 與備份圖片到 Drive）
 * 6. 部署完成後會拿到一個網址（結尾是 /exec），把它填入前端 js/config.js 的 APPS_SCRIPT_URL
 *
 * 詳細步驟另見 README.md
 * ===================================================================================
 */

const CONFIG = {
  SHEET_ARTWORKS: "Artworks",
  SHEET_USERS: "AuthorizedUsers",
  SHEET_COMMENTS: "Comments",
  SHEET_STORY_CHAIN: "StoryChain",
  // 請填入你要用來備份圖片的 Google Drive 資料夾 ID
  // （在資料夾網址 https://drive.google.com/drive/folders/XXXXXXXX 中，XXXXXXXX 就是 ID）
  DRIVE_BACKUP_FOLDER_ID: "PASTE_YOUR_DRIVE_FOLDER_ID_HERE",
  // 投票接龍遊戲設定
  STORY_ROUND_HOURS: 24,        // 每一輪投票開放幾小時，時間到自動結算、選出得票最高的作品接上故事
  STORY_CANDIDATES_PER_ROUND: 4, // 每一輪從「還沒被選進故事」的已上架作品中，隨機抽幾張讓大家投票
};

const ARTWORK_HEADERS = [
  "ID",
  "Timestamp",
  "StudentName",
  "ClassName",
  "ImageURL",
  "DriveBackupURL",
  "Prompt",
  "Description",
  "AITool",
  "Tags",
  "Likes",
  "Approved",
];

const USER_HEADERS = ["StudentName", "ClassName", "Status", "AutoApprove"];
const COMMENT_HEADERS = ["ArtworkID", "CommenterName", "Comment", "Timestamp"];
const STORY_CHAIN_HEADERS = [
  "Order",
  "ArtworkID",
  "StudentName",
  "ClassName",
  "ImageURL",
  "AITool",
  "WinningVotes",
  "Timestamp",
];

/* =========================================================================
   共用工具
   ========================================================================= */

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error(`找不到分頁「${name}」，請確認 Google Sheet 是否已建立此分頁`);
  }
  return sheet;
}

/** 將整個分頁（含表頭）轉成物件陣列 */
function sheetToObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const rows = data.slice(1);
  return rows
    .filter((row) => row.some((cell) => cell !== "" && cell !== null))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i];
      });
      return obj;
    });
}

/** 依欄位名稱找出該欄位是第幾欄（1-based） */
function colIndex_(sheet, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = headers.indexOf(headerName);
  if (idx === -1) throw new Error(`分頁「${sheet.getName()}」找不到欄位「${headerName}」`);
  return idx + 1;
}

/** 依 ID 欄位找出資料列（回傳 row number，1-based，找不到回傳 -1） */
function findRowById_(sheet, idColName, idValue) {
  const idCol = colIndex_(sheet, idColName);
  const values = sheet.getRange(2, idCol, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(idValue)) return i + 2; // +2: 跳過表頭 + 0-based
  }
  return -1;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function parseBoolean_(val) {
  if (typeof val === "boolean") return val;
  const s = String(val).trim().toUpperCase();
  return s === "TRUE" || s === "1" || s === "YES";
}

/* =========================================================================
   doGet — 讀取資料
   ========================================================================= */

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || "list";

    if (action === "comments") {
      const artworkId = e.parameter.artworkId;
      if (!artworkId) return jsonOut_({ error: "缺少 artworkId 參數" });
      const sheet = getSheet_(CONFIG.SHEET_COMMENTS);
      const all = sheetToObjects_(sheet);
      const comments = all
        .filter((c) => String(c.ArtworkID) === String(artworkId))
        .sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
      return jsonOut_({ comments });
    }

    if (action === "roster") {
      // 提供「班級 → 學生姓名」名單給投稿頁的連動下拉選單使用。
      // 老師只要在 Google Sheet 的 AuthorizedUsers 分頁增刪列即可，網站會自動同步，
      // 不需要改程式碼或重新部署。只回傳 Status 為 active 的人，且不外流 AutoApprove 欄位。
      const usersSheet = getSheet_(CONFIG.SHEET_USERS);
      const users = sheetToObjects_(usersSheet);
      const roster = users
        .filter((u) => String(u.Status).trim().toLowerCase() === "active")
        .map((u) => ({
          className: String(u.ClassName).trim(),
          studentName: String(u.StudentName).trim(),
        }))
        .filter((u) => u.className && u.studentName);
      return jsonOut_({ roster });
    }

    if (action === "story") {
      return jsonOut_({ story: getStorySnapshot_() });
    }

    // 預設：回傳所有已上架作品
    const sheet = getSheet_(CONFIG.SHEET_ARTWORKS);
    const all = sheetToObjects_(sheet);
    const approved = all
      .filter((a) => parseBoolean_(a.Approved))
      .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
    return jsonOut_({ artworks: approved });
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

/* =========================================================================
   doPost — 寫入資料（投稿 / 按讚 / 留言）
   ========================================================================= */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === "submit") return handleSubmit_(body);
    if (action === "like") return handleLike_(body);
    if (action === "comment") return handleComment_(body);
    if (action === "storyVote") return handleStoryVote_(body);

    return jsonOut_({ error: "未知的 action：" + action });
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

/* -------------------------------------------------------------------------
   action = submit
   ------------------------------------------------------------------------- */
function handleSubmit_(body) {
  const studentName = String(body.studentName || "").trim();
  const className = String(body.className || "").trim();
  const imageUrl = String(body.imageUrl || "").trim();
  const aiTool = String(body.aiTool || "").trim();
  const prompt = String(body.prompt || "").trim();
  const description = String(body.description || "").trim();
  const tags = String(body.tags || "").trim();

  if (!studentName) {
    return jsonOut_({ error: "姓名為必填欄位" });
  }

  // 1. 檢查授權名單
  const usersSheet = getSheet_(CONFIG.SHEET_USERS);
  const users = sheetToObjects_(usersSheet);
  const matched = users.find(
    (u) =>
      String(u.StudentName).trim() === studentName &&
      String(u.ClassName).trim() === className
  );

  if (!matched) {
    return jsonOut_({
      error: "找不到你的投稿授權資料，請確認姓名與班級是否與老師登記的一致，或聯絡老師開通投稿權限",
    });
  }
  if (String(matched.Status).trim().toLowerCase() !== "active") {
    return jsonOut_({ error: "你的投稿權限目前為停用狀態，請聯絡老師確認" });
  }

  const autoApprove = parseBoolean_(matched.AutoApprove);

  // 2. 備份圖片到 Google Drive（沒有圖片連結，或備份失敗，都不阻擋投稿）
  let backupUrl = "";
  if (imageUrl) {
    try {
      backupUrl = backupImageToDrive_(imageUrl, studentName);
    } catch (backupErr) {
      backupUrl = "";
    }
  }

  // 3. 寫入 Artworks 分頁
  const artworksSheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  const id = Utilities.getUuid();
  const timestamp = new Date();

  artworksSheet.appendRow([
    id,
    timestamp,
    studentName,
    className,
    imageUrl,
    backupUrl,
    prompt,
    description,
    aiTool,
    tags,
    0,
    autoApprove ? "TRUE" : "FALSE",
  ]);

  return jsonOut_({ success: true, id, approved: autoApprove });
}

/** 把圖片抓下來備份到指定 Drive 資料夾，回傳可公開檢視的連結 */
function backupImageToDrive_(imageUrl, studentName) {
  if (
    !CONFIG.DRIVE_BACKUP_FOLDER_ID ||
    CONFIG.DRIVE_BACKUP_FOLDER_ID.indexOf("PASTE_YOUR_DRIVE_FOLDER_ID_HERE") !== -1
  ) {
    // 尚未設定備份資料夾，直接跳過備份
    return "";
  }
  const response = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error("無法下載圖片，HTTP " + response.getResponseCode());
  }
  const blob = response.getBlob();
  const folder = DriveApp.getFolderById(CONFIG.DRIVE_BACKUP_FOLDER_ID);
  const safeName = studentName.replace(/[^\w\u4e00-\u9fa5]/g, "_");
  const fileName = safeName + "_" + Date.now() + "." + guessExtension_(blob.getContentType());
  const file = folder.createFile(blob).setName(fileName);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // 轉換成可直接當圖片來源使用的連結
  return "https://drive.google.com/uc?export=view&id=" + file.getId();
}

function guessExtension_(contentType) {
  if (!contentType) return "jpg";
  if (contentType.indexOf("png") !== -1) return "png";
  if (contentType.indexOf("gif") !== -1) return "gif";
  if (contentType.indexOf("webp") !== -1) return "webp";
  return "jpg";
}

/* -------------------------------------------------------------------------
   action = like
   ------------------------------------------------------------------------- */
function handleLike_(body) {
  const artworkId = body.artworkId;
  if (!artworkId) return jsonOut_({ error: "缺少 artworkId" });

  const sheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  const rowNum = findRowById_(sheet, "ID", artworkId);
  if (rowNum === -1) return jsonOut_({ error: "找不到對應的作品 ID" });

  const likesCol = colIndex_(sheet, "Likes");
  const cell = sheet.getRange(rowNum, likesCol);
  const current = Number(cell.getValue()) || 0;
  const updated = current + 1;
  cell.setValue(updated);

  return jsonOut_({ success: true, likes: updated });
}

/* -------------------------------------------------------------------------
   action = comment
   ------------------------------------------------------------------------- */
function handleComment_(body) {
  const artworkId = body.artworkId;
  const commenterName = String(body.commenterName || "").trim();
  const comment = String(body.comment || "").trim();

  if (!artworkId || !commenterName || !comment) {
    return jsonOut_({ error: "缺少必要欄位（artworkId / commenterName / comment）" });
  }

  const sheet = getSheet_(CONFIG.SHEET_COMMENTS);
  sheet.appendRow([artworkId, commenterName, comment, new Date()]);

  return jsonOut_({ success: true });
}

/* =========================================================================
   故事接龍投票遊戲（StoryChain）
   -------------------------------------------------------------------------
   玩法：每一輪從「還沒被選進故事」的已上架作品中隨機抽幾張當候選，
   大家投票；時間到（STORY_ROUND_HOURS 小時）自動結算，得票最高的作品
   接進故事鏈，然後自動開下一輪。狀態存在 PropertiesService（不用另外
   開分頁），故事鏈本身則寫進 Google Sheet 的 StoryChain 分頁，方便老師
   直接在 Sheet 上查看完整故事順序。
   ========================================================================= */

const STORY_STATE_KEY = "STORY_STATE_V1";

function getStoryState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(STORY_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveStoryState_(state) {
  PropertiesService.getScriptProperties().setProperty(STORY_STATE_KEY, JSON.stringify(state));
}

function getApprovedArtworks_() {
  const sheet = getSheet_(CONFIG.SHEET_ARTWORKS);
  return sheetToObjects_(sheet).filter((a) => parseBoolean_(a.Approved));
}

function getStoryChainRows_() {
  const sheet = getSheet_(CONFIG.SHEET_STORY_CHAIN);
  return sheetToObjects_(sheet).sort((a, b) => Number(a.Order) - Number(b.Order));
}

function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 確保目前有一輪「進行中」的投票；如果沒有（第一次啟用、或上一輪剛結算完），
 *  就從還沒被選進故事鏈的已上架作品中，隨機抽幾張開新的一輪。
 *  如果已經沒有還沒用過的作品了，就把 candidates 設為空陣列（代表故事暫時完結，
 *  之後只要有新投稿通過審核，下次呼叫就會自動再開新的一輪）。
 */
function ensureRoundActive_() {
  let state = getStoryState_();
  if (state && state.candidates && state.candidates.length > 0) return state;

  const approved = getApprovedArtworks_();
  const usedIds = new Set(getStoryChainRows_().map((r) => String(r.ArtworkID)));
  const unused = approved.filter((a) => !usedIds.has(String(a.ID)));

  const candidates = shuffle_(unused)
    .slice(0, CONFIG.STORY_CANDIDATES_PER_ROUND)
    .map((a) => String(a.ID));

  state = {
    roundNumber: state ? state.roundNumber + 1 : 1,
    startTime: new Date().toISOString(),
    durationHours: CONFIG.STORY_ROUND_HOURS,
    candidates: candidates,
    votes: {}, // { artworkId: [voterId, ...] }
  };
  saveStoryState_(state);
  return state;
}

/** 如果目前這一輪時間到了，結算出勝出的作品、接進故事鏈，並開下一輪。
 *  用 LockService 避免多個使用者同時打開網頁時重複結算兩次。
 */
function checkAndFinalizeIfExpired_() {
  let state = getStoryState_();
  if (!state || !state.candidates || state.candidates.length === 0) return state;

  const endsAt = new Date(state.startTime).getTime() + state.durationHours * 3600 * 1000;
  if (Date.now() < endsAt) return state;

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // 重新讀一次，避免自己在等鎖的時候，別人已經搶先結算過了
    state = getStoryState_();
    if (!state || !state.candidates || state.candidates.length === 0) return state;
    const stillEndsAt = new Date(state.startTime).getTime() + state.durationHours * 3600 * 1000;
    if (Date.now() < stillEndsAt) return state;

    const approved = getApprovedArtworks_();
    const byId = {};
    approved.forEach((a) => (byId[String(a.ID)] = a));

    // 找出票數最高的候選；沒人投票的話就隨機選一張，故事還是要繼續走下去
    let winnerId = null;
    let bestVotes = -1;
    let tied = [];
    state.candidates.forEach((id) => {
      const count = (state.votes[id] || []).length;
      if (count > bestVotes) {
        bestVotes = count;
        tied = [id];
      } else if (count === bestVotes) {
        tied.push(id);
      }
    });
    winnerId = shuffle_(tied)[0]; // 平票就隨機挑一個，避免卡住

    const winnerArt = byId[winnerId];
    if (winnerArt) {
      const chainSheet = getSheet_(CONFIG.SHEET_STORY_CHAIN);
      const nextOrder = getStoryChainRows_().length + 1;
      chainSheet.appendRow([
        nextOrder,
        winnerArt.ID,
        winnerArt.StudentName,
        winnerArt.ClassName,
        winnerArt.ImageURL,
        winnerArt.AITool,
        bestVotes < 0 ? 0 : bestVotes,
        new Date(),
      ]);
    }

    // 清空目前這一輪，讓 ensureRoundActive_ 開新的一輪
    state.candidates = [];
    saveStoryState_(state);
    state = ensureRoundActive_();
    return state;
  } finally {
    lock.releaseLock();
  }
}

function buildStoryRoundPayload_(state) {
  if (!state || !state.candidates || state.candidates.length === 0) {
    return {
      roundNumber: state ? state.roundNumber : 0,
      candidates: [],
      finished: getStoryChainRows_().length > 0, // 有故事但目前沒有候選 = 暫時沒有新投稿可以接龍
    };
  }
  const approved = getApprovedArtworks_();
  const byId = {};
  approved.forEach((a) => (byId[String(a.ID)] = a));

  const endsAt = new Date(
    new Date(state.startTime).getTime() + state.durationHours * 3600 * 1000
  ).toISOString();

  const candidates = state.candidates
    .map((id) => {
      const art = byId[id];
      if (!art) return null;
      return {
        artworkId: id,
        studentName: art.StudentName,
        className: art.ClassName,
        imageUrl: art.ImageURL,
        driveBackupUrl: art.DriveBackupURL,
        aiTool: art.AITool,
        voteCount: (state.votes[id] || []).length,
      };
    })
    .filter(Boolean);

  return {
    roundNumber: state.roundNumber,
    startTime: state.startTime,
    durationHours: state.durationHours,
    endsAt: endsAt,
    candidates: candidates,
    finished: false,
  };
}

/** 提供給 doGet(action=story) 使用：確保有進行中的一輪、結算過期的一輪，再回傳完整故事鏈 + 目前這輪的狀態 */
function getStorySnapshot_() {
  ensureRoundActive_();
  const state = checkAndFinalizeIfExpired_();
  const chain = getStoryChainRows_();
  return { chain: chain, round: buildStoryRoundPayload_(state) };
}

/* -------------------------------------------------------------------------
   action = storyVote
   ------------------------------------------------------------------------- */
function handleStoryVote_(body) {
  const voterId = String(body.voterId || "").trim();
  const artworkId = String(body.artworkId || "").trim();
  if (!voterId || !artworkId) {
    return jsonOut_({ error: "缺少必要欄位（voterId / artworkId）" });
  }

  ensureRoundActive_();
  let state = checkAndFinalizeIfExpired_();

  if (!state || !state.candidates.includes(artworkId)) {
    return jsonOut_({
      error: "這一輪投票已經結束囉，頁面即將更新，請重新整理再投一次",
      round: buildStoryRoundPayload_(state),
    });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    state = getStoryState_();
    if (!state || !state.candidates.includes(artworkId)) {
      return jsonOut_({
        error: "這一輪投票已經結束囉，頁面即將更新，請重新整理再投一次",
        round: buildStoryRoundPayload_(state),
      });
    }
    // 同一個人换票：先把他從所有候選的投票名單中移除，再加進新選的那張
    state.candidates.forEach((id) => {
      state.votes[id] = (state.votes[id] || []).filter((v) => v !== voterId);
    });
    if (!state.votes[artworkId]) state.votes[artworkId] = [];
    state.votes[artworkId].push(voterId);
    saveStoryState_(state);
    return jsonOut_({ success: true, round: buildStoryRoundPayload_(state) });
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================================
   （選用）初始化分頁表頭 — 若你想用程式碼快速建立空白分頁結構，
   可在 Apps Script 編輯器中手動執行這個函式一次
   ========================================================================= */
function setupSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function ensureSheet(name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  ensureSheet(CONFIG.SHEET_ARTWORKS, ARTWORK_HEADERS);
  ensureSheet(CONFIG.SHEET_USERS, USER_HEADERS);
  ensureSheet(CONFIG.SHEET_COMMENTS, COMMENT_HEADERS);
  ensureSheet(CONFIG.SHEET_STORY_CHAIN, STORY_CHAIN_HEADERS);
}

/**
 * 這是給你在 Apps Script 編輯器手動執行用的入口。
 * 因為 setupSheets_ 結尾有底線（Apps Script 的「私有函式」命名慣例），
 * 編輯器上方的函式下拉選單「故意」不會顯示它，所以另外包一個沒有底線的函式，
 * 執行這個 initializeSheets 就可以了。
 */
function initializeSheets() {
  setupSheets_();
}
