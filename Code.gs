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
  // 請填入你要用來備份圖片的 Google Drive 資料夾 ID
  // （在資料夾網址 https://drive.google.com/drive/folders/XXXXXXXX 中，XXXXXXXX 就是 ID）
  DRIVE_BACKUP_FOLDER_ID: "PASTE_YOUR_DRIVE_FOLDER_ID_HERE",
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

  if (!studentName || !imageUrl || !prompt) {
    return jsonOut_({ error: "姓名、圖片連結、Prompt 為必填欄位" });
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

  // 2. 備份圖片到 Google Drive（失敗也不阻擋投稿，只是 DriveBackupURL 留空）
  let backupUrl = "";
  try {
    backupUrl = backupImageToDrive_(imageUrl, studentName);
  } catch (backupErr) {
    backupUrl = "";
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
}
