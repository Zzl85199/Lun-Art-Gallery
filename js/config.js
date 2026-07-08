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
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxVGgIEeN1E7d-UIHfYkA_9PdLbPZLRpp_ocIkxaai6k8ToVgMe183yL7UfG5SJ9dQB/exec", // 例如 https://script.google.com/macros/s/xxxxxxxx/exec
  SITE_TITLE: "AI 創作畫廊",
  SITE_SUBTITLE: "ㄚ倫老師魔法實驗室",
  // 以下 CLASSES / AI_TOOLS 只在「班級與姓名名單」尚未從 Google Sheet 載入成功時，
  // 作為投稿頁下拉選單的備援清單使用。正常情況下，班級與姓名清單都會直接讀取
  // Google Sheet 的 AuthorizedUsers 分頁（新增/刪除班級或學生，直接在 Sheet 上編輯即可，
  // 不需要改這裡、也不需要重新部署網站）。
  CLASSES: ["七年一班", "七年二班", "八年一班", "八年二班"],
  AI_TOOLS: ["Midjourney", "DALL·E", "ChatGPT", "Stable Diffusion", "Adobe Firefly", "其他"],
};
