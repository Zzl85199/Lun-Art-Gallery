# OO班 AI 創作畫廊

一個「教室黑板布告欄 / 軟木塞公佈欄」風格的靜態網站，用來展示學生的 AI 生成作品。
完全免費運作：前端是純 HTML/CSS/JS，資料庫是 Google Sheet，後端是 Google Apps Script，圖片放 Imgur（並自動備份到 Google Drive）。

---

## 專案結構

```
ai-gallery/
├── index.html          # 首頁
├── gallery.html        # 畫廊頁（篩選、搜尋）
├── submit.html         # 我要投稿頁
├── about.html          # 關於頁
├── css/
│   └── style.css       # 全站樣式（黑板 + 軟木塞風格）
├── js/
│   ├── config.js       # 設定檔（Apps Script 網址、班級/AI工具清單）
│   ├── api.js          # 呼叫 Apps Script 的 API 封裝
│   ├── main.js         # 共用邏輯：卡片渲染、Modal、按讚、留言
│   ├── home.js         # 首頁專用
│   ├── gallery.js      # 畫廊頁專用
│   └── submit.js       # 投稿頁專用
├── apps-script/
│   └── Code.gs          # 貼到 Google Apps Script 的後端程式碼
└── README.md
```

---

## 第一步：建立 Google Sheet 資料庫

