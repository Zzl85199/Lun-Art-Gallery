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
3. **加入「Drive API」進階服務（必要，不加這步圖片相關功能會失敗）**：左側「服
   務」旁邊的 ＋ 號 → 選 **Drive API** → 版本選 **v3** → 新增。這是因為內建的
   `DriveApp` 服務在部分環境下，讀取檔案內容／修改分享權限這兩件事會被擋下來
   （出現 `Access denied: DriveApp.`），改用這個進階服務直接呼叫 Drive REST API
   可以繞過這個問題，本專案的圖片上傳/隱私切換/私人圖片讀取都仰賴這個服務。
4. 左側齒輪圖示「專案設定」→ 時區改成 `(GMT+08:00) 台北時間`（讓每日結算/AI 額度
   重置時間準確落在 Asia/Taipei）。
5. 左側齒輪圖示「指令碼屬性」（Script Properties），新增以下四筆：

   | 屬性名稱 | 說明 |
   |---|---|
   | `GOOGLE_CLIENT_ID` | 見下方「二、Google 登入設定」 |
   | `SESSION_SECRET` | 任意一長串英數亂碼（例如用密碼產生器產生 32+ 字元），用來簽署網站自己的登入 session token，**不要外流** |
   | `OPENAI_API_KEY` | 你的 OpenAI API Key（只用於 AI 作圖；不需要 AI 作圖功能可先留空，但 AI 作圖頁會顯示錯誤） |
   | `DRIVE_BACKUP_FOLDER_ID` | 圖片上傳/備份用的 Google Drive 資料夾 ID（資料夾網址 `.../folders/XXXXXXXX` 裡的 `XXXXXXXX`） |

6. 上方函式下拉選單選 **`setupOrMigrate`**，按「執行」一次。第一次執行會跳出授權
   畫面，需同意 Google Sheets / Drive 的存取權限。執行完成後，所有分頁與欄位都會
   建立好（詳見下方「分頁結構」）。
7. 「部署 → 新增部署作業」→ 類型選「網頁應用程式」：
   - 執行身分：**我**
   - 具有存取權的使用者：**任何人**
8. 部署完成會拿到一個網址（結尾是 `/exec`），把它填入 `js/config.js` 的
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
`UserID, GoogleSub, Email, StudentName, Nickname, ClassName, Role, Status, ArtworkAutoApprove, QuotaMode, QuotaLimit, ResetHour, SessionVersion, CreatedAt, ApprovedAt, CharacterSheet`

- **老師唯一需要手動編輯的分頁**。新帳號申請後 `Status` 會是 `Pending`，老師改成
  `Active` 才能使用受保護功能（投稿、故事接龍、AI 作圖、故事本）；改成
  `Disabled`／`Suspended`／其他非 `Active` 值都會被擋下。`Status` 欄有下拉選單
  （`Pending/Active/Disabled/Suspended/Inactive`），但仍可直接打字打入清單外的
  文字，不會被拒絕。
- `ArtworkAutoApprove`：`TRUE` 表示這個人投稿的公開/僅畫廊作品直接上架，不需要
  審核。
- `QuotaLimit` / `ResetHour`：AI 作圖每人每日額度與重置時間（Asia/Taipei 24 小
  時制），可針對個別學生調整。
  - ⚠️ `AI_DEFAULT_QUOTA_LIMIT` **只會套用在新申請的帳號**。改了預設值之後，既有
    帳號這一欄還是舊數字，要讓所有人一起改請執行 `setAllUsersQuotaLimit()`；
    重置時間同理，用 `setAllUsersResetHour()`。
- `SessionVersion`：正常不需要手動改；老師若想強制某人立即登出（例如帳號被盜
  用），可以把這一列的數字改大（例如 +1），該使用者所有裝置的登入狀態會立刻失
  效，需要重新登入。
- `CharacterSheet`：學生在「AI 作圖」頁填寫的角色設定小抄（外觀描述），每次生
  成時會自動接在 Prompt 最前面，幫助同一個角色在故事不同頁面盡量長得一樣。學生
  自己在頁面上編輯，老師通常不需要動這欄。

