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
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycby1jh-fre5VhPIg22l8x9DPoeGfCvTgtFasdUtAJT4Ivtb0RHo5s2UWqJnMsQrFl2FC/exec", // 例如 https://script.google.com/macros/s/xxxxxxxx/exec
  // 在 Google Cloud Console →「憑證」建立的 OAuth 用戶端 ID（應用程式類型：網頁應用程式）
  GOOGLE_CLIENT_ID: "539277836651-l7se69fsu9d6l75r55kpbj2lmr7enhoh.apps.googleusercontent.com",
  SITE_TITLE: "AI 創作畫廊",
  SITE_SUBTITLE: "ㄚ倫老師魔法實驗室",
  // 投稿頁「使用的 AI 工具」下拉選單的固定清單（與班級/姓名無關，班級與暱稱一律來自登入帳號）
  AI_TOOLS: ["Midjourney", "DALL·E", "ChatGPT", "Stable Diffusion", "Adobe Firefly", "其他"],
  // 上傳圖片檔案大小上限（MB），與後端 uploadBase64ToDrive_ 的限制對應
  MAX_UPLOAD_MB: 8,
};
