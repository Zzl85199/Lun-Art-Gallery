/**
 * ===============================================================
 * 登入狀態管理（Google Identity Services）
 * ===============================================================
 * 每個頁面都會載入這支檔案，負責：
 *   - 在 header 顯示登入按鈕 / 目前暱稱 + 改暱稱 + 登出
 *   - 處理 Google 登入回呼、首次登入的申請表
 *   - 提供 Auth.requireActive(containerEl, onReady) 給需要登入的頁面呼叫，
 *     未登入 / 審核中 / 帳號停用時顯示對應提示，不會執行頁面邏輯
 */

const Auth = {
  currentUser: null, // { userId, nickname, className, status, role, quotaMode, quotaLimit } 或 null

  async init() {
    this._renderHeaderSlot();
    await this._restoreSession();
    this._renderHeaderState();
    this._loadGis();
    // 頁面上其他 script（例如 submit.js / story.js / ai.js）在 DOMContentLoaded 當下
    // 可能已經呼叫過 requireActive()，但那時候還不知道登入狀態是否已還原完成，
    // 所以這裡一定要補發一次事件，讓已經註冊的 requireActive 監聽者重新渲染。
    document.dispatchEvent(new CustomEvent("auth-changed"));
  },

  isActive() {
    return !!this.currentUser && String(this.currentUser.status).toLowerCase() === "active";
  },

  async _restoreSession() {
    if (!Api.getSessionToken()) return;
    try {
      const res = await Api.authMe();
      this.currentUser = res.loggedIn ? res.user : null;
      if (!res.loggedIn) Api.setSessionToken("");
    } catch (e) {
      this.currentUser = null;
    }
  },

  _renderHeaderSlot() {
    const nav = document.querySelector(".nav-tabs");
    if (!nav || document.getElementById("auth-slot")) return;
    const slot = document.createElement("div");
    slot.id = "auth-slot";
    slot.className = "auth-slot";
    nav.appendChild(slot);
  },

  _renderHeaderState() {
    // 未登入時，導覽列上的「我的頁面 / AI 作圖 / 故事接龍」（class="auth-only"）
    // 會被 CSS 隱藏；登入後才把 is-logged-in 掛到 <body> 讓它們顯示出來。
    document.body.classList.toggle("is-logged-in", !!this.currentUser);

    const slot = document.getElementById("auth-slot");
    if (!slot) return;

    if (this.currentUser) {
      const status = String(this.currentUser.status).toLowerCase();
      const statusLabel = status === "active" ? "" : status === "pending" ? "（審核中）" : "（已停用）";
      slot.innerHTML = `
        <span class="auth-nickname">👋 ${escapeHtml(this.currentUser.nickname)}${statusLabel}</span>
        <button class="btn btn-outline-dark auth-edit-nickname-btn" type="button" title="修改暱稱">✏️</button>
        <button class="btn btn-outline-dark auth-logout-btn" type="button">登出</button>
      `;
      slot.querySelector(".auth-logout-btn").addEventListener("click", async () => {
        await Api.logout();
        Api.setSessionToken("");
        location.reload();
      });
      slot.querySelector(".auth-edit-nickname-btn").addEventListener("click", () => this._showNicknameModal());
    } else {
      slot.innerHTML = `<div id="google-signin-btn" class="google-signin-btn"></div>`;
      this._renderGoogleButton();
    }
  },

  _showNicknameModal() {
    let overlay = document.getElementById("nickname-modal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "nickname-modal";
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal-box" style="max-width:380px;" role="dialog" aria-modal="true">
          <h2 class="modal-title" style="margin-bottom:4px;">✏️ 修改暱稱</h2>
          <p style="color:#6b5f4c;font-size:0.9rem;margin-bottom:16px;">暱稱是公開顯示的名字，同班同學不能重複。真實姓名與班級請找老師在名單上調整。</p>
          <form id="nickname-form">
            <div class="form-row">
              <label>新暱稱 *</label>
              <input type="text" id="nickname-input" required maxlength="40" placeholder="例如：小明的奇幻工作室">
            </div>
            <button type="submit" class="btn btn-pin" style="width:100%;">儲存</button>
            <div class="form-msg" id="nickname-msg"></div>
          </form>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });
    }
    overlay.classList.add("open");
    const input = overlay.querySelector("#nickname-input");
    input.value = this.currentUser.nickname;
    const msgEl = overlay.querySelector("#nickname-msg");
    msgEl.className = "form-msg";
    msgEl.textContent = "";

    overlay.querySelector("#nickname-form").onsubmit = async (e) => {
      e.preventDefault();
      msgEl.className = "form-msg show pending";
      msgEl.textContent = "儲存中...";
      try {
        const res = await Api.authUpdateNickname(input.value.trim());
        this.currentUser = res.user;
        overlay.classList.remove("open");
        this._renderHeaderState();
        document.dispatchEvent(new CustomEvent("auth-changed"));
      } catch (err) {
        msgEl.className = "form-msg show error";
        msgEl.textContent = "修改失敗：" + err.message;
      }
    };
  },

  _gisLoaded: false,
  _loadGis() {
    if (this._gisLoaded || window.google?.accounts?.id) {
      this._renderGoogleButton();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      this._gisLoaded = true;
      this._renderGoogleButton();
    };
    document.head.appendChild(script);
  },

  _renderGoogleButton() {
    if (this.currentUser) return;
    const container = document.getElementById("google-signin-btn");
    if (!container || !window.google?.accounts?.id) return;
    if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.includes("PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE")) {
      container.innerHTML = `<span style="color:#a8402f;font-size:0.85rem;">尚未設定 Google 登入</span>`;
      return;
    }
    window.google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: (resp) => this._handleCredential(resp.credential),
      auto_select: false,
    });
    window.google.accounts.id.renderButton(container, { theme: "outline", size: "medium", text: "signin_with" });
  },

  async _handleCredential(idToken) {
    try {
      const res = await Api.authLogin(idToken);
      if (res.needsRegistration) {
        this._showRegisterModal(idToken);
        return;
      }
      Api.setSessionToken(res.sessionToken);
      this.currentUser = res.user;
      this._renderHeaderState();
      document.dispatchEvent(new CustomEvent("auth-changed"));
    } catch (err) {
      alert("登入失敗：" + err.message);
    }
  },

  _showRegisterModal(idToken) {
    let overlay = document.getElementById("register-modal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "register-modal";
      overlay.className = "modal-overlay open";
      overlay.innerHTML = `
        <div class="modal-box" style="max-width:420px;" role="dialog" aria-modal="true">
          <h2 class="modal-title" style="margin-bottom:4px;">🎨 第一次使用，請先申請帳號</h2>
          <p style="color:#6b5f4c;font-size:0.9rem;margin-bottom:16px;">送出後請等待老師審核，審核通過就能使用所有功能囉！</p>
          <form id="register-form">
            <div class="form-row">
              <label>真實姓名 *</label>
              <input type="text" id="reg-student-name" required maxlength="20" placeholder="例如：王小明">
            </div>
            <div class="form-row">
              <label>班級 *</label>
              <input type="text" id="reg-class-name" required maxlength="20" placeholder="例如：七年一班">
            </div>
            <div class="form-row">
              <label>暱稱（公開顯示，同班不可重複）*</label>
              <input type="text" id="reg-nickname" required maxlength="20" placeholder="例如：小明的奇幻工作室">
            </div>
            <button type="submit" class="btn btn-pin" style="width:100%;">送出申請</button>
            <div class="form-msg" id="register-msg"></div>
          </form>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.classList.add("open");

    overlay.querySelector("#register-form").onsubmit = async (e) => {
      e.preventDefault();
      const msgEl = document.getElementById("register-msg");
      const studentName = document.getElementById("reg-student-name").value.trim();
      const className = document.getElementById("reg-class-name").value.trim();
      const nickname = document.getElementById("reg-nickname").value.trim();
      msgEl.className = "form-msg show pending";
      msgEl.textContent = "送出中...";
      try {
        const res = await Api.authRegister(idToken, studentName, className, nickname);
        Api.setSessionToken(res.sessionToken);
        this.currentUser = res.user;
        overlay.classList.remove("open");
        this._renderHeaderState();
        document.dispatchEvent(new CustomEvent("auth-changed"));
      } catch (err) {
        msgEl.className = "form-msg show error";
        msgEl.textContent = "申請失敗：" + err.message;
      }
    };
  },

  /**
   * 給需要登入才能使用的頁面呼叫。
   * containerEl：整個頁面主要內容的容器（會被替換成提示訊息，直到 Active 為止）
   * onReady：帳號為 Active 時要執行的頁面初始化邏輯
   */
  requireActive(containerEl, onReady) {
    let started = false;
    const render = () => {
      if (!this.currentUser) {
        started = false;
        containerEl.innerHTML = this._loginPromptHtml("這個功能需要先登入才能使用。請點選右上角的 Google 登入按鈕。");
        return;
      }
      const status = String(this.currentUser.status).toLowerCase();
      if (status === "pending") {
        started = false;
        containerEl.innerHTML = this._loginPromptHtml("你的帳號正在等待老師審核，審核通過後就能使用這個功能囉，請耐心等候～");
        return;
      }
      if (status !== "active") {
        started = false;
        containerEl.innerHTML = this._loginPromptHtml("你的帳號目前無法使用此功能，請聯絡老師確認狀態。");
        return;
      }
      if (started) return; // 已經初始化過頁面內容，避免 auth-changed 事件重複觸發造成重複渲染
      started = true;
      onReady(this.currentUser);
    };

    render();
    document.addEventListener("auth-changed", render);
  },

  _loginPromptHtml(message) {
    return `
      <div class="story-msg" style="max-width:600px;margin:40px auto;">
        <div style="font-size:2rem;margin-bottom:10px;">🔒</div>
        ${escapeHtml(message)}
      </div>
    `;
  },
};

document.addEventListener("DOMContentLoaded", () => Auth.init());
