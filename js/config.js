/**
 * ===============================================================
 * 網站設定
 * ===============================================================
 * 請把下方 APPS_SCRIPT_URL 換成你部署 Google Apps Script 後拿到的
 * Web App 網址（結尾通常是 /exec）。
 *
 * 部署步驟請參考 README.md 與 apps-script/Code.gs 檔案開頭的說明。
 * ===============================================================
 */
const CONFIG = {
  APPS_SCRIPT_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE", // 例如 https://script.google.com/macros/s/xxxxxxxx/exec
  SITE_TITLE: "AI 創作畫廊",
  SITE_SUBTITLE: "Where prompts become pictures.",
  CLASSES: ["七年一班", "七年二班", "八年一班", "八年二班"], // 可自行修改班級清單（用於投稿頁下拉選單）
  AI_TOOLS: ["Midjourney", "DALL·E", "Stable Diffusion", "Adobe Firefly", "其他"],
};
