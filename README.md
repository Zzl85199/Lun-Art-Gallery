# AI 創作畫廊（ㄚ倫老師魔法實驗室）v2

純 HTML/CSS/JS 前端 + Google Apps Script 後端 + Google Sheet/Drive 儲存，
不需要 Node 後端、Firebase 或任何額外付費資料庫。

v2 新增：Google 登入（Google Identity Services）、後端驗證 ID Token、簽章 session
token、圖片直接上傳 Google Drive（含公開/僅畫廊/私人三種可見度）、每班獨立的故事
接龍投票與榮譽榜、雲端保存可跨裝置的故事本、AI 作圖（OpenAI Images API）與每日
額度。舊資料與舊版 Sheet 欄位完全相容，`setupOrMigrate()` 只會新增缺少的欄位/分
頁，不會刪除或覆蓋既有資料。

---

## 一、Google Sheet 與 Apps Script

1. 建立一份新的 Google Sheet（或沿用你原本的那份）。
2. 「擴充功能 → Apps Script」，把 `apps-script/Code.gs` 的內容整份貼進去（綁定腳
   本，會自動抓到目前這份 Sheet）。
3. 左側齒輪圖示「專案設定」→ 時區改成 `(GMT+08:00) 台北時間`（讓每日結算/AI 額度
   重置時間準確落在 Asia/Taipei）。
4. 左側齒輪圖示「指令碼屬性」（Script Properties），新增以下四筆：

   | 屬性名稱 | 說明 |
   |---|---|
   | `GOOGLE_CLIENT_ID` | 見下方「二、Google 登入設定」 |
   | `SESSION_SECRET` | 任意一長串英數亂碼（例如用密碼產生器產生 32+ 字元），用來簽署網站自己的登入 session token，**不要外流** |
   | `OPENAI_API_KEY` | 你的 OpenAI API Key（只用於 AI 作圖；不需要 AI 作圖功能可先留空，但 AI 作圖頁會顯示錯誤） |
   | `DRIVE_BACKUP_FOLDER_ID` | 圖片上傳/備份用的 Google Drive 資料夾 ID（資料夾網址 `.../folders/XXXXXXXX` 裡的 `XXXXXXXX`） |

5. 上方函式下拉選單選 **`setupOrMigrate`**，按「執行」一次。第一次執行會跳出授權
   畫面，需同意 Google Sheets / Drive 的存取權限。執行完成後，所有分頁與欄位都會
   建立好（詳見下方「分頁結構」）。
6. 「部署 → 新增部署作業」→ 類型選「網頁應用程式」：
   - 執行身分：**我**
   - 具有存取權的使用者：**任何人**
7. 部署完成會拿到一個網址（結尾是 `/exec`），把它填入 `js/config.js` 的
   `APPS_SCRIPT_URL`。

之後每次修改 `Code.gs`，都要「部署 → 管理部署作業 → 編輯（鉛筆圖示）→ 版本選新
版本 → 部署」，網址通常不會變，但版本一定要更新，否則改的程式碼不會生效。

---

## 二、Google 登入設定

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) 建立一個專案
   （或沿用現有專案）。
2. 「API 和服務 → OAuth 同意畫面」：設定為「外部」，填基本資訊即可（測試階段可
   把老師/學生 Google 帳號加入「測試使用者」名單，或發布成正式版供任何 Google
   帳號登入，發布前請先確認學校的 Google Workspace 網域政策）。
3. 「API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID」：
   - 應用程式類型：**網頁應用程式**
   - 「已授權的 JavaScript 來源」：填你網站實際的網域，例如：
     - `https://your-username.github.io`（GitHub Pages）
     - 或你自己的網域 `https://your-domain.com`
     - 本機測試也可以加 `http://localhost:5500` 之類的網址
   - 不需要填「已授權的重新導向 URI」（GIS 用的是 One Tap / 按鈕流程，不是傳統
     redirect flow）
4. 建立後會拿到一組 `xxxxxxxx.apps.googleusercontent.com` 的用戶端 ID：
   - 貼到前端 `js/config.js` 的 `GOOGLE_CLIENT_ID`
   - 貼到 Apps Script 的 Script Property `GOOGLE_CLIENT_ID`（兩邊要填**同一組**）

---

## 三、前端設定（`js/config.js`）

```js
const CONFIG = {
  APPS_SCRIPT_URL: "貼上你的 /exec 網址",
  GOOGLE_CLIENT_ID: "貼上你的 xxxxxxxx.apps.googleusercontent.com",
  ...
};
```

把整個 `Lun-Art-Gallery` 資料夾放到任何靜態網站託管（GitHub Pages、Cloudflare
Pages、學校網頁空間…皆可），純前端不需要建置流程。

---

## 四、Google Sheet 分頁結構（`setupOrMigrate()` 會自動建立/補齊）