1. 到 [Google Sheets](https://sheets.google.com) 建立一份新的試算表，命名為「AI創作畫廊資料庫」之類的名稱。
2. 建立 **三個分頁（tab）**，分頁名稱與欄位順序請完全照抄（大小寫也要一致，因為程式碼會用欄位名稱對應）：

### 分頁 1：`Artworks`

| ID | Timestamp | StudentName | ClassName | ImageURL | DriveBackupURL | Prompt | Description | AITool | Tags | Likes | Approved |
|----|-----------|-------------|-----------|----------|----------------|--------|--------------|--------|------|-------|----------|

這個分頁**不需要手動填資料**，投稿表單送出後會自動寫入。

### 分頁 2：`AuthorizedUsers`

| StudentName | ClassName | Status | AutoApprove |
|-------------|-----------|--------|-------------|

老師要手動維護這個分頁：
- 想授權某學生（或老師）可以投稿，就新增一列，`Status` 填 `Active`。
- 想撤銷投稿權限，把 `Status` 改成 `Inactive`（或直接刪除該列）。
- `AutoApprove` 填 `TRUE`：該學生投稿後**直接上架**，不需要審核。
- `AutoApprove` 填 `FALSE`：該學生投稿後會先進入**待審核**狀態，要老師手動把 `Artworks` 分頁裡對應那一列的 `Approved` 改成 `TRUE` 才會顯示在畫廊。

範例：

| StudentName | ClassName | Status | AutoApprove |
|-------------|-----------|--------|-------------|
| 王小明 | 七年一班 | Active | TRUE |
| 陳小美 | 七年一班 | Active | FALSE |
| 李老師 | 七年一班 | Active | TRUE |

### 分頁 3：`Comments`

| ArtworkID | CommenterName | Comment | Timestamp |
|-----------|----------------|---------|-----------|

這個分頁也不需要手動填，留言會自動寫入。

> 💡 小技巧：你也可以不手動打表頭，改用 Apps Script 裡內建的 `setupSheets_()` 函式（見下方步驟 5）自動建立三個分頁與表頭。

---

## 第二步：建立 Google Drive 圖片備份資料夾

1. 到 [Google Drive](https://drive.google.com) 新增一個資料夾，例如「AI畫廊圖片備份」。
2. 打開這個資料夾，網址列會顯示類似：
   `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`
   後面那串 `1AbCdEfGhIjKlMnOpQrStUvWxYz` 就是資料夾 ID，先複製起來待會會用到。
3. 資料夾權限不需要另外設定「知道連結的使用者可檢視」——Apps Script 會針對**每一個備份檔案**自動設定為「知道連結的使用者可檢視」，資料夾本身維持預設（僅擁有者）即可，比較安全。

---

## 第三步：部署 Google Apps Script 後端

1. 打開你剛建立的 Google Sheet，點選選單「**擴充功能 → Apps Script**」，會開啟一個新的 Apps Script 專案（這種寫法叫「綁定腳本」，程式碼會自動對應到目前這份 Sheet，不需要填 Sheet ID）。
2. 把預設的 `Code.gs` 裡的內容全部刪除，貼上本專案 `apps-script/Code.gs` 的完整內容。
3. 找到程式碼開頭的：
   ```js
   const CONFIG = {
     ...
     DRIVE_BACKUP_FOLDER_ID: "PASTE_YOUR_DRIVE_FOLDER_ID_HERE",
   };
   ```
   把 `PASTE_YOUR_DRIVE_FOLDER_ID_HERE` 換成第二步拿到的資料夾 ID。
4. （選用）如果你的 Sheet 分頁還沒有建立表頭，可以在 Apps Script 編輯器上方的函式下拉選單選擇 `setupSheets_`，按「執行」，它會自動幫你建立三個分頁與正確的表頭。第一次執行會跳出授權畫面，請同意權限。
5. 點右上角「**部署 → 新增部署作業**」：
   - 類型選擇「**網頁應用程式**」
   - 說明可填「AI畫廊後端 v1」
   - **執行身分**：選「**我**」（這樣才能用你的權限存取 Sheet 與 Drive）
   - **具有存取權的使用者**：選「**任何人**」（這樣學生和訪客才能不用登入 Google 就能讀取/投稿）
   - 按「部署」
6. 第一次部署會要求授權，會跳出如下畫面：
   - 選擇你的 Google 帳號
   - 出現「未經驗證」警告時，點「進階」→「前往（專案名稱）(不安全)」（這是正常的，因為這是你自己寫的腳本，Google 對所有個人開發的 Apps Script 都會顯示這個警告）
   - 同意以下權限：
     - 查看、編輯、建立及刪除你的 Google 試算表
     - 查看、編輯、建立及刪除你在 Google 雲端硬碟中的檔案
     - 以 Web 應用程式的形式連線至外部服務（因為要用 `UrlFetchApp` 抓取 Imgur 圖片）
7. 部署完成後，會顯示一個網址，格式類似：
   ```
   https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec
   ```
   複製這個網址（結尾是 `/exec`）。

> ⚠️ 之後如果你修改了 `Code.gs` 程式碼，記得要「部署 → 管理部署作業 → 點編輯（鉛筆圖示）→ 版本選『新版本』→ 部署」，否則改動不會生效。單純儲存檔案（Ctrl+S）不會更新已部署的網址。

---

## 第四步：設定前端

打開 `js/config.js`，把 `APPS_SCRIPT_URL` 換成第三步拿到的網址：

```js
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxx/exec",
  ...
};
```

你也可以在這裡調整：
- `SITE_TITLE`：網站標題
- `CLASSES`：投稿表單的班級下拉選單選項
- `AI_TOOLS`：投稿表單的 AI 工具下拉選單選項

---

## 第五步：部署前端網站（免費）

這是純靜態網站，選一個免費平台放上去即可，三選一：

### 方法 A：GitHub Pages
1. 把整個 `ai-gallery/` 資料夾內容 push 到一個 GitHub repo。
2. 到 repo 的 Settings → Pages，Source 選擇你的分支（例如 `main`）與根目錄。
3. 幾分鐘後就會拿到一個 `https://你的帳號.github.io/repo名稱/` 網址。

### 方法 B：Netlify
1. 到 [netlify.com](https://netlify.com) 註冊。
2. 直接把整個資料夾拖曳到 Netlify 的部署頁面（Drag and drop），或連接 GitHub repo 自動部署。

### 方法 C：Vercel
1. 到 [vercel.com](https://vercel.com) 註冊，連接 GitHub repo 即可自動部署（因為是純靜態網站，不需要任何建置設定）。

---

## 即時更新（Live Update）是怎麼做到的？

**不需要換平台**，GitHub Pages / Netlify / Vercel 三個原本推薦的免費靜態平台都能直接支援這個功能。因為這裡用的不是「動態網站」等級的技術（伺服器渲染、WebSocket），而是**前端定期輪詢（polling）**：

- **畫廊頁**：每 15 秒重新向 Apps Script 要一次最新作品清單，跟畫面上現有的資料比對：
  - 有新投稿 → 淡入插入一張新卡片（若符合目前的篩選條件）
  - 有作品被下架 → 該卡片會從畫面移除
  - 有讚數變化 → 只更新數字，不會整個重新渲染，也不會打斷你正在滑的畫面
- **首頁精選區**：每 20 秒同步一次讚數，但**不會**重新抽選精選作品，避免瀏覽中版面跳動。
- **作品詳細 Modal**：開著的時候每 8 秒檢查一次留言是否有更新，並且如果有其他人剛好按讚，也會同步更新 modal 裡顯示的讚數。
- 切到別的瀏覽器分頁時（`document.hidden`），輪詢會自動暫停；切回來的瞬間會立刻補抓一次最新資料，不會浪費 Apps Script 的每日執行配額。

如果你想要更「真即時」（例如按讚的瞬間所有人畫面立刻跳動，而不是等最多 15 秒），可以之後再加一層真正的推播服務（例如免費方案的 Firebase Realtime Database 或 Pusher），但那樣會多一個要維護的免費帳號，對班級規模的使用情境來說，目前的輪詢方式已經足夠流暢，也維持了「只需要 Google Sheet + Apps Script」的最簡單架構。



- **首頁 / 畫廊頁**：呼叫 `GET {APPS_SCRIPT_URL}` 取得所有 `Approved=TRUE` 的作品 JSON。
- **作品詳細 Modal**：呼叫 `GET {APPS_SCRIPT_URL}?action=comments&artworkId=xxx` 取得該作品的留言。
- **投稿頁**：呼叫 `POST {APPS_SCRIPT_URL}`，body 為 `{ action: "submit", studentName, className, imageUrl, aiTool, prompt, description, tags }`。
  - 後端會先比對 `AuthorizedUsers` 分頁確認 `Status=Active`。
  - 用 `UrlFetchApp` 抓取 Imgur 圖片，備份一份到 Google Drive，寫入 `DriveBackupURL`。
  - 依 `AutoApprove` 決定新資料的 `Approved` 是 `TRUE` 還是 `FALSE`。
- **按讚**：呼叫 `POST {APPS_SCRIPT_URL}`，body 為 `{ action: "like", artworkId }`，該筆資料的 `Likes` +1。前端用 `localStorage` 記錄已按讚的作品 ID，避免同一裝置重複按讚。
- **留言**：呼叫 `POST {APPS_SCRIPT_URL}`，body 為 `{ action: "comment", artworkId, commenterName, comment }`，寫入 `Comments` 分頁。
- **圖片備援**：前端 `<img>` 的 `onerror` 事件會自動切換成 `DriveBackupURL`，Imgur 掛掉也不會斷圖。

---

## 投稿失敗（HTTP 404）怎麼排查？

如果送出投稿後看到「投稿失敗：網路連線失敗 (HTTP 404)」，幾乎都是 `js/config.js` 裡的 `APPS_SCRIPT_URL` 設定錯誤，跟程式碼本身無關。請照這個順序檢查：

1. **打開 `js/config.js`，確認網址的格式**：正確的網址一定是這種格式，結尾是 `/exec`：
   ```
   https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec
   ```
   最常見的錯誤是複製到 Apps Script **編輯器**的網址（網址裡會有 `/home/projects/` 或 `/edit`），那個是給你自己編輯程式碼用的頁面，不是給網站呼叫的 API 網址，用那個一定會 404。

2. **確認部署方式是「新增部署作業」而不是「測試部署作業」**：Apps Script 編輯器右上角「部署」按鈕旁如果有下拉選單，要選「**新增部署作業**」，類型選「**網頁應用程式**」，才會拿到正式、永久有效的 `/exec` 網址。「測試部署作業」給的網址只有你自己登入時能用，其他人（包括你的網站）呼叫會失敗。

3. **如果你確定網址正確，但最近又修改過 `Code.gs`**：修改程式碼後一定要「部署 → 管理部署作業 → 點編輯（鉛筆圖示）→ 版本選『新版本』→ 部署」，單純儲存檔案不會更新已經發布的網址內容。

4. **打開瀏覽器開發者工具確認實際請求的網址**：在投稿頁按 F12 開啟開發者工具，切到 **Network（網路）** 分頁，重新送出一次投稿，找到那個失敗的請求，點進去看「Request URL」，跟 `js/config.js` 裡設定的網址逐字比對，看有沒有多打或少打字元。

5. **確認 Google Sheet 的三個分頁名稱完全正確**：`Artworks`、`AuthorizedUsers`、`Comments`，大小寫、有沒有多空格都要一致，否則會出現「找不到分頁」的錯誤（但這種通常會顯示別的錯誤訊息，不是 404）。

## 老師的日常操作

- **審核投稿**：打開 `Artworks` 分頁，找到 `Approved` 是 `FALSE` 的列，確認內容合適後手動改成 `TRUE`，該作品就會出現在畫廊（可能需要等前端下次重新讀取，通常是使用者重新整理頁面時）。
- **管理投稿權限**：在 `AuthorizedUsers` 分頁新增/刪除/修改列即可，即時生效（下一次投稿時會重新檢查）。
- **下架某作品**：把 `Artworks` 分頁對應列的 `Approved` 改成 `FALSE`，或直接刪除整列。

---

## 已知限制與提醒

- **Apps Script 每日配額**：免費 Google 帳號的 Apps Script 有每日執行時間與 `UrlFetchApp` 呼叫次數上限（一般教學/班級規模用量通常足夠）。若配額用盡，前端會顯示清楚的錯誤訊息與「重新載入」按鈕，而不是空白頁面。
- **Imgur 連結格式**：投稿表單請提醒學生貼「圖片直接連結」（例如 `https://i.imgur.com/xxxxx.jpg`），而不是 Imgur 的相簿頁面網址，否則備份圖片會抓取失敗。
- **CORS 說明**：前端 `POST` 請求使用 `Content-Type: text/plain;charset=utf-8` 而非 `application/json`，這是刻意的作法，用來避免瀏覽器對 Apps Script 發出 CORS 預檢請求（preflight）失敗的問題。`Code.gs` 內的 `doPost` 會自行用 `JSON.parse(e.postData.contents)` 解析。
- **未設定網址時的提示**：如果忘記在 `js/config.js` 填入正確的 `APPS_SCRIPT_URL`，網站會顯示「尚未設定 Apps Script 網址」的錯誤訊息，方便除錯。

---

## 客製化風格

網站的黑板／軟木塞視覺變數都集中在 `css/style.css` 檔案最上方的 `:root` CSS 變數區塊，包含顏色、字型等，可依需求直接調整，例如：

```css
:root {
  --blackboard: #1b3328;   /* 黑板底色 */
  --cork: #c9a06a;         /* 軟木塞底色 */
  --chalk-yellow: #f4e285; /* 粉筆黃（強調色） */
  ...
}
```

字型使用 Google Fonts：`Ma Shan Zheng`（中文粉筆標題）、`Zhi Mang Xing`（中文手寫便條字）、`Kalam`（英文粉筆字）、`Noto Sans TC`（中文正文）。
