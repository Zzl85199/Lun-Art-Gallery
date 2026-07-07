/**
 * ===============================================================
 * API 封裝 — 與 Google Apps Script Web App 溝通
 * ===============================================================
 * 為了避開 Apps Script 對 CORS preflight 的限制，POST 請求統一用
 * "text/plain;charset=utf-8" 當 Content-Type，並在 body 放 JSON 字串，
 * 對應的 Code.gs 會用 JSON.parse(e.postData.contents) 解析。
 */

const Api = {
  isConfigured() {
    return (
      CONFIG.APPS_SCRIPT_URL &&
      !CONFIG.APPS_SCRIPT_URL.includes("PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE")
    );
  },

  async _get(params) {
    if (!this.isConfigured()) {
      throw new Error("尚未設定 Apps Script 網址，請於 js/config.js 中填入 APPS_SCRIPT_URL");
    }
    const url = new URL(CONFIG.APPS_SCRIPT_URL);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error("網路連線失敗 (HTTP " + res.status + ")");
    const json = await res.json();
    if (json && json.error) throw new Error(json.error);
    return json;
  },

  async _post(payload) {
    if (!this.isConfigured()) {
      throw new Error("尚未設定 Apps Script 網址，請於 js/config.js 中填入 APPS_SCRIPT_URL");
    }
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("網路連線失敗 (HTTP " + res.status + ")");
    const json = await res.json();
    if (json && json.error) throw new Error(json.error);
    return json;
  },

  /** 取得所有已上架（Approved=TRUE）的作品 */
  getArtworks() {
    return this._get({ action: "list" });
  },

  /** 取得單件作品的留言 */
  getComments(artworkId) {
    return this._get({ action: "comments", artworkId });
  },

  /** 投稿新作品 */
  submitArtwork(data) {
    return this._post({ action: "submit", ...data });
  },

  /** 按讚 */
  likeArtwork(artworkId) {
    return this._post({ action: "like", artworkId });
  },

  /** 留言 */
  postComment(artworkId, commenterName, comment) {
    return this._post({ action: "comment", artworkId, commenterName, comment });
  },
};