### AuthorizedUsers
`UserID, GoogleSub, Email, StudentName, Nickname, ClassName, Role, Status, ArtworkAutoApprove, QuotaMode, QuotaLimit, ResetHour, SessionVersion, CreatedAt, ApprovedAt`

- **老師唯一需要手動編輯的分頁**。新帳號申請後 `Status` 會是 `Pending`，老師改成
  `Active` 才能使用受保護功能（投稿、故事接龍、AI 作圖、故事本）；改成
  `Disabled`／`Suspended`／其他非 `Active` 值都會被擋下。
- `ArtworkAutoApprove`：`TRUE` 表示這個人投稿的公開/僅畫廊作品直接上架，不需要
  審核。
- `QuotaLimit` / `ResetHour`：AI 作圖每人每日額度與重置時間（Asia/Taipei 24 小
  時制），可針對個別學生調整。
- `SessionVersion`：正常不需要手動改；老師若想強制某人立即登出（例如帳號被盜
  用），可以把這一列的數字改大（例如 +1），該使用者所有裝置的登入狀態會立刻失
  效，需要重新登入。

### Artworks（在舊欄位上新增）
舊欄位不變：`ID, Timestamp, StudentName, ClassName, ImageURL, DriveBackupURL, Prompt, Description, AITool, Tags, Likes, Approved`
新增：`OwnerUserID, Nickname, DriveFileID, Visibility, AllowStory, Source`

- `Visibility`：`public`（公開，可進畫廊/故事接龍/被他人放進故事本）、
  `gallery_only`（只在畫廊顯示，不可票選/不可被他人取用）、`private`（私人，只
  有本人登入可見，可放進自己的故事本）。
- 老師仍可直接在這個分頁把某件作品的 `Approved` 改成 `TRUE/FALSE` 來控制是否上
  架，或直接編輯 `Visibility`／`AllowStory`。
- 舊資料（沒有 `OwnerUserID` 的列）會被視為 `public`，維持原本畫廊照常顯示的行
  為。

### 其他分頁
- `Comments`：留言（不需登入即可留言，維持原行為）
- `StoryChain`：**舊版**故事接龍資料，保留備存，新版不再寫入
- `StoryRounds` / `StoryVotes` / `HonorBoard`：新版每班獨立故事接龍投票狀態
- `StoryBooks`：故事本（`FramesJSON` 只存 `[{artworkId, caption, order}]`，圖片/
  作者/班級一律即時查 `Artworks` 取得，不重複存）
- `AIUsage`：AI 作圖每人每日用量
- `Settings`：全域可調參數（`Key`/`Value`），見下表，老師可直接改值：

  | Key | 預設值 | 說明 |
  |---|---|---|
  | `STORY_CANDIDATES_PER_ROUND` | 4 | 每輪候選作品數 |
  | `STORY_DAILY_ROLLOVER_HOUR` | 12 | 每日自動結算時間（Asia/Taipei） |
  | `STORY_BOOK_MAX_PAGES` | 30 | 故事本每本最多頁數 |
  | `STORY_BOOK_CHARS_PER_PAGE` | 200 | 每頁文字上限 |
  | `STORY_BOOK_MAX_ACTIVE` | 3 | 每人同時可建立的故事本數 |
  | `AI_DEFAULT_QUOTA_LIMIT` | 5 | 新帳號預設每日 AI 作圖額度 |
  | `AI_DEFAULT_RESET_HOUR` | 0 | 新帳號預設額度重置時間 |
  | `AI_MODEL` | gpt-image-1 | OpenAI 圖片模型 |
  | `AI_SIZE` | 1024x1024 | 圖片尺寸 |
  | `AI_QUALITY` | standard | 圖片品質 |

---

## 五、老師的日常操作

- **審核新帳號**：`AuthorizedUsers` 分頁把 `Status` 從 `Pending` 改成 `Active`。
- **審核投稿**：若該學生 `ArtworkAutoApprove` 不是 `TRUE`，投稿會在 `Artworks`
  分頁以 `Approved=FALSE` 出現，改成 `TRUE` 即上架（僅適用於 `public`／
  `gallery_only`，私人作品不需要審核也不會公開）。
- **調整每人 AI 額度**：`AuthorizedUsers` 分頁改該列的 `QuotaLimit` / `ResetHour`。
- **手動結算故事接龍**：Apps Script 編輯器函式選單選：
  - `advanceStoryRoundForClass`：先在程式碼上方暫時改成
    `advanceStoryRoundForClass("七年一班")` 這樣直接執行，或用「執行 → 帶參數執
    行」功能。
  - `advanceAllStoryRounds`：一次結算所有班級目前進行中的輪次。
