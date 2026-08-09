/**
 * ===============================================================
 * 共用邏輯：Header 導覽列高光、Footer 年份、
 * 作品便條紙卡片渲染、Modal 詳細頁、按讚 / 留言
 * ===============================================================
 */

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setActiveNav(pageKey) {
  document.querySelectorAll(".nav-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.page === pageKey);
  });
}

function renderFooterYear() {
  const el = document.getElementById("footer-year");
  if (el) el.textContent = new Date().getFullYear();
}

/** 把使用者選的圖片壓縮到合理大小再轉成 base64（投稿頁上傳、AI 作圖參考圖上傳共用） */
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

function visibilityLabel(vis) {
  if (vis === "private") return "🔒 私人";
  if (vis === "gallery_only") return "🖼️ 僅畫廊";
  return "🌍 公開";
}

/**
 * 設定圖片來源與失敗時的備援流程：
 * 1. 沒有圖片連結 → 直接顯示可愛的「尚無圖片」預留圖示，不嘗試載入、不會出現破圖
 * 2. 圖片載入失敗 → 自動切換成 Google Drive 備援連結
 * 3. 備援連結也失敗（或沒有備援連結） → 顯示「尚無圖片」預留圖示，取代瀏覽器的破圖 icon
 */
function setupImageWithFallback(imgEl, placeholderEl, url, backupUrl) {
  let stage = 0;
  imgEl.onerror = null;

  if (!url) {
    imgEl.style.display = "none";
    placeholderEl.style.display = "flex";
    return;
  }

  imgEl.style.display = "block";
  placeholderEl.style.display = "none";
  imgEl.src = url;

  imgEl.onerror = () => {
    stage++;
    if (stage === 1 && backupUrl) {
      imgEl.src = backupUrl;
    } else {
      imgEl.style.display = "none";
      placeholderEl.style.display = "flex";
    }
  };
}

/**
 * 統一版的圖片設定：涵蓋三種情況，畫廊卡片與 Modal 都共用這個函式。
 * 1. 有直接的公開網址（art.ImageURL）→ 走原本同步流程 + Drive 備援網址
 * 2. 沒有直接網址但可以透過後端代理讀取（art.needsProxy）→ 非同步抓取內容（抓取中會有
 *    淡淡的載入動畫），失敗才顯示「尚無圖片」——這讓即使 Drive 分享設定失敗（無法產生
 *    直接網址），只要後端代理讀取得到內容，畫面還是能正常顯示圖片。
 * 3. 兩者都沒有 → 直接顯示「尚無圖片」
 */
function setupArtworkImage(imgEl, placeholderEl, art) {
  imgEl.onerror = null;
  imgEl.classList.remove("img-loading");

  // 依序嘗試：原始網址（圖床 or Drive 的 lh3 CDN）→ Drive 備援網址 → 後端 base64 代理
  const chain = [];
  if (art.ImageURL) chain.push(art.ImageURL);
  if (art.DriveBackupURL && art.DriveBackupURL !== art.ImageURL) chain.push(art.DriveBackupURL);

  if (!chain.length && !(art.needsProxy && art.ID)) {
    imgEl.style.display = "none";
    placeholderEl.style.display = "flex";
    return;
  }

  imgEl.style.display = "block";
  placeholderEl.style.display = "none";

  let stage = 0;
  const giveUp = () => {
    imgEl.onerror = null;
    imgEl.classList.remove("img-loading");
    imgEl.style.display = "none";
    placeholderEl.style.display = "flex";
  };

  const tryNext = () => {
    if (stage < chain.length) {
      imgEl.src = chain[stage++];
      return;
    }
    // 所有直接網址都失敗了，才動用後端代理（慢、且吃 Apps Script 配額，所以放最後）
    imgEl.onerror = null;
    if (art.needsProxy && art.ID) {
      imgEl.classList.add("img-loading");
      Api.fetchPrivateImageDataUrl(art.ID)
        .then((dataUrl) => { imgEl.classList.remove("img-loading"); imgEl.src = dataUrl; })
        .catch(giveUp);
    } else {
      giveUp();
    }
  };

  imgEl.onerror = tryNext;
  tryNext();
}

