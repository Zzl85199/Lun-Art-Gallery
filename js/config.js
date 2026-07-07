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
  SITE_SUBTITLE: "ㄚ倫老師 魔法小教室",
  CLASSES: ["A班", "B班", "C班", "D班"], // 可自行修改班級清單（用於投稿頁下拉選單）
  AI_TOOLS: ["Midjourney", "DALL·E", "Stable Diffusion", "Adobe Firefly", "其他"],
};