- **安裝每日自動結算**：執行一次 `installDailyStoryTrigger`（可重複執行，會先移
  除舊的同名 trigger 再重新安裝，不會裝兩份）。之後每天 `STORY_DAILY_ROLLOVER_HOUR`
  點（預設中午 12:00，Asia/Taipei）會自動結算所有班級並開下一輪。
- **重置故事接龍**：`resetStoryForClass("七年一班")` 只清除該班的
  `StoryRounds`/`HonorBoard`（`StoryVotes` 目前設計為全域共用，重置時會一併清
  空）；`resetAllStory()` 重置全部班級。舊版 `StoryChain` 資料不受影響、也不會
  被刪除。

---

## 六、從舊版升級的最短步驟

1. 貼上新版 `apps-script/Code.gs`，填好四個 Script Properties，執行一次
   `setupOrMigrate()`（不會刪除任何既有資料，只會補齊新欄位/新分頁）。
2. 重新部署 Web App（管理部署作業 → 新版本）。
3. 換上新版前端所有檔案，`js/config.js` 補上 `GOOGLE_CLIENT_ID`。
4. 完成 Google Cloud OAuth 用戶端設定（見「二」）。
5. 通知全班：需要用 Google 帳號登入並填寫申請表（真實姓名／班級／暱稱），老師
   再到 `AuthorizedUsers` 把 `Status` 改成 `Active`（舊資料中的姓名/班級可以先參
   考，但新帳號的授權判斷完全以這個新流程為準）。
6. 舊投稿（沒有 `OwnerUserID`）維持 `public`、可正常在畫廊顯示，但因為找不到擁
   有者，無法被學生自己編輯隱私設定——這是預期行為，教師可直接在 Sheet 上手動調
   整這些舊資料的 `Visibility`。

---

## 七、測試清單

- [ ] 新帳號登入後狀態為 `Pending`，看到「等待審核」提示，無法投稿/故事接龍/AI
      作圖/建故事本
- [ ] 老師改成 `Active` 後，重新整理頁面即可使用上述功能
- [ ] `Disabled`／`Suspended` 帳號被擋下，且提示訊息不同於 `Pending`
- [ ] 同班暱稱重複時，申請/修改暱稱會被拒絕（含全形/半形空白正規化後仍視為重
      複）
- [ ] 上傳圖片設為 `public`／`gallery_only`／`private` 三種都能正確運作：
      - `public`／`gallery_only`：畫廊看得到圖片
      - `private`：畫廊看不到，本人登入後在「我的投稿」看得到圖，且圖片網址帶
        有 `token` 參數（換成別人的 sessionToken 或拿掉 token 應該看不到圖）
- [ ] 網址匯入模式無法選擇「私人」
- [ ] 故事接龍只顯示登入者自己班級的候選作品，看不到其他班的投票
- [ ] 不能投給自己的作品（按鈕會顯示提示文字而非投票按鈕）
- [ ] 同一人可以在結算前改票，改票後只留一筆紀錄（檢查 `StoryVotes` 分頁該
      `RoundID+UserID` 只有一列）
- [ ] 手動執行 `advanceStoryRoundForClass` 後，`HonorBoard` 出現前三名、開新一
      輪候選
- [ ] 安裝 `installDailyStoryTrigger` 後，隔天中午（或你設定的時間）自動結算（
      可先改 `STORY_DAILY_ROLLOVER_HOUR` 成快到的時間測試）
- [ ] 故事本在瀏覽器 A 建立/編輯後，用另一台裝置（或無痕視窗）登入同一帳號，能
      看到相同內容
- [ ] AI 作圖：額度用到第 4 次（5 次上限時）出現 70% 提醒；用滿 5 次後按鈕停用
      且後端拒絕
- [ ] 開兩個分頁同時快速點兩次「產生圖片」（模擬雙擊/多分頁），最多只成功扣一
      次額度、不會超額生成
- [ ] 刻意讓 OpenAI 呼叫失敗（例如暫時填錯 `OPENAI_API_KEY`），確認失敗後額度
      有退還（`AIUsage` 分頁 `UsedCount` 沒有增加）

---

## 八、注意事項

- 這是課堂教學工具，不是正式商用系統：Session 採用簽章 token（HMAC-SHA256 +
  Script Property 密鑰）而非第三方身份提供者的完整 session 管理；Google ID
  Token 的簽章驗證透過 Google 官方 `tokeninfo` 端點完成（Apps Script 沒有內建
  RSA 驗簽能力），已檢查 `aud`／`iss`／`exp`／`email_verified`。
- 私人圖片一律不設定 `ANYONE_WITH_LINK`，讀取一律經過 Apps Script 驗證
  `session token` 與 `OwnerUserID` 後才會把 Google Drive 檔案內容代理回傳，不會
  只靠隱藏網址防護。
- 老師仍可直接在 Google Sheet／Google Drive 管理所有資料，本專案刻意不做管理後
  台頁面。