/** 建立一張作品便條紙卡片 DOM。art 需為 sanitizeArtworkPublic_/OwnerView_ 回傳格式（含 DisplayName）。 */
function createNoteCardEl(art, opts) {
  opts = opts || {};
  const card = document.createElement("div");
  card.className = "note-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `查看 ${art.DisplayName} 的作品`);
  card.dataset.artworkId = art.ID;

  const showVisibilityBadge = opts.showVisibilityBadge && art.Visibility;

  card.innerHTML = `
    <span class="pin"></span>
    <span class="sticker"></span>
    <span class="tape-corner"></span>
    <div class="note-thumb-wrap">
      <img loading="lazy" alt="${escapeHtml(art.DisplayName)} 的 AI 作品">
      <div class="no-image-placeholder">
        <span class="no-image-icon">🖼️</span>
        <span>尚無圖片</span>
      </div>
      ${showVisibilityBadge ? `<span class="visibility-badge">${visibilityLabel(art.Visibility)}</span>` : ""}
    </div>
    <div class="note-meta-row">
      <span class="note-student">${escapeHtml(art.DisplayName)}</span>
      <span class="note-class">${escapeHtml(art.ClassName)}</span>
    </div>
    <div class="note-tags">
      ${art.AITool ? `<span class="tool-chip">${escapeHtml(art.AITool)}</span>` : ""}
      ${parseArtTags(art).map((t) => `<span class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join("")}
    </div>
    <div class="note-footer-row">
      <span class="like-count">♥ ${Number(art.Likes || 0)}</span>
    </div>
  `;

  const img = card.querySelector("img");
  const placeholder = card.querySelector(".no-image-placeholder");
  setupArtworkImage(img, placeholder, art);

  attachTiltEffect(card);

  card.addEventListener("click", (e) => {
    if (e.target.closest(".tag-chip") && opts.onTagClick) {
      e.stopPropagation();
      opts.onTagClick(e.target.closest(".tag-chip").dataset.tag);
      return;
    }
    openArtworkModal(art);
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openArtworkModal(art);
    }
  });

  return card;
}

/**
 * 讓便條紙卡片跟著滑鼠做真正的 3D 傾斜效果，像從公佈欄上被拿起來端詳一樣。
 * 使用 pointermove（涵蓋滑鼠與觸控筆），觸控點按則交給既有的 CSS hover 效果。
 */
function attachTiltEffect(card) {
  const MAX_TILT = 10; // 度數上限，避免歪太誇張
  function handleMove(e) {
    if (e.pointerType === "touch") return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rotateY = (x - 0.5) * MAX_TILT * 2;
    const rotateX = (0.5 - y) * MAX_TILT * 2;
    card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px) scale(1.03)`;
  }
  function reset() { card.style.transform = ""; }
  card.addEventListener("pointermove", handleMove);
  card.addEventListener("pointerleave", reset);
  card.addEventListener("pointercancel", reset);
}

function flashNewCard(cardEl) {
  cardEl.classList.add("note-card-new");
  setTimeout(() => cardEl.classList.remove("note-card-new"), 1600);
}

function updateNoteCardLikesInDom(artworkId, likes) {
  document.querySelectorAll(`.note-card[data-artwork-id="${artworkId}"] .like-count`).forEach((el) => {
    el.textContent = `♥ ${Number(likes)}`;
    el.classList.add("like-count-pulse");
    setTimeout(() => el.classList.remove("like-count-pulse"), 700);
  });
}

/* ===================================================================
   輪詢器：定期呼叫 fn，分頁切到背景時自動暫停，切回來立刻補一次
   =================================================================== */
function createPoller(fn, intervalMs) {
  let timer = null;
  async function tick() {
    if (document.hidden) return;
    try { await fn(); } catch (err) { console.warn("輪詢更新失敗：", err.message); }
  }
  function onVisibilityChange() { if (!document.hidden) tick(); }
  document.addEventListener("visibilitychange", onVisibilityChange);
  timer = setInterval(tick, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}

function renderStateMessage(container, { type, text, onRetry }) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "state-msg" + (type === "error" ? " error" : "");

  if (type === "loading") {
    wrap.innerHTML = `<div class="spinner-chalk"></div><div>${escapeHtml(text)}</div>`;
  } else if (type === "error") {
    wrap.innerHTML = `<div>⚠️ ${escapeHtml(text)}</div>`;
    if (onRetry) {
      const btn = document.createElement("button");
      btn.className = "btn btn-chalk retry-btn";
      btn.textContent = "重新載入";
      btn.addEventListener("click", onRetry);
      wrap.appendChild(btn);
    }
  } else {
    wrap.innerHTML = `<div>${escapeHtml(text)}</div>`;
  }
  container.appendChild(wrap);
}

