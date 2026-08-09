/**
 * ===============================================================
 * 網站設定
 * ===============================================================
 * 請把下方 APPS_SCRIPT_URL 換成你部署 Google Apps Script 後拿到的
 * Web App 網址（結尾通常是 /exec），並把 GOOGLE_CLIENT_ID 換成你
 * 在 Google Cloud Console 建立的 OAuth 2.0 用戶端 ID。
 *
 * 部署步驟請參考 README.md 與 apps-script/Code.gs 檔案開頭的說明。
 * ===============================================================
 */
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbx-ZYMr-gvItRFwKY4FR2L6Zp4H5ybaIqmGRg6qdwpfSeluxr-kPoaX3zYCvscN87Vf/exec", // 例如 https://script.google.com/macros/s/xxxxxxxx/exec
  // 在 Google Cloud Console →「憑證」建立的 OAuth 用戶端 ID（應用程式類型：網頁應用程式）
  GOOGLE_CLIENT_ID: "539277836651-l7se69fsu9d6l75r55kpbj2lmr7enhoh.apps.googleusercontent.com",
  SITE_TITLE: "AI 創作畫廊",
  SITE_SUBTITLE: "ㄚ倫老師魔法實驗室",
  // 投稿頁「使用的 AI 工具」下拉選單的固定清單（與班級/姓名無關，班級與暱稱一律來自登入帳號）
  AI_TOOLS: ["Midjourney", "DALL·E", "ChatGPT", "Stable Diffusion", "Adobe Firefly", "其他"],
  // 上傳圖片檔案大小上限（MB），與後端 uploadBase64ToDrive_ 的限制對應
  MAX_UPLOAD_MB: 8,
  // 每個帳號的作品數量上限。達到上限就不能再新增（AI 作圖 / 投稿 / 上傳故事本都會擋）。
  // ★ 要調整上限就改這裡；後端 Code.gs 的同名設定也要改成一樣的數字。
  MAX_ARTWORKS_PER_USER: 100, // 圖片
  MAX_BOOKS_PER_USER: 10,     // 故事本
  // 還沒到上限、但已經很接近時就先提醒使用者的門檻
  WARN_ARTWORKS_AT: 94,
  WARN_BOOKS_AT: 8,
  // 產生結果視窗裡「微調後再產生一次」最多可以按幾次。
  // 每按一次都會真的呼叫一次 AI，所以也會扣掉每日總額度（30 次）裡的 1 次。
  // 從主表單重新產生一張新圖時，這個次數會重新計算。
  MAX_TWEAKS_PER_IMAGE: 5,
};
