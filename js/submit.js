document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("submit");
  renderFooterYear();

  const gateEl = document.getElementById("submit-gate");
  Auth.requireActive(gateEl, (user) => initSubmitPage(gateEl, user));
});

const VISIBILITY_OPTIONS = [
  { value: "public", label: "🌍 公開", hint: "顯示在畫廊，也可進同班故事接龍票選、被其他人放進故事本素材庫" },
  { value: "gallery_only", label: "🖼️ 僅畫廊", hint: "顯示在畫廊，但不能被票選、也不能被別人放進故事本" },
  { value: "private", label: "🔒 私人", hint: "只有你自己登入後看得到，可以放進自己的故事本" },
];

/** 把使用者選的圖片壓縮到合理大小再轉成 base64，減少上傳流量與 Google Drive 空間占用 */
function compressImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("圖片讀取失敗"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("圖片格式無法辨識"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = file.type === "image/gif" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mimeType, quality);
        resolve({ base64: dataUrl.split(",")[1], mimeType });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function initSubmitPage(root, user) {
  root.innerHTML = `
    <div class="page-hero-row">
      <span class="page-hero-emoji" aria-hidden="true">✏️</span>
      <h1 class="hero-title" style="font-size:clamp(2rem,5vw,3rem);text-align:center;">我要投稿</h1>
      <span class="page-hero-emoji" aria-hidden="true">🌟</span>
    </div>

    <div class="steps-note">
      <p>目前身份：<b>${escapeHtml(user.className)}・${escapeHtml(user.nickname)}</b>（班級與真實姓名由老師管理，暱稱可在右上角 ✏️ 修改）</p>
    </div>

    <form class="submit-form" id="submit-form">
      <div class="form-row">
        <label>圖片來源 *</label>
        <div class="btn-row" id="image-mode-tabs">
          <button type="button" class="btn btn-outline-dark image-mode-btn active" data-mode="upload">📤 上傳圖片</button>
          <button type="button" class="btn btn-outline-dark image-mode-btn" data-mode="url">🔗 網址匯入（相容舊流程）</button>
        </div>
      </div>

      <div class="form-row" id="upload-mode-row">
        <label for="field-file">選擇圖片檔案 *</label>
        <input type="file" id="field-file" accept="image/*">
        <div class="form-hint">圖片會直接上傳到老師的 Google Drive，依照你選的「公開範圍」決定分享權限。</div>
        <img id="upload-preview" class="image-preview" alt="圖片預覽" style="display:none;">
      </div>

      <div class="form-row" id="url-mode-row" style="display:none;">
        <label for="field-image-url">圖片網址 *</label>
        <input type="url" id="field-image-url" placeholder="https://i.imgur.com/xxxxxxx.jpg">
        <div class="form-hint">網址匯入的圖片會自動備份一份到 Google Drive，但因原始網址本身即公開，無法設為「私人」。</div>
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
      </div>

      <div class="form-row">
        <label>公開範圍 *</label>
        <div class="visibility-options" id="visibility-options"></div>
      </div>

      <div class="form-row" id="allow-story-row">
        <label><input type="checkbox" id="field-allow-story" checked> 允許這件作品被抽進「本班作品票選」故事接龍</label>
      </div>

      <button type="submit" class="btn btn-pin" style="width:100%;">送出投稿</button>
      <div class="form-msg" id="submit-msg"></div>
    </form>

    <h2 class="board-heading" style="font-size:1.4rem;margin-top:40px;">📂 我的投稿</h2>
    <div id="my-submissions"></div>
  `;

  /* ---------------- 圖片來源分頁 ---------------- */
  let imageMode = "upload";
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
  const allowStoryRow = document.getElementById("allow-story-row");
  let visibility = "public";

  function renderVisibilityOptions() {
    visibilityOptionsEl.innerHTML = VISIBILITY_OPTIONS.map((opt) => {
      const disabled = opt.value === "private" && imageMode === "url";
      if (disabled && visibility === "private") visibility = "public";
      return `
        <label class="visibility-option ${disabled ? "disabled" : ""}">
          <input type="radio" name="visibility" value="${opt.value}" ${visibility === opt.value ? "checked" : ""} ${disabled ? "disabled" : ""}>
          <span>${opt.label}</span>
          <small>${opt.hint}</small>
        </label>
      `;
    }).join("");
    visibilityOptionsEl.querySelectorAll('input[name="visibility"]').forEach((input) => {
      input.addEventListener("change", () => {
        visibility = input.value;
        allowStoryRow.style.display = visibility === "public" ? "block" : "none";
      });
    });
    allowStoryRow.style.display = visibility === "public" ? "block" : "none";
  }
  renderVisibilityOptions();

  /* ---------------- 送出投稿 ---------------- */
  const form = document.getElementById("submit-form");
  const msgEl = document.getElementById("submit-msg");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

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
      allowStory: document.getElementById("field-allow-story").checked,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "上傳中，請稍候...";
    showMsg("pending", "作品傳送中，請稍候...");

    try {
      const res = imageMode === "upload"
        ? await Api.submitArtworkUpload(Object.assign({ imageBase64: compressed.base64, mimeType: compressed.mimeType }, common))
        : await Api.submitArtworkUrl(Object.assign({ imageUrl: urlInput.value.trim() }, common));

      if (visibility === "private") {
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
      loadMySubmissions();
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

  /* ---------------- 我的投稿列表 + 隱私管理 ---------------- */
  const mySubmissionsEl = document.getElementById("my-submissions");

  async function loadMySubmissions() {
    renderStateMessage(mySubmissionsEl, { type: "loading", text: "載入我的投稿中..." });
    try {
      const res = await Api.listMine();
      renderMySubmissions(res.artworks || []);
    } catch (err) {
      renderStateMessage(mySubmissionsEl, { type: "error", text: "載入失敗：" + err.message, onRetry: loadMySubmissions });
    }
  }

  function renderMySubmissions(artworks) {
    if (!artworks.length) {
      renderStateMessage(mySubmissionsEl, { type: "empty", text: "你還沒有投稿過任何作品。" });
      return;
    }
    mySubmissionsEl.innerHTML = `<div class="my-submissions-grid">${artworks.map((a) => submissionCardHtml(a)).join("")}</div>`;

    mySubmissionsEl.querySelectorAll(".submission-card").forEach((card) => {
      const id = card.dataset.artworkId;
      const img = card.querySelector("img");
      const placeholder = card.querySelector(".no-image-placeholder");
      const art = artworks.find((a) => a.ID === id);
      setupImageWithFallback(img, placeholder, Api.resolveImageSrc(art), art.DriveBackupURL);

      const visSelect = card.querySelector(".submission-visibility");
      const allowStoryInput = card.querySelector(".submission-allow-story");
      const saveBtn = card.querySelector(".submission-save-btn");
      const msg = card.querySelector(".submission-msg");

      visSelect.addEventListener("change", () => {
        allowStoryInput.closest(".submission-allow-story-row").style.display = visSelect.value === "public" ? "block" : "none";
      });

      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        msg.textContent = "更新中...";
        try {
          await Api.updateVisibility(id, visSelect.value, allowStoryInput.checked);
          msg.textContent = "✅ 已更新";
          loadMySubmissions();
        } catch (err) {
          msg.textContent = "❌ " + err.message;
        } finally {
          saveBtn.disabled = false;
        }
      });
    });
  }

  function submissionCardHtml(a) {
    const approvedLabel = a.Visibility === "private" ? "" : a.Approved ? "✅ 已上架" : "⏳ 審核中";
    return `
      <div class="submission-card note-card" data-artwork-id="${escapeHtml(a.ID)}">
        <div class="note-thumb-wrap">
          <img loading="lazy" alt="我的作品">
          <div class="no-image-placeholder"><span class="no-image-icon">🖼️</span><span>尚無圖片</span></div>
        </div>
        <div class="note-meta-row">
          <span class="note-student">${escapeHtml(a.AITool || "")}</span>
          <span class="note-class">${escapeHtml(approvedLabel)}</span>
        </div>
        <div class="form-row">
          <label>公開範圍</label>
          <select class="submission-visibility">
            ${VISIBILITY_OPTIONS.map((opt) => `<option value="${opt.value}" ${a.Visibility === opt.value ? "selected" : ""} ${opt.value === "private" && !a.canGoPrivate ? "disabled" : ""}>${opt.label}</option>`).join("")}
          </select>
          ${!a.canGoPrivate ? `<div class="form-hint">此作品是透過網址匯入的，無法設為私人</div>` : ""}
        </div>
        <div class="form-row submission-allow-story-row" style="display:${a.Visibility === "public" ? "block" : "none"};">
          <label><input type="checkbox" class="submission-allow-story" ${a.AllowStory ? "checked" : ""}> 允許進入故事接龍票選</label>
        </div>
        <button type="button" class="btn btn-outline-dark submission-save-btn" style="width:100%;">儲存變更</button>
        <div class="form-msg-inline submission-msg"></div>
      </div>
    `;
  }

  loadMySubmissions();
}
