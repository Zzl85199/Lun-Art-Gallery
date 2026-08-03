/**
 * ===============================================================
 * API 封裝 — 與 Google Apps Script Web App 溝通
 * ===============================================================
 * 為了避開 Apps Script 對 CORS preflight 的限制，POST 請求統一用
 * "text/plain;charset=utf-8" 當 Content-Type，並在 body 放 JSON 字串，
 * 對應的 Code.gs 會用 JSON.parse(e.postData.contents) 解析。
 *
 * 敏感操作（投稿、故事接龍、AI 作圖、故事本…）一律會自動帶上目前登入的
 * sessionToken；未登入時該欄位就是空字串，後端看到空字串一律視為未登入。
 */

const SESSION_STORAGE_KEY = "gallery_session_token_v1";

const Api = {
  isConfigured() {
    return CONFIG.APPS_SCRIPT_URL && !CONFIG.APPS_SCRIPT_URL.includes("PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE");
  },

  getSessionToken() {
    try { return localStorage.getItem(SESSION_STORAGE_KEY) || ""; } catch (e) { return ""; }
  },

  setSessionToken(token) {
    try {
      if (token) localStorage.setItem(SESSION_STORAGE_KEY, token);
      else localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) { /* localStorage 不可用時就略過（例如無痕模式部分限制），登入狀態當次瀏覽有效即可 */ }
  },

  _privateImageCache: new Map(), // artworkId -> Promise<dataUrl>，避免同一張私人圖片重複請求

  /** 依作品資料算出「目前這個瀏覽器能立即用的」圖片網址：公開圖直接是 ImageURL；
   *  私人圖片沒有立即可用的網址（一定要先非同步跟後端要 base64 內容），這裡回傳空字串，
   *  真正的私人圖片請改用 setImageSrc(imgEl, art) 這個非同步版本。 */
  resolveImageSrc(art) {
    if (art.ImageURL) return art.ImageURL;
    return "";
  },

  /** 私人圖片：透過一般的 POST（帶 sessionToken）換回 base64 圖片內容，組成 data: URI。
   *  Apps Script 的 doGet/doPost 只能回傳 HtmlOutput/TextOutput，無法直接回傳圖片位元組，
   *  所以私人圖片沒辦法像公開圖片一樣單純給一個網址讓 <img> 讀取，一定要走這個非同步流程。 */
  async fetchPrivateImageDataUrl(artworkId) {
    if (this._privateImageCache.has(artworkId)) return this._privateImageCache.get(artworkId);
    const promise = this._post({ action: "image/get", artworkId })
      .then((res) => `data:${res.mimeType};base64,${res.base64}`)
      .catch((err) => { this._privateImageCache.delete(artworkId); throw err; });
    this._privateImageCache.set(artworkId, promise);
    return promise;
  },

  /** 幫一個 <img> 元素設定正確的圖片來源：公開圖片直接設定，私人圖片先非同步抓取內容再設定。
   *  loading/失敗都會反映在該 <img> 上（class 切換 + alt 文字），呼叫端不需要自己處理狀態。 */
  async setImageSrc(imgEl, art) {
    if (art.ImageURL) { imgEl.src = art.ImageURL; return; }
    if (art.needsProxy && art.ID) {
      imgEl.classList.add("img-loading");
      try {
        imgEl.src = await this.fetchPrivateImageDataUrl(art.ID);
      } catch (err) {
        imgEl.alt = "圖片載入失敗";
      } finally {
        imgEl.classList.remove("img-loading");
      }
    }
  },

  async _get(params) {
    if (!this.isConfigured()) throw new Error("尚未設定 Apps Script 網址，請於 js/config.js 中填入 APPS_SCRIPT_URL");
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

  async _post(payload, opts) {
    if (!this.isConfigured()) throw new Error("尚未設定 Apps Script 網址，請於 js/config.js 中填入 APPS_SCRIPT_URL");
    const body = Object.assign({}, payload);
    if (!opts || opts.auth !== false) body.sessionToken = this.getSessionToken();
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("網路連線失敗 (HTTP " + res.status + ")");
    const json = await res.json();
    if (json && json.error) throw new Error(json.error);
    return json;
  },

  /* ---------------- 公開（不需登入）---------------- */
  getArtworks() { return this._get({ action: "list" }); },
  getComments(artworkId) { return this._get({ action: "comments", artworkId }); },
  likeArtwork(artworkId) { return this._post({ action: "like", artworkId }, { auth: false }); },
  postComment(artworkId, commenterName, comment) {
    return this._post({ action: "comment", artworkId, commenterName, comment }, { auth: false });
  },

  /* ---------------- 登入 / 帳號 ---------------- */
  authLogin(idToken) { return this._post({ action: "auth/login", idToken }, { auth: false }); },
  authRegister(idToken, studentName, className, nickname) {
    return this._post({ action: "auth/register", idToken, studentName, className, nickname }, { auth: false });
  },
  authMe() { return this._post({ action: "auth/me" }); },
  authUpdateNickname(nickname) { return this._post({ action: "auth/updateNickname", nickname }); },
  authUpdateCharacterSheet(characterSheet) { return this._post({ action: "auth/updateCharacterSheet", characterSheet }); },
  logout() { return this._post({ action: "auth/logout" }); },

  /* ---------------- 投稿 / 我的作品 / 隱私 ---------------- */
  submitArtworkUpload(data) {
    return this._post(Object.assign({ action: "submit", imageMode: "upload" }, data));
  },
  submitArtworkUrl(data) {
    return this._post(Object.assign({ action: "submit", imageMode: "url" }, data));
  },
  listMine() { return this._post({ action: "listMine" }); },
  materialLibrary() { return this._post({ action: "materialLibrary" }); },
  updateVisibility(artworkId, visibility, allowStory) {
    return this._post({ action: "updateVisibility", artworkId, visibility, allowStory });
  },

  /* ---------------- 故事接龍 ---------------- */
  storyGetRound() { return this._post({ action: "story/getRound" }); },
  storyVote(artworkId) { return this._post({ action: "story/vote", artworkId: artworkId || "" }); },
  storyGetHonorBoard() { return this._post({ action: "story/getHonorBoard" }); },

  /* ---------------- 我的故事本 ---------------- */
  booksList() { return this._post({ action: "books/list" }); },
  booksGet(bookId) { return this._post({ action: "books/get", bookId }); },
  booksSave(bookId, title, frames) { return this._post({ action: "books/save", bookId: bookId || "", title, frames }); },
  booksDelete(bookId) { return this._post({ action: "books/delete", bookId }); },

  /* ---------------- AI 作圖 ---------------- */
  aiQuota() { return this._post({ action: "ai/quota" }); },
  aiGenerate(prompt, options) {
    const opts = options || {};
    return this._post({
      action: "ai/generate",
      prompt,
      referenceArtworkId: opts.referenceArtworkId || "",
      referenceImageBase64: opts.referenceImageBase64 || "",
      referenceImageMimeType: opts.referenceImageMimeType || "",
    });
  },
};