/* ===================================================================
   Modal：作品詳細頁
   =================================================================== */
let currentModalArtwork = null;
let modalPoller = null;
let lastCommentSignature = "";

function ensureModalExists() {
  if (document.getElementById("artwork-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "artwork-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button class="modal-close" aria-label="關閉">✕</button>
      <div class="modal-grid">
        <div class="modal-img-wrap">
          <img id="modal-img" alt="">
          <div class="no-image-placeholder" id="modal-img-placeholder">
            <span class="no-image-icon">🖼️</span>
            <span>這件作品尚無圖片</span>
          </div>
        </div>
        <div>
          <h2 class="modal-title" id="modal-title"></h2>
          <div class="modal-sub" id="modal-sub"></div>
          <div class="note-tags" id="modal-tags" style="margin-bottom:12px;"></div>
          <div class="prompt-note" id="modal-prompt"></div>
          <div class="desc-block">
            <h4>創作說明</h4>
            <div id="modal-desc"></div>
          </div>
          <div class="like-row">
            <button class="like-btn" id="modal-like-btn">♥ 按讚</button>
            <span id="modal-like-count"></span>
          </div>
          <div class="comments-block">
            <h4>留言區</h4>
            <div id="modal-comments-list"></div>
            <form class="comment-form" id="modal-comment-form">
              <input type="text" name="name" placeholder="你的名字" required maxlength="20">
              <input type="text" name="comment" placeholder="留言鼓勵一下吧！" required maxlength="200">
              <button type="submit" class="btn btn-pin" style="padding:8px 16px;font-size:0.95rem;">送出</button>
            </form>
            <div class="form-msg" id="modal-comment-msg"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector(".modal-close").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeModal();
  });

  overlay.querySelector("#modal-comment-form").addEventListener("submit", handleCommentSubmit);
}

function closeModal() {
  const overlay = document.getElementById("artwork-modal");
  if (overlay) overlay.classList.remove("open");
  currentModalArtwork = null;
  if (modalPoller) { modalPoller.stop(); modalPoller = null; }
}

function syncModalLikesIfOpen(artworkId, likes) {
  if (!currentModalArtwork || currentModalArtwork.ID !== artworkId) return;
  currentModalArtwork.Likes = likes;
  const el = document.getElementById("modal-like-count");
  if (el) el.textContent = `${Number(likes)} 人按讚`;
}

function likedArtworkIds() {
  try { return JSON.parse(localStorage.getItem("likedArtworkIds") || "[]"); } catch (e) { return []; }
}

function markArtworkLiked(id) {
  const liked = likedArtworkIds();
  if (!liked.includes(id)) {
    liked.push(id);
    localStorage.setItem("likedArtworkIds", JSON.stringify(liked));
  }
}

async function openArtworkModal(art) {
  ensureModalExists();
  currentModalArtwork = art;
  const overlay = document.getElementById("artwork-modal");

  const img = document.getElementById("modal-img");
  const imgPlaceholder = document.getElementById("modal-img-placeholder");
  img.alt = art.DisplayName + " 的 AI 作品";
  setupArtworkImage(img, imgPlaceholder, art);

  document.getElementById("modal-title").textContent = art.DisplayName;
  document.getElementById("modal-sub").textContent = `${art.ClassName} · ${new Date(art.Timestamp).toLocaleDateString("zh-TW")}${
    art.Visibility ? " · " + visibilityLabel(art.Visibility) : ""
  }`;
  document.getElementById("modal-tags").innerHTML = `
    ${art.AITool ? `<span class="tool-chip">${escapeHtml(art.AITool)}</span>` : ""}
    ${parseArtTags(art).map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join("")}
  `;
  document.getElementById("modal-prompt").textContent = art.Prompt || "（未提供 Prompt）";
  document.getElementById("modal-desc").textContent = art.Description || "（未提供說明）";

  const likeBtn = document.getElementById("modal-like-btn");
  const likeCountEl = document.getElementById("modal-like-count");
  likeCountEl.textContent = `${Number(art.Likes || 0)} 人按讚`;

  const alreadyLiked = likedArtworkIds().includes(art.ID);
  likeBtn.disabled = alreadyLiked;
  likeBtn.textContent = alreadyLiked ? "已按讚" : "♥ 按讚";
  likeBtn.onclick = () => handleLikeClick(art);

  document.getElementById("modal-comment-msg").className = "form-msg";
  document.getElementById("modal-comments-list").innerHTML = `<div style="color:#8a7d63;font-size:0.88rem;">留言載入中...</div>`;

  overlay.classList.add("open");

  try {
    const res = await Api.getComments(art.ID);
    lastCommentSignature = commentSignature_(res.comments || []);
    renderComments(res.comments || []);
  } catch (err) {
    document.getElementById("modal-comments-list").innerHTML =
      `<div style="color:#a8402f;font-size:0.88rem;">留言載入失敗：${escapeHtml(err.message)}</div>`;
  }

  if (modalPoller) modalPoller.stop();
  modalPoller = createPoller(async () => {
    if (!currentModalArtwork || currentModalArtwork.ID !== art.ID) return;
    const res = await Api.getComments(art.ID);
    const sig = commentSignature_(res.comments || []);
    if (sig !== lastCommentSignature) {
      lastCommentSignature = sig;
      renderComments(res.comments || []);
    }
  }, 8000);
}