### Artworks（在舊欄位上新增）
舊欄位不變：`ID, Timestamp, StudentName, ClassName, ImageURL, DriveBackupURL, Prompt, Description, AITool, Tags, Likes, Approved`
新增：`OwnerUserID, Nickname, DriveFileID, Visibility, AllowStory, Source, NeedsManualPublish, VisibilityUpdatedAt`

- `Visibility`：`public`（公開，可進畫廊/故事接龍/被他人放進故事本）、
  `gallery_only`（只在畫廊顯示，不可票選/不可被他人取用）、`private`（私人，只
  有本人登入可見，可放進自己的故事本）。
- 老師仍可直接在這個分頁把某件作品的 `Approved` 改成 `TRUE/FALSE` 來控制是否上
  架，或直接編輯 `Visibility`／`AllowStory`。
- 舊資料（沒有 `OwnerUserID` 的列）會被視為 `public`，維持原本畫廊照常顯示的行
  為。
- `NeedsManualPublish`：`TRUE` 代表這件作品投稿或切換公開範圍時，Drive 分享設定
  失敗過，系統已經自動標記成審核中（`Approved=FALSE`），等老師確認。老師可以直
  接在這個分頁**用篩選器只顯示 `NeedsManualPublish=TRUE` 的列**一次看到所有需要
  處理的作品，確認 `Visibility` 是學生想要的值後，把 `Approved` 改成 `TRUE` 即
  可（不需要對 Drive 做任何額外設定，圖片本來就顯示得出來）。也可以執行
  `approveAllNeedsManualPublish()` 一次核准所有這類作品，不用一列一列改。
- `VisibilityUpdatedAt`：這件作品的 `Visibility` 最後一次被投稿或被學生自己修改
  的時間，方便老師搭配 `StudentName` 欄篩選，快速找到「某個學生最近改了哪張圖的
  公開範圍、什麼時候改的」。

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
  | `AI_DEFAULT_QUOTA_LIMIT` | 30 | 新帳號預設每日 AI 作圖額度 |
  | `AI_DEFAULT_RESET_HOUR` | 23 | 新帳號預設額度重置時間（配合固定的 59 分 59 秒，等於每天 23:59:59 重置） |
  | `MAX_ARTWORKS_PER_USER` | 94 | 每個帳號最多能擁有幾件作品，達上限就不能再用 AI 作圖產生新圖（前端 `js/config.js` 有同名設定，兩邊要一起改） |

  另外，結果視窗裡「微調後再產生一次」的次數上限只在前端設定：
  `js/config.js` 的 `MAX_TWEAKS_PER_IMAGE`（預設 5）。每次微調都會真的呼叫一次
  AI，所以也會扣掉每日總額度裡的 1 次；後端不需要另外設定。
  | `AI_MODEL` | gpt-image-1 | OpenAI 圖片模型 |
  | `AI_SIZE` | 1024x1024 | 圖片尺寸 |
  | `AI_QUALITY` | medium | 圖片品質（gpt-image-1 系列只接受 low/medium/high/auto，不是 dall-e-3 那組 standard/hd） |
  | `STALE_PRIVATE_AI_DAYS` | 60 | 私人 AI 產圖超過這麼多天沒被公開，`cleanupStalePrivateAiArtworks()` 會視為可清理（見下方「AI 產圖清理」） |

---

## 五、老師的日常操作

- **審核新帳號**：`AuthorizedUsers` 分頁把 `Status` 從 `Pending` 改成 `Active`。
- **審核投稿**：若該學生 `ArtworkAutoApprove` 不是 `TRUE`，投稿會在 `Artworks`
  分頁以 `Approved=FALSE` 出現，改成 `TRUE` 即上架（僅適用於 `public`／
  `gallery_only`，私人作品不需要審核也不會公開）。**注意：`Approved` 是在「投稿當
  下」依那個時間點的 `ArtworkAutoApprove` 值決定的，之後才把 `ArtworkAutoApprove`
  改成 `TRUE`，並不會讓已經送出、還在等待審核的舊投稿自動變成已上架**——需要老師
  手動把那幾筆舊資料的 `Approved` 改成 `TRUE`，或請學生重新投稿一次。另外，帳號/
  投稿相關的讀取有 15 秒的暫存（cache），手動改完 Sheet 後最多等 15 秒生效。
