document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("submit");
  renderFooterYear();

  const gateEl = document.getElementById("submit-gate");
  Auth.requireActive(gateEl, (user) => initSubmitPage(gateEl, user));
});

const VISIBILITY_OPTIONS = [
  { value: "public", label: "🌍 公開", hint: "顯示在畫廊，也可以被其他人放進故事本素材庫" },
  { value: "gallery_only", label: "🖼️ 僅畫廊", hint: "顯示在畫廊，但不能被別人放進故事本" },
  { value: "private", label: "🔒 私人", hint: "只有你自己登入後看得到，可以放進自己的故事本" },
];

/** 故事本上傳的公開範圍（故事本是 PDF，不會出現在圖片畫廊裡） */
const BOOK_VISIBILITY_OPTIONS = [
  { value: "public", label: "🌍 公開", hint: "老師與同學都可以下載這本故事本" },
  { value: "gallery_only", label: "🖼️ 僅畫廊", hint: "同上，登入後的同學可以看到" },
  { value: "private", label: "🔒 私人", hint: "只有你自己登入後看得到" },
];

/** 把使用者選的圖片壓縮到合理大小再轉成 base64（共用版本在 js/main.js 的 compressImageFile） */

function initSubmitPage(root, user) {
  root.innerHTML = `
    <div class="page-hero-row">
      <span class="page-hero-emoji" aria-hidden="true">✏️</span>
      <h1 class="hero-title" style="font-size:clamp(2rem,5vw,3rem);text-align:center;">我的頁面</h1>
      <span class="page-hero-emoji" aria-hidden="true">🌟</span>
    </div>

    <div class="steps-note">
      <p>目前身份：<b>${escapeHtml(user.className)}・${escapeHtml(user.nickname)}</b></p>
      <p id="quota-counts" style="margin-top:6px;"></p>
    </div>

    <div class="seg-tabs-wrap" style="margin-top:18px;">
      <div class="seg-tabs" id="upload-kind-tabs">
        <button type="button" class="seg-tab upload-kind-btn active" data-kind="image">🖼️ 投稿圖片</button>
        <button type="button" class="seg-tab upload-kind-btn" data-kind="book">📖 上傳故事本</button>
      </div>
    </div>

    <form class="submit-form" id="submit-form">
      <div class="form-row">
        <label>圖片來源 *</label>
        <div class="btn-row" id="image-mode-tabs">
          <button type="button" class="btn btn-outline-dark image-mode-btn active" data-mode="url">🔗 網址匯入（推薦，免上傳流量）</button>
          <button type="button" class="btn btn-outline-dark image-mode-btn" data-mode="upload">📤 直接上傳圖片</button>
        </div>
      </div>

      <div class="form-row" id="upload-mode-row" style="display:none;">
        <label for="field-file">選擇圖片檔案 *</label>
        <input type="file" id="field-file" accept="image/*">
        <div class="form-hint">圖片會直接上傳到老師的 Google Drive，依照你選的「公開範圍」決定分享權限。</div>
        <img id="upload-preview" class="image-preview" alt="圖片預覽" style="display:none;">
      </div>

      <div class="form-row" id="url-mode-row">
        <label for="field-image-url">圖片網址 *</label>
        <div class="form-hint">還沒有圖片網址嗎？先到免費圖床上傳圖片，複製「直接連結」後貼在下面：</div>
        <div class="btn-row" style="margin:6px 0 10px;">
          <button type="button" class="btn btn-outline-dark" id="open-meee-btn">🖼️ meee 圖床</button>
          <button type="button" class="btn btn-outline-dark" id="open-imgur-btn">🖼️ Imgur</button>
          <button type="button" class="btn btn-outline-dark" id="open-imgtok-btn">🖼️ imgtok</button>
          <button type="button" class="btn btn-outline-dark" id="open-imgbb-btn">🖼️ imgbb</button>
        </div>
        <input type="url" id="field-image-url" placeholder="https://i.meee.com.tw/xxxxxxx.jpg">
        <div class="form-hint">網址匯入的圖片會自動備份一份到 Google Drive，但因原始網址本身即公開，無法設為「私人」。適用於上面任何圖床，只要是「直接連結」（結尾通常是 .jpg/.png/.gif）都可以。</div>
        <div class="image-check" id="url-image-check"></div>
        <img id="url-preview" class="image-preview" alt="圖片預覽" style="display:none;">
      </div>

      <div class="form-row">
        <label for="field-tool">使用的 AI 工具 *</label>
        <select id="field-tool" required></select>
        <input type="text" id="field-tool-other" placeholder="請輸入你使用的 AI 工具名稱" style="display:none;margin-top:8px;">
      </div>

      <div class="form-row">
        <label for="field-prompt">AI Prompt（選填）</label>
        <textarea id="field-prompt" placeholder="貼上你輸入給 AI 的完整 Prompt..."></textarea>
      </div>

      <div class="form-row">
        <label for="field-desc">創作說明</label>
        <textarea id="field-desc" placeholder="說說你想表達什麼、修改了幾次、遇到什麼困難..."></textarea>
      </div>

      <div class="form-row">
        <label for="field-tags">標籤（用逗號分隔）</label>
        <input type="text" id="field-tags" placeholder="例如：奇幻, 風景, 貓咪">
        <div class="tag-chip-row" id="common-tag-chips"></div>
      </div>

      <div class="form-row">
        <label>公開範圍 *</label>
        <div class="visibility-options" id="visibility-options"></div>
      </div>

      <button type="submit" class="btn btn-pin" style="width:100%;">送出投稿</button>
      <div class="form-msg" id="submit-msg"></div>
    </form>

    <form class="submit-form" id="book-form" style="display:none;">
      <div class="form-row">
        <label for="book-title">故事本名稱 *</label>
        <input type="text" id="book-title" maxlength="60" placeholder="例如：橘貓的一天">
      </div>

      <div class="form-row">
        <label for="book-file">故事本 PDF *</label>
        <input type="file" id="book-file" accept="application/pdf">
        <div class="form-hint">
          先到「故事接龍」頁把故事本做好 → 按「產生閱讀/列印頁」→ 在列印視窗選擇「另存為 PDF」，
          再回到這裡把 PDF 上傳。檔案請控制在 9MB 以內。
        </div>
        <div class="image-check" id="book-file-check"></div>
      </div>

      <div class="form-row">
        <label for="book-desc">創作說明</label>
        <textarea id="book-desc" placeholder="說說這本故事本在講什麼、你們是怎麼接下去的..."></textarea>
      </div>

      <div class="form-row">
        <label for="book-tags">標籤（用逗號分隔）</label>
        <input type="text" id="book-tags" placeholder="例如：冒險, 貓咪, 友情">
      </div>

      <div class="form-row">
        <label>公開範圍 *</label>
        <select id="book-visibility">
          ${BOOK_VISIBILITY_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
        </select>
        <div class="form-hint" id="book-visibility-hint"></div>
      </div>

      <button type="submit" class="btn btn-pin" style="width:100%;">上傳故事本</button>
      <div class="form-msg" id="book-msg"></div>
    </form>

    <h2 class="board-heading" style="font-size:1.4rem;margin-top:40px;">📂 我的作品</h2>
    <div class="seg-tabs-wrap">
      <div class="seg-tabs" id="mine-kind-tabs">
        <button type="button" class="seg-tab mine-kind-btn active" data-kind="image">🖼️ 圖片</button>
        <button type="button" class="seg-tab mine-kind-btn" data-kind="book">📖 故事本</button>
      </div>
    </div>
    <div id="mine-filter-mount"></div>
    <div id="my-submissions"></div>
  `;

  /* ---------------- 圖片來源分頁 ---------------- */
  document.getElementById("open-meee-btn").addEventListener("click", () => {
    window.open("https://meee.com.tw/", "_blank");
  });
  document.getElementById("open-imgur-btn").addEventListener("click", () => {
    window.open("https://imgur.com/upload", "_blank");
  });
  document.getElementById("open-imgtok-btn").addEventListener("click", () => {
    window.open("https://imgtok.com/zh-hans", "_blank");
  });
  document.getElementById("open-imgbb-btn").addEventListener("click", () => {
    window.open("https://zh-hk.imgbb.com/", "_blank");
  });

  let imageMode = "url";
  const uploadRow = document.getElementById("upload-mode-row");
  const urlRow = document.getElementById("url-mode-row");
  document.querySelectorAll(".image-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      imageMode = btn.dataset.mode;
      document.querySelectorAll(".image-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
      uploadRow.style.display = imageMode === "upload" ? "block" : "none";
      urlRow.style.display = imageMode === "url" ? "block" : "none";
      renderVisibilityOptions(); // 網址匯入模式要停用「私人」選項
    });
  });

  /* ---------------- 常用標籤快選 ---------------- */
  const COMMON_TAGS = ["奇幻", "風景", "人像", "動物", "科幻", "可愛", "水彩風", "像素風", "3D", "黑白", "復古", "日本", "街景", "動漫風"];
  const tagsInput = document.getElementById("field-tags");
  document.getElementById("common-tag-chips").innerHTML = COMMON_TAGS.map((t) => `<button type="button" class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join("");
  document.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const tag = chip.dataset.tag;
      const current = tagsInput.value.split(/[,、]/).map((t) => t.trim()).filter(Boolean);
      if (current.includes(tag)) {
        chip.classList.remove("active");
        tagsInput.value = current.filter((t) => t !== tag).join(", ");
      } else {
        chip.classList.add("active");
        tagsInput.value = current.concat(tag).join(", ");
      }
    });
  });

  /* ---------------- AI 工具 ---------------- */
  const toolSelect = document.getElementById("field-tool");
  const toolOtherInput = document.getElementById("field-tool-other");
  toolSelect.innerHTML = CONFIG.AI_TOOLS.map((t) => `<option>${escapeHtml(t)}</option>`).join("");
  toolSelect.addEventListener("change", () => {
    const isOther = toolSelect.value === "其他";
    toolOtherInput.style.display = isOther ? "block" : "none";
    toolOtherInput.required = isOther;
    if (!isOther) toolOtherInput.value = "";
  });

  /* ---------------- 上傳圖片預覽 + 壓縮 ---------------- */
  const fileInput = document.getElementById("field-file");
  const uploadPreview = document.getElementById("upload-preview");
  let compressed = null; // { base64, mimeType }
  fileInput.addEventListener("change", async () => {
    compressed = null;
    uploadPreview.style.display = "none";
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("請選擇圖片檔案"); fileInput.value = ""; return; }
    try {
      compressed = await compressImageFile(file, 1600, 0.85);
      uploadPreview.src = "data:" + compressed.mimeType + ";base64," + compressed.base64;
      uploadPreview.style.display = "block";
    } catch (err) {
      alert("圖片處理失敗：" + err.message);
      fileInput.value = "";
    }
  });

  /* ---------------- 網址匯入驗證（沿用舊版邏輯） ---------------- */
  const urlInput = document.getElementById("field-image-url");
  const urlCheckEl = document.getElementById("url-image-check");
  const urlPreview = document.getElementById("url-preview");
  let urlValidationOk = false;
  let urlCheckToken = 0;

  urlInput.addEventListener("input", () => {
    clearTimeout(urlInput._debounce);
    urlInput._debounce = setTimeout(checkImageUrl, 500);
  });
  urlInput.addEventListener("blur", checkImageUrl);

  function checkImageUrl() {
    const url = urlInput.value.trim();
    const myToken = ++urlCheckToken;
    urlValidationOk = false;
    urlPreview.style.display = "none";
    if (!url) { urlCheckEl.className = "image-check"; urlCheckEl.textContent = ""; return; }
    urlCheckEl.className = "image-check show pending";
    urlCheckEl.textContent = "🔍 正在確認圖片是否能正常開啟...";
    const testImg = new Image();
    testImg.onload = () => {
      if (myToken !== urlCheckToken) return;
      urlValidationOk = true;
      urlCheckEl.className = "image-check show success";
      urlCheckEl.textContent = "✅ 圖片可以正常載入！";
      urlPreview.src = url;
      urlPreview.style.display = "block";
    };
    testImg.onerror = () => {
      if (myToken !== urlCheckToken) return;
      urlCheckEl.className = "image-check show error";
      urlCheckEl.textContent = "❌ 這個網址無法載入圖片，請確認連結是否正確、圖片是否還存在。";
    };
    testImg.src = url;
  }

  /* ---------------- 公開範圍 ---------------- */
  const visibilityOptionsEl = document.getElementById("visibility-options");
  let visibility = "public";

  function renderVisibilityOptions() {
    visibilityOptionsEl.innerHTML = `
      <select id="field-visibility">
        ${VISIBILITY_OPTIONS.map((opt) => {
          const disabled = opt.value === "private" && imageMode === "url";
          if (disabled && visibility === "private") visibility = "public";
          return `<option value="${opt.value}" ${visibility === opt.value ? "selected" : ""} ${disabled ? "disabled" : ""}>${opt.label}</option>`;
        }).join("")}
      </select>
      <div class="form-hint" id="visibility-hint"></div>
    `;
    const select = document.getElementById("field-visibility");
    const hintEl = document.getElementById("visibility-hint");
    function updateHint() {
      const opt = VISIBILITY_OPTIONS.find((o) => o.value === select.value);
      hintEl.textContent = opt ? opt.hint : "";
    }
    select.addEventListener("change", () => {
      visibility = select.value;
      updateHint();
    });
    updateHint();
  }
  renderVisibilityOptions();

  /* ---------------- 送出投稿 ---------------- */
  const form = document.getElementById("submit-form");
  const msgEl = document.getElementById("submit-msg");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!ensureUnderLimit("image")) return;

    if (imageMode === "upload" && !compressed) { showMsg("error", "請選擇要上傳的圖片。"); return; }
    if (imageMode === "url" && (!urlInput.value.trim() || !urlValidationOk)) {
      showMsg("error", "請貼上能正常開啟的圖片網址。");
      return;
    }
    const isOtherTool = toolSelect.value === "其他";
    const customTool = toolOtherInput.value.trim();
    if (isOtherTool && !customTool) { showMsg("error", "選了「其他」，請輸入你使用的 AI 工具名稱。"); return; }

    const common = {
      aiTool: isOtherTool ? customTool : toolSelect.value,
      prompt: document.getElementById("field-prompt").value.trim(),
      description: document.getElementById("field-desc").value.trim(),
      tags: document.getElementById("field-tags").value.trim(),
      visibility,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "上傳中，請稍候...";
    showMsg("pending", "作品傳送中，請稍候...");

    try {
      const res = imageMode === "upload"
        ? await Api.submitArtworkUpload(Object.assign({ imageBase64: compressed.base64, mimeType: compressed.mimeType }, common))
        : await Api.submitArtworkUrl(Object.assign({ imageUrl: urlInput.value.trim() }, common));

      if (res.needsManualPublish) {
        showMsg("pending", "✅ 投稿成功，目前狀態：審核中。");
        alert("投稿成功，但系統暫時無法自動把圖片設定為公開／僅畫廊可看，已先標記為「審核中」。\n\n請告訴老師，請老師到後端 Google Sheet 的 Artworks 分頁，手動把這件作品的 Approved 欄位改成 TRUE，協助讓它正常上架。");
      } else if (visibility === "private") {
        showMsg("success", "🎉 投稿成功，已存為私人作品，只有你自己看得到。");
      } else if (res.approved) {
        showMsg("success", "🎉 投稿成功，已直接上架囉！");
      } else {
        showMsg("pending", "✅ 投稿成功，待老師審核後會出現在畫廊中，請耐心等候～");
      }

      form.reset();
      compressed = null;
      uploadPreview.style.display = "none";
      urlPreview.style.display = "none";
      urlCheckEl.className = "image-check";
      urlCheckEl.textContent = "";
      urlValidationOk = false;
      toolOtherInput.style.display = "none";
      visibility = "public";
      renderVisibilityOptions();
      loadMine();
    } catch (err) {
      showMsg("error", "投稿失敗：" + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出投稿";
    }
  });

  function showMsg(type, text) {
    msgEl.className = `form-msg show ${type}`;
    msgEl.textContent = text;
    msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------------- 上傳模式切換：投稿圖片 / 上傳故事本 ---------------- */
  const bookForm = document.getElementById("book-form");
  const uploadKindTabs = document.getElementById("upload-kind-tabs");
  uploadKindTabs.querySelectorAll(".upload-kind-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.kind;
      uploadKindTabs.querySelectorAll(".upload-kind-btn").forEach((b) => b.classList.toggle("active", b === btn));
      form.style.display = kind === "image" ? "" : "none";
      bookForm.style.display = kind === "book" ? "" : "none";
    });
  });

  /* ---------------- 數量上限 ---------------- */
  let counts = { images: 0, books: 0 };
  const countsEl = document.getElementById("quota-counts");

  function renderCounts() {
    const imgWarn = counts.images >= CONFIG.WARN_ARTWORKS_AT;
    const bookWarn = counts.books >= CONFIG.WARN_BOOKS_AT;
    const warnStyle = "color:#a8402f;font-weight:600;";
    countsEl.innerHTML =
      `圖片作品：<b style="${imgWarn ? warnStyle : ""}">${counts.images} / ${CONFIG.MAX_ARTWORKS_PER_USER}</b> 張　·　` +
      `故事本：<b style="${bookWarn ? warnStyle : ""}">${counts.books} / ${CONFIG.MAX_BOOKS_PER_USER}</b> 本` +
      (imgWarn || bookWarn
        ? `<br><span style="${warnStyle}">⚠️ 數量快要到上限了，建議先刪掉一些不需要的作品，才不會之後想存新的卻存不下。</span>`
        : "");
  }

  /** 送出前先擋一次；回傳 true 代表還可以新增 */
  function ensureUnderLimit(kind) {
    if (kind === "book" && counts.books >= CONFIG.MAX_BOOKS_PER_USER) {
      alert(`故事本已經達到上限 ${CONFIG.MAX_BOOKS_PER_USER} 本了，請先刪除一些故事本再上傳吧！`);
      return false;
    }
    if (kind === "image" && counts.images >= CONFIG.MAX_ARTWORKS_PER_USER) {
      alert(`圖片作品已經達到上限 ${CONFIG.MAX_ARTWORKS_PER_USER} 張了，請先刪除一些作品再繼續吧！`);
      return false;
    }
    return true;
  }

  /* ---------------- 上傳故事本 PDF ---------------- */
  const bookFileInput = document.getElementById("book-file");
  const bookFileCheck = document.getElementById("book-file-check");
  const bookMsgEl = document.getElementById("book-msg");
  const bookVisSelect = document.getElementById("book-visibility");
  const bookVisHint = document.getElementById("book-visibility-hint");
  const bookSubmitBtn = bookForm.querySelector('button[type="submit"]');
  let bookFileData = null; // { base64, mimeType }

  function updateBookVisHint() {
    const opt = BOOK_VISIBILITY_OPTIONS.find((o) => o.value === bookVisSelect.value);
    bookVisHint.textContent = opt ? opt.hint : "";
  }
  bookVisSelect.addEventListener("change", updateBookVisHint);
  updateBookVisHint();

  function showBookMsg(type, text) {
    bookMsgEl.className = `form-msg show ${type}`;
    bookMsgEl.textContent = text;
  }

  bookFileInput.addEventListener("change", async () => {
    bookFileData = null;
    bookFileCheck.className = "image-check";
    bookFileCheck.textContent = "";
    const file = bookFileInput.files[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      bookFileCheck.className = "image-check show error";
      bookFileCheck.textContent = "❌ 故事本只接受 PDF 檔案。";
      bookFileInput.value = "";
      return;
    }
    const MAX_BYTES = 9 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      bookFileCheck.className = "image-check show error";
      bookFileCheck.textContent = `❌ 檔案 ${(file.size / 1024 / 1024).toFixed(1)}MB，超過 9MB 上限。請減少頁數或降低圖片解析度後再匯出一次。`;
      bookFileInput.value = "";
      return;
    }

    try {
      bookFileData = await readFileAsBase64(file);
      bookFileCheck.className = "image-check show success";
      bookFileCheck.textContent = `✅ 已選擇：${file.name}（${(file.size / 1024 / 1024).toFixed(1)}MB）`;
    } catch (err) {
      bookFileCheck.className = "image-check show error";
      bookFileCheck.textContent = "❌ 檔案讀取失敗：" + err.message;
      bookFileInput.value = "";
    }
  });

  bookForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // 先擋數量上限，免得學生挑好檔案、填完說明才被退回
    if (!ensureUnderLimit("book")) return;

    const title = document.getElementById("book-title").value.trim();
    if (!title) { showBookMsg("error", "請幫這本故事本取個名字。"); return; }
    if (!bookFileData) { showBookMsg("error", "請選擇要上傳的 PDF 檔案。"); return; }

    bookSubmitBtn.disabled = true;
    bookSubmitBtn.textContent = "上傳中，請稍候...";
    showBookMsg("pending", "故事本上傳中，PDF 檔案比較大，可能要等一下...");

    try {
      const res = await Api.submitBook({
        title,
        description: document.getElementById("book-desc").value.trim(),
        tags: document.getElementById("book-tags").value.trim(),
        visibility: bookVisSelect.value,
        fileBase64: bookFileData.base64,
        mimeType: bookFileData.mimeType,
      });

      if (res.needsManualPublish) {
        showBookMsg("pending", "✅ 上傳成功，目前狀態：審核中。");
      } else {
        showBookMsg("success", "🎉 故事本上傳成功！");
      }

      bookForm.reset();
      bookFileData = null;
      bookFileCheck.className = "image-check";
      bookFileCheck.textContent = "";
      updateBookVisHint();
      loadMine();
    } catch (err) {
      showBookMsg("error", "上傳失敗：" + err.message);
    } finally {
      bookSubmitBtn.disabled = false;
      bookSubmitBtn.textContent = "上傳故事本";
    }
  });

  /* ---------------- 我的作品：圖片 / 故事本兩個分頁 ---------------- */
  const mySubmissionsEl = document.getElementById("my-submissions");
  const mineKindTabs = document.getElementById("mine-kind-tabs");
  const filterBar = mountSharedFilterBar(document.getElementById("mine-filter-mount"), "mine");
  let mineKind = "image";
  let allMine = [];

  mineKindTabs.querySelectorAll(".mine-kind-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      mineKind = btn.dataset.kind;
      mineKindTabs.querySelectorAll(".mine-kind-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderMine();
    });
  });

  async function loadMine() {
    renderStateMessage(mySubmissionsEl, { type: "loading", text: "載入我的作品中..." });
    try {
      const res = await Api.listMine();
      allMine = res.artworks || [];
      counts = {
        images: allMine.filter((a) => a.Kind !== "book").length,
        books: allMine.filter((a) => a.Kind === "book").length,
      };
      renderCounts();
      filterBar.refreshOptions(allMine);
      renderMine();
    } catch (err) {
      renderStateMessage(mySubmissionsEl, { type: "error", text: "載入失敗：" + err.message, onRetry: loadMine });
    }
  }

  function renderMine() {
    const list = allMine
      .filter((a) => (mineKind === "book" ? a.Kind === "book" : a.Kind !== "book"))
      .filter((a) => filterBar.matches(a));

    filterBar.countEl.textContent = `共 ${list.length} ${mineKind === "book" ? "本故事本" : "件圖片作品"}`;

    if (!list.length) {
      renderStateMessage(mySubmissionsEl, {
        type: "empty",
        text: mineKind === "book" ? "你還沒有上傳任何故事本。" : "你還沒有投稿過任何圖片作品。",
      });
      return;
    }

    mySubmissionsEl.innerHTML = `<div class="my-submissions-grid">${list.map(submissionCardHtml).join("")}</div>`;

    mySubmissionsEl.querySelectorAll(".submission-card").forEach((card) => {
      const id = card.dataset.artworkId;
      const art = list.find((a) => a.ID === id);
      if (!art) return;

      if (art.Kind !== "book") {
        setupArtworkImage(card.querySelector("img"), card.querySelector(".no-image-placeholder"), art);
      }

      const visSelect = card.querySelector(".submission-visibility");
      const saveBtn = card.querySelector(".submission-save-btn");
      const downloadBtn = card.querySelector(".submission-download-btn");
      const deleteBtn = card.querySelector(".submission-delete-btn");
      const msg = card.querySelector(".submission-msg");

      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        msg.textContent = "更新中...";
        try {
          const res = await Api.updateVisibility(id, visSelect.value);
          if (res.needsManualPublish) {
            msg.textContent = "⏳ 已儲存，狀態：審核中";
            alert("已儲存，但系統暫時無法自動把檔案設定為公開／僅畫廊可看，已先標記為「審核中」。\n\n請告訴老師，請老師到後端 Google Sheet 的 Artworks 分頁，手動把這件作品的 Approved 欄位改成 TRUE，協助讓它正常上架。");
          } else {
            msg.textContent = "✅ 已更新";
          }
          loadMine();
        } catch (err) {
          msg.textContent = "❌ " + err.message;
        } finally {
          saveBtn.disabled = false;
        }
      });

      downloadBtn.addEventListener("click", async () => {
        downloadBtn.disabled = true;
        const original = downloadBtn.textContent;
        downloadBtn.textContent = "準備中...";
        try {
          await downloadArtwork(art);
          msg.textContent = "✅ 已開始下載";
        } catch (err) {
          msg.textContent = "❌ 下載失敗：" + err.message;
        } finally {
          downloadBtn.disabled = false;
          downloadBtn.textContent = original;
        }
      });

      deleteBtn.addEventListener("click", async () => {
        const what = art.Kind === "book" ? `故事本「${art.Title || "未命名"}」` : "這件作品";
        if (!confirm(`確定要刪除${what}嗎？\n\n刪掉之後畫廊和故事本素材庫裡都會看不到它，這個動作無法在網站上復原。`)) return;

        deleteBtn.disabled = true;
        msg.textContent = "刪除中...";
        try {
          await Api.deleteArtwork(id);
          loadMine();
        } catch (err) {
          msg.textContent = "❌ 刪除失敗：" + err.message;
          deleteBtn.disabled = false;
        }
      });
    });
  }

  /** 下載一件作品：圖片存成 PNG，故事本存成 PDF */
  async function downloadArtwork(art) {
    const dataUrl = art.needsProxy || !art.ImageURL
      ? await Api.fetchPrivateImageDataUrl(art.ID)
      : art.ImageURL;

    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const timeTag = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;

    if (art.Kind === "book") {
      const safeTitle = (art.Title || "故事本").replace(/[\\/:*?"<>|]/g, "_");
      triggerFileDownload(dataUrl, `${safeTitle}_${timeTag}.pdf`);
      return;
    }
    await downloadDataUrlAsPng(dataUrl, `AI作品_${timeTag}.png`);
  }

  function submissionCardHtml(a) {
    const isBook = a.Kind === "book";
    const approvedLabel = a.Visibility === "private" ? "" : a.Approved ? "✅ 已上架" : "⏳ 審核中";
    const options = isBook ? BOOK_VISIBILITY_OPTIONS : VISIBILITY_OPTIONS;

    const thumb = isBook
      ? `<div class="note-thumb-wrap book-thumb">
           <span class="book-thumb-icon">📖</span>
           <span class="book-thumb-title">${escapeHtml(a.Title || "未命名故事本")}</span>
         </div>`
      : `<div class="note-thumb-wrap">
           <img loading="lazy" alt="我的作品">
           <div class="no-image-placeholder"><span class="no-image-icon">🖼️</span><span>尚無圖片</span></div>
         </div>`;

    return `
      <div class="submission-card note-card" data-artwork-id="${escapeHtml(a.ID)}">
        <button type="button" class="submission-delete-btn" title="刪除這件作品" aria-label="刪除這件作品">✕</button>
        ${thumb}
        <div class="note-meta-row">
          <span class="note-student">${escapeHtml(isBook ? "故事本" : a.AITool || "")}</span>
          <span class="note-class">${escapeHtml(approvedLabel)}</span>
        </div>
        <div class="form-row">
          <label>公開範圍</label>
          <select class="submission-visibility">
            ${options.map((opt) => `<option value="${opt.value}" ${a.Visibility === opt.value ? "selected" : ""} ${opt.value === "private" && !a.canGoPrivate ? "disabled" : ""}>${opt.label}</option>`).join("")}
          </select>
          ${!a.canGoPrivate ? `<div class="form-hint">此作品是透過網址匯入的，無法設為私人</div>` : ""}
        </div>
        <div class="btn-row" style="margin-top:4px;">
          <button type="button" class="btn btn-outline-dark submission-save-btn" style="flex:1;">儲存變更</button>
          <button type="button" class="btn btn-outline-dark submission-download-btn" style="flex:1;">⬇️ 下載</button>
        </div>
        <div class="form-msg-inline submission-msg"></div>
      </div>
    `;
  }

  loadMine();
}