function commentSignature_(comments) {
  return comments.length + "|" + (comments[comments.length - 1]?.Timestamp || "");
}

function renderComments(comments) {
  const list = document.getElementById("modal-comments-list");
  if (!comments.length) {
    list.innerHTML = `<div style="color:#8a7d63;font-size:0.88rem;">還沒有留言，來當第一個吧！</div>`;
    return;
  }
  list.innerHTML = comments
    .map(
      (c) => `
      <div class="comment-item">
        <b>${escapeHtml(c.CommenterName)}</b>${escapeHtml(c.Comment)}
        <span class="comment-time">${new Date(c.Timestamp).toLocaleString("zh-TW")}</span>
      </div>`
    )
    .join("");
}

async function handleLikeClick(art) {
  const likeBtn = document.getElementById("modal-like-btn");
  likeBtn.disabled = true;
  likeBtn.textContent = "處理中...";
  try {
    const res = await Api.likeArtwork(art.ID);
    const newCount = res.likes !== undefined ? res.likes : Number(art.Likes || 0) + 1;
    art.Likes = newCount;
    document.getElementById("modal-like-count").textContent = `${newCount} 人按讚`;
    likeBtn.textContent = "已按讚";
    markArtworkLiked(art.ID);
    updateNoteCardLikesInDom(art.ID, newCount);
  } catch (err) {
    likeBtn.disabled = false;
    likeBtn.textContent = "♥ 按讚";
    alert("按讚失敗：" + err.message);
  }
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  const comment = form.comment.value.trim();
  const msgEl = document.getElementById("modal-comment-msg");
  if (!name || !comment) return;

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    await Api.postComment(currentModalArtwork.ID, name, comment);
    form.reset();
    msgEl.className = "form-msg show success";
    msgEl.textContent = "留言送出成功！";
    const res = await Api.getComments(currentModalArtwork.ID);
    lastCommentSignature = commentSignature_(res.comments || []);
    renderComments(res.comments || []);
  } catch (err) {
    msgEl.className = "form-msg show error";
    msgEl.textContent = "留言失敗：" + err.message;
  } finally {
    submitBtn.disabled = false;
  }
}

/* =========================================================================
   檔案下載 / 讀取（AI 作圖的結果視窗、我的頁面的下載按鈕共用）
   ========================================================================= */

/** 建一個隱形的 <a download> 並按下去 */
function triggerFileDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 把 data: URI 轉成 PNG 檔並觸發下載（來源不是 PNG 時用 canvas 轉一次） */
function downloadDataUrlAsPng(dataUrl, filename) {
  return new Promise((resolve, reject) => {
    if (dataUrl.startsWith("data:image/png")) {
      triggerFileDownload(dataUrl, filename);
      resolve();
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        triggerFileDownload(canvas.toDataURL("image/png"), filename);
        resolve();
      } catch (e) {
        // 跨網域圖片會讓 canvas 被污染而無法匯出，這時直接下載原檔
        triggerFileDownload(dataUrl, filename);
        resolve();
      }
    };
    img.onerror = () => reject(new Error("圖片讀取失敗"));
    img.src = dataUrl;
  });
}

/** 讀取使用者選的檔案，回傳 { base64, mimeType }（base64 不含 data: 前綴） */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma === -1) { reject(new Error("檔案格式錯誤")); return; }
      resolve({ base64: result.slice(comma + 1), mimeType: file.type || "application/octet-stream" });
    };
    reader.onerror = () => reject(new Error("檔案讀取失敗"));
    reader.readAsDataURL(file);
  });
}