- **學生跳出「請老師協助」的提示視窗**：這代表學生投稿或切換公開範圍時，系統嘗試
  設定 Google Drive 分享權限失敗了（環境限制造成，詳見下方疑難排解），系統會自動
  把這件作品標記為 `Approved=FALSE`、`NeedsManualPublish=TRUE`（審核中），並用
  後端代理讓圖片還是能正常顯示。老師可以：
  - 到 `Artworks` 分頁**篩選 `NeedsManualPublish=TRUE`**，一次看到所有卡住的作品，
    確認 `Visibility` 沒問題後把 `Approved` 改成 `TRUE`；或
  - 直接在 Apps Script 編輯器執行一次 **`approveAllNeedsManualPublish()`**，一鍵
    核准所有這類作品，不用一列一列改。
  - 不需要額外去 Drive 做任何分享設定，圖片本來就顯示得出來（見下方「圖片顯示機
    制」說明）。
- **調整每人 AI 額度**：`AuthorizedUsers` 分頁改該列的 `QuotaLimit` / `ResetHour`。
- **一次調整所有人的 AI 額度**：Apps Script 編輯器執行 `setAllUsersQuotaLimit()`
  （數值取自 `DEFAULT_SETTINGS.AI_DEFAULT_QUOTA_LIMIT`，目前是 30）。重置時間則用
  `setAllUsersResetHour()`。兩個函式都可以重複執行，不會弄壞既有資料。
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

## 七、AI 作圖：角色一致性功能

- **角色設定小抄（必填）**：學生在「AI 作圖」頁填一段角色外觀描述（例如：橘色短
  毛貓、紅色圍巾），存進 `AuthorizedUsers.CharacterSheet`，之後每次生成都會自動
  接在 Prompt 最前面。這是純文字拼接，能避免「同一隻貓一下橘色一下黑色」這種明
  顯不一致，但無法保證每次構圖細節完全相同。
- **參考圖（選填）**：學生可以從自己之前的作品裡選一張當「參考圖」，這時後端會
  改呼叫 OpenAI 的 `/v1/images/edits`（而不是一般的 `/v1/images/generations`），
  並帶入 `input_fidelity: "high"`，讓模型盡量保留參考圖的臉部/風格特徵，效果比
  純文字提示更接近「同一個角色」。只允許選「自己名下的作品」或「別人已上架的公
  開作品」當參考圖，不能拿別人的私人作品。
- 兩者可以同時使用（角色小抄 + 參考圖），也可以只用其中一種。

## 八、AI 產圖的長期空間管理（選用功能）

學生用 AI 作圖產生的圖片預設是「私人」，如果一直沒有人去把它設為公開或僅畫廊，就會一直占用
Google Drive 空間。這是選用（預設不會自動執行）的清理機制：

- `cleanupStalePrivateAiArtworks()`：刪除「來源是 AI（`Source=OpenAI`）且目前仍是私人狀態、
  超過 `Settings.STALE_PRIVATE_AI_DAYS`（預設 60 天）沒有被公開」的作品，同時刪除 Drive 上的
  原始檔案與 Artworks 分頁裡對應的那一列。**刻意只清理 AI 產圖**，不會動任何學生自己上傳或
  網址匯入的私人作品（那些可能是特意想保留的東西，不該被系統自動刪除）。
- 可以隨時在 Apps Script 編輯器手動執行一次 `cleanupStalePrivateAiArtworks()` 立即清一次；
- 如果想要**每天自動清理**，執行一次 `installStaleImageCleanupTrigger()`（每天凌晨 3 點執行，
  可重複執行不會裝兩份 trigger）；
