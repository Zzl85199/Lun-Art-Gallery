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

/** 建立一張作品便條紙卡片 DOM */
function createNoteCardEl(art) {
  const card = document.createElement("div");
  card.className = "note-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `查看 ${art.StudentName} 的作品`);
  card.dataset.artworkId = art.ID; // 供即時更新時查找對應卡片

  card.innerHTML = `
    <span class="pin"></span>
    <span class="sticker"></span>
    <span class="tape-corner"></span>
    <div class="note-thumb-wrap">
      <img loading="lazy" alt="${escapeHtml(art.StudentName)} 的 AI 作品">
      <div class="no-image-placeholder">
        <span class="no-image-icon">🖼️</span>
        <span>尚無圖片</span>
      </div>
    </div>
    <div class="note-meta-row">
      <span class="note-student">${escapeHtml(art.StudentName)}</span>
      <span class="note-class">${escapeHtml(art.ClassName)}</span>
    </div>
    <div class="note-tags">
      ${art.AITool ? `<span class="tool-chip">${escapeHtml(art.AITool)}</span>` : ""}
      ${(art.Tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
        .join("")}
    </div>
    <div class="note-footer-row">
      <span class="like-count">♥ ${Number(art.Likes || 0)}</span>
    </div>
  `;

  const img = card.querySelector("img");
  const placeholder = card.querySelector(".no-image-placeholder");
  setupImageWithFallback(img, placeholder, art.ImageURL, art.DriveBackupURL);

  attachTiltEffect(card);

  card.addEventListener("click", () => openArtworkModal(art));
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
  const baseRotate = parseFloat(getComputedStyle(card).getPropertyValue("--base-rotate")) || 0;

  function handleMove(e) {
    if (e.pointerType === "touch") return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;  // 0~1
    const y = (e.clientY - rect.top) / rect.height;  // 0~1
    const rotateY = (x - 0.5) * MAX_TILT * 2;
    const rotateX = (0.5 - y) * MAX_TILT * 2;
    card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px) scale(1.03)`;
  }

  function reset() {
    card.style.transform = "";
  }

  card.addEventListener("pointermove", handleMove);
  card.addEventListener("pointerleave", reset);
  card.addEventListener("pointercancel", reset);
}

/** 幫新加入的卡片加一個短暫的「剛剛送達」淡入強調效果 */
function flashNewCard(cardEl) {
  cardEl.classList.add("note-card-new");
  setTimeout(() => cardEl.classList.remove("note-card-new"), 1600);
}

/** 更新畫面上所有符合此 ID 的卡片讚數顯示（首頁精選區、畫廊區都可能同時存在） */
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
    try {
      await fn();
    } catch (err) {
      console.warn("輪詢更新失敗：", err.message);
    }
  }

  function onVisibilityChange() {
    if (!document.hidden) tick();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  timer = setInterval(tick, intervalMs);

  return {
    stop() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}

/** 渲染狀態訊息（載入中 / 錯誤 / 空清單） */
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
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeModal();
  });

  overlay.querySelector("#modal-comment-form").addEventListener("submit", handleCommentSubmit);
}

function closeModal() {
  const overlay = document.getElementById("artwork-modal");
  if (overlay) overlay.classList.remove("open");
  currentModalArtwork = null;
  if (modalPoller) {
    modalPoller.stop();
    modalPoller = null;
  }
}

/** 當畫廊 / 首頁輪詢偵測到讚數變化時，如果剛好開著這件作品的 modal，也同步更新數字 */
function syncModalLikesIfOpen(artworkId, likes) {
  if (!currentModalArtwork || currentModalArtwork.ID !== artworkId) return;
  currentModalArtwork.Likes = likes;
  const el = document.getElementById("modal-like-count");
  if (el) el.textContent = `${Number(likes)} 人按讚`;
}
function likedArtworkIds() {
  try {
    return JSON.parse(localStorage.getItem("likedArtworkIds") || "[]");
  } catch (e) {
    return [];
  }
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
  img.alt = art.StudentName + " 的 AI 作品";
  setupImageWithFallback(img, imgPlaceholder, art.ImageURL, art.DriveBackupURL);

  document.getElementById("modal-title").textContent = art.StudentName;
  document.getElementById("modal-sub").textContent = `${art.ClassName} · ${new Date(
    art.Timestamp
  ).toLocaleDateString("zh-TW")}`;
  document.getElementById("modal-tags").innerHTML = `
    ${art.AITool ? `<span class="tool-chip">${escapeHtml(art.AITool)}</span>` : ""}
    ${(art.Tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`)
      .join("")}
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
    document.getElementById(
      "modal-comments-list"
    ).innerHTML = `<div style="color:#a8402f;font-size:0.88rem;">留言載入失敗：${escapeHtml(err.message)}</div>`;
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
    updateNoteCardLikesInDom(art.ID, newCount); // 同步更新畫面上對應卡片的讚數
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
