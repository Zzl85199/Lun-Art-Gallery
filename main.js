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

/** 圖片載入失敗時，自動切換成 Google Drive 備援連結 */
function attachImageFallback(imgEl, backupUrl) {
  if (!backupUrl) return;
  let triedBackup = false;
  imgEl.addEventListener("error", () => {
    if (!triedBackup) {
      triedBackup = true;
      imgEl.src = backupUrl;
    }
  });
}

/** 建立一張作品便條紙卡片 DOM */
function createNoteCardEl(art) {
  const card = document.createElement("div");
  card.className = "note-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `查看 ${art.StudentName} 的作品`);

  card.innerHTML = `
    <span class="pin"></span>
    <span class="tape-corner"></span>
    <div class="note-thumb-wrap">
      <img loading="lazy" alt="${escapeHtml(art.StudentName)} 的 AI 作品" src="${escapeHtml(art.ImageURL)}">
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
  attachImageFallback(img, art.DriveBackupURL);

  card.addEventListener("click", () => openArtworkModal(art));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openArtworkModal(art);
    }
  });

  return card;
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
  img.src = art.ImageURL;
  img.alt = art.StudentName + " 的 AI 作品";
  attachImageFallback(img, art.DriveBackupURL);

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
    renderComments(res.comments || []);
  } catch (err) {
    document.getElementById(
      "modal-comments-list"
    ).innerHTML = `<div style="color:#a8402f;font-size:0.88rem;">留言載入失敗：${escapeHtml(err.message)}</div>`;
  }
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
    // 同步更新畫面上對應卡片的讚數
    document.querySelectorAll(".note-card").forEach((card) => {
      // 由呼叫端各自處理更精細的同步，這裡先留給頁面自己刷新
    });
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
    renderComments(res.comments || []);
  } catch (err) {
    msgEl.className = "form-msg show error";
    msgEl.textContent = "留言失敗：" + err.message;
  } finally {
    submitBtn.disabled = false;
  }
}