- 想調整幾天算「過期」，改 `Settings` 分頁的 `STALE_PRIVATE_AI_DAYS` 這一列的值即可，不需要
  重新部署。
- AI 作圖頁生成成功後，畫面上也會提醒學生「私人的 AI 產圖如果一直沒調整公開範圍，之後可能
  會被清理」，鼓勵他們自己決定要不要留下來。

## 九、疑難排解：`Unexpected error while getting the method or property getFolderById on object DriveApp`

如果 Script Property 裡的 `DRIVE_BACKUP_FOLDER_ID` 確認格式正確（純 ID、無網址前
綴、無多餘空白），仍然出現這個錯誤，通常是 Apps Script 專案的**授權範圍
（OAuth scope）不夠廣**，最常見在「後來才補上 Drive 相關程式碼」的專案上發生：

1. Apps Script 編輯器左側齒輪「專案設定」→ 勾選「在編輯器中顯示
   `appsscript.json` 資訊清單檔案」。
2. 左側檔案列表會多出 `appsscript.json`，打開它，確認 `oauthScopes` 陣列裡有包
   含 `"https://www.googleapis.com/auth/drive"`（完整雲端硬碟權限）。如果沒有，
   手動加進陣列存檔。
3. 存檔後回到任何一支函式（例如 `setupOrMigrate`），直接在編輯器「執行」一次
   ——這時應該會跳出一個新的 Google 授權畫面，內容包含「查看、編輯、建立及刪除
   你 Google 雲端硬碟中的所有檔案」，按下同意。
4. 同意後再測試投稿或 AI 作圖，應該就能正常寫入 Drive 了。如果想確認是不是這個
   問題，可以先貼一個小測試函式單獨執行看錯誤訊息：
   ```js
   function testDriveFolder() {
     const folder = DriveApp.getFolderById(getProp_("DRIVE_BACKUP_FOLDER_ID", true));
     Logger.log("資料夾名稱：" + folder.getName());
   }
   ```

### 網頁上出現 `Access denied: DriveApp.`（例如把私人作品改成公開、或上傳圖片時）

**已知根因並已在程式碼裡修正**：實測發現在部分環境下，內建的 `DriveApp` 服務可以正常「建立」
新檔案（`folder.createFile()`），但「讀取既有檔案內容」（`getBlob()`）與「修改分享權限」
（`setSharing()`）這兩件事會被擋下來，即使是剛建立的檔案也一樣，出現
`Access denied: DriveApp.`。這不是授權範圍宣告錯誤，也不是忘記重新部署，而是 `DriveApp`
這個簡化封裝本身在某些帳號/專案環境下對這兩種操作有限制。

**解法**：本專案已經改用「進階 Drive API 服務」（直接呼叫 Drive REST API v3，繞過
`DriveApp` 的封裝）來處理讀取圖片內容與修改分享權限，只有「建立新檔案」還是用
`DriveApp`（這個操作本來就正常運作）。要讓這個修正生效，**部署前必須先手動加入這個服務**：

1. Apps Script 編輯器左側「服務」旁邊的 ＋ 號
2. 選擇 **Drive API**，版本選 **v3**，按「新增」
3. 加入後不需要寫任何額外程式碼（程式碼裡已經是呼叫 `Drive.Files.get(...)`、
   `Drive.Permissions.create(...)` 這類語法），直接部署新版本即可
4. 如果一開始建立 Apps Script 專案時就用這份新版 `Code.gs`，記得在執行
   `setupOrMigrate` 或任何函式之前，就要先完成這個「加入服務」的步驟

如果加了 Drive API 服務、也部署了新版本，還是看到一樣的錯誤，請截圖「服務」清單給我
確認版本是不是選成 v2（部分語法在 v2/v3 之間不通用）。

### 圖片顯示機制：為什麼不直接用 Google Drive 給的公開網址？

Google Drive 的 `https://drive.google.com/uc?export=view&id=...` 這種公開連結，直接當
`<img src>` 嵌入外部網站經常不穩定（有時會被導向病毒掃描確認頁、或被部分瀏覽器的防護機制
擋掉），跟「Drive 分享設定本身有沒有成功」是兩回事。所以即使分享設定成功、拿到這個網址，
本專案的**上傳/AI 產圖一律不直接用這個網址顯示，一律透過後端代理讀取內容**（前端拿到
base64 圖片資料後組成 `data:` 網址顯示）。網址匯入模式（例如貼 imgur/meee 連結）因為本來
就是外部圖床的正常連結，不受影響，維持直接顯示。

**這個設計的取捨**：好處是圖片顯示不再依賴 Google Drive 公開連結的不穩定行為，只要
`Drive.Files.get()` 讀得到內容就能顯示；代價是每一張 Drive 圖片現在都要多一次呼叫
Apps Script 後端（不再是瀏覽器直接跟 Google 的圖片伺服器要資料），對 Apps Script 的執行
配額會有比較高的負擔。以一個班級的規模（幾十人、平常使用量）通常沒有問題；如果之後真的
遇到載入變慢或配額吃緊，可以再討論要不要針對「已確認能穩定顯示」的圖片改回直接網址。

## 十、測試清單

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
- [ ] AI 作圖：額度用到 70%（30 次上限時是第 21 次）出現提醒；用滿 30 次後按鈕停
      用且後端拒絕
- [ ] AI 作圖：產生按鈕的括號內顯示正確的剩餘次數；重置時間顯示為 23:59:59
- [ ] AI 作圖：作品數達到 `MAX_ARTWORKS_PER_USER`（94）時，按產生圖片會跳出
      「請先刪除一些作品再來產圖吧！」且不會送出請求
- [ ] AI 作圖：產生成功後跳出結果視窗，「下載 PNG」能存到電腦，視窗下方顯示這次
      用的完整 Prompt
- [ ] AI 作圖：產生過的 Prompt 會出現在下拉選單，選了會填回完整 Prompt 欄位
- [ ] AI 作圖：結果視窗裡改 Prompt 後按「微調後再產生一次」，圖片會換成新的一張，
      按鈕的剩餘次數 -1，今日已用次數 +1
- [ ] AI 作圖：微調滿 5 次後按鈕停用；關掉視窗、從主表單重新產生一張後，微調次數
      回到 5 次
- [ ] AI 作圖：微調時勾選「以現在這張圖為基礎」，新圖的角色/風格會延續前一張；取消
      勾選則是純文字重新生成
- [ ] AI 作圖：微調時如果今日額度剛好用完，按鈕會變成「今日額度已用完」且不送出
- [ ] 導覽列：未登入只看得到「首頁 / 畫廊」，登入後才出現「我的頁面 / AI 作圖 /
      故事接龍」
- [ ] 開兩個分頁同時快速點兩次「產生圖片」（模擬雙擊/多分頁），最多只成功扣一
      次額度、不會超額生成
- [ ] 刻意讓 OpenAI 呼叫失敗（例如暫時填錯 `OPENAI_API_KEY`），確認失敗後額度
      有退還（`AIUsage` 分頁 `UsedCount` 沒有增加）

---

## 十一、注意事項

- 這是課堂教學工具，不是正式商用系統：Session 採用簽章 token（HMAC-SHA256 +
  Script Property 密鑰）而非第三方身份提供者的完整 session 管理；Google ID
  Token 的簽章驗證透過 Google 官方 `tokeninfo` 端點完成（Apps Script 沒有內建
  RSA 驗簽能力），已檢查 `aud`／`iss`／`exp`／`email_verified`。
- 私人圖片一律不設定 `ANYONE_WITH_LINK`，讀取一律經過 Apps Script 驗證
  `session token` 與 `OwnerUserID` 後才會把 Google Drive 檔案內容代理回傳，不會
  只靠隱藏網址防護。
- 老師仍可直接在 Google Sheet／Google Drive 管理所有資料，本專案刻意不做管理後
  台頁面。
