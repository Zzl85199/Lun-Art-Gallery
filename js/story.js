document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("story");
  renderFooterYear();

  const gateEl = document.getElementById("story-gate");
  Auth.requireActive(gateEl, (user) => initStoryPage(gateEl, user));
});

const RANK_MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };
const MAX_BOOKS_HINT = 3; // 僅供 UI 顯示，實際上限由後端 Settings 分頁決定

function initStoryPage(root, user) {
  root.innerHTML = `
    <section class="board-section cork-bg" style="padding-top:0;">
      <h2 class="board-heading" style="font-size:1.6rem;">🗳️ 本班作品票選（${escapeHtml(user.className)}）</h2>
      <p style="text-align:center;color:#5b4f3f;" id="round-countdown"></p>
      <div id="round-body"></div>
    </section>

    <section class="board-section" style="padding-top:10px;">
      <h2 class="board-heading" style="font-size:1.4rem;">📊 本輪即時票況</h2>
      <div id="live-standings"></div>
      <h3 style="text-align:center;font-family:var(--font-hand);margin-top:30px;">🏆 本班歷屆榮譽榜</h3>
      <div id="honor-board"></div>
    </section>

    <svg class="wave-divider" viewBox="0 0 1200 44" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(180deg);">
      <path d="M0,20 C150,44 300,0 450,20 C600,40 750,4 900,22 C1050,40 1150,10 1200,20 L1200,44 L0,44 Z" style="fill:var(--cork);"/>
    </svg>

    <section class="board-section my-story-section">
      <h2 class="board-heading my-story-heading" style="font-size:1.7rem;">🎨 我的故事本</h2>
      <p style="text-align:center;color:#6b5f4c;margin-top:-16px;">雲端保存，登入任何裝置都能繼續編輯；完成後可產生列印/PDF 頁面。</p>

      <div id="book-tabs" class="btn-row" style="justify-content:center;margin:20px 0;"></div>
      <div id="book-editor"></div>

      <h3 style="margin:30px 0 10px;font-family:var(--font-hand);font-size:1.1rem;">🖼️ 素材庫（點擊 ＋ 加入目前的故事本）</h3>
      <div id="pool-filter-mount"></div>
      <div class="my-story-pool" id="my-story-pool"><p style="color:#8a7d68;">載入中...</p></div>
    </section>
  `;

  initRoundAndHonorBoard(user);
  initBookEditor(user);
}

/* ==========================================================================
   本班作品票選 + 即時票況 + 歷屆榮譽榜
   ========================================================================== */
function initRoundAndHonorBoard(user) {
  const roundBody = document.getElementById("round-body");
  const countdownEl = document.getElementById("round-countdown");
  const standingsEl = document.getElementById("live-standings");
  const honorEl = document.getElementById("honor-board");

  let countdownTimer = null;
  let voting = false;

  async function load() {
    try {
      const res = await Api.storyGetRound();
      renderRound(res.round);
      renderHonorBoard(res.honorBoard || []);
    } catch (err) {
      roundBody.innerHTML = `<div class="story-msg story-msg-error">載入失敗：${escapeHtml(err.message)}</div>`;
    }
  }

  function renderRound(round) {
    clearInterval(countdownTimer);
    if (!round || !round.candidates || !round.candidates.length) {
      roundBody.innerHTML = `<div class="story-msg">目前沒有可以票選的作品。等同班同學投稿「公開」且「允許故事接龍」的作品後，就會自動開新的一輪！</div>`;
      countdownEl.textContent = "";
      standingsEl.innerHTML = "";
      return;
    }

    const totalVotes = round.candidates.reduce((sum, c) => sum + c.voteCount, 0);

    roundBody.innerHTML = `<div class="story-round-grid">${round.candidates
      .map((c) => {
        const pct = totalVotes > 0 ? Math.round((c.voteCount / totalVotes) * 100) : 0;
        const isMine = c.isMine;
        const isMyVote = round.myVoteArtworkId === c.artworkId;
        return `
          <div class="story-vote-card ${isMyVote ? "is-my-vote" : ""}" data-artwork-id="${escapeHtml(c.artworkId)}">
            <div class="story-vote-img"><img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.nickname)} 的作品" loading="lazy"></div>
            <div class="story-vote-info"><b>${escapeHtml(c.nickname)}</b></div>
            <div class="vote-bar-track"><div class="vote-bar-fill" style="width:${pct}%;"></div></div>
            <div class="vote-count-label">${c.voteCount} 票（${pct}%）</div>
            ${
              isMine
                ? `<div class="form-hint" style="text-align:center;">這是你的作品，不能投給自己</div>`
                : isMyVote
                ? `<button class="btn btn-outline-dark vote-btn retract-btn" type="button">❌ 取消這一票</button>`
                : `<button class="btn btn-pin vote-btn" type="button">投給這張</button>`
            }
          </div>
        `;
      })
      .join("")}</div>`;

    roundBody.querySelectorAll(".vote-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const card = e.target.closest(".story-vote-card");
        castVote(btn.classList.contains("retract-btn") ? "" : card.dataset.artworkId);
      });
    });

    // 簡化版即時票況：沿用同一份候選資料，依票數排序
    const ranked = [...round.candidates].sort((a, b) => b.voteCount - a.voteCount);
    standingsEl.innerHTML = `
      <div class="standings-list">
        ${ranked
          .map(
            (c, i) => `
          <div class="standings-row">
            <span class="standings-rank">${RANK_MEDALS[i + 1] || i + 1}</span>
            <img class="standings-thumb" src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.nickname)}">
            <span class="standings-name">${escapeHtml(c.nickname)}${round.myVoteArtworkId === c.artworkId ? "（你投的）" : ""}</span>
            <span class="standings-votes">${c.voteCount} 票 · ${totalVotes > 0 ? Math.round((c.voteCount / totalVotes) * 100) : 0}%</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    startCountdown(round.estimatedEndsAt);
  }

  function startCountdown(endsAtIso) {
    if (!endsAtIso) { countdownEl.textContent = ""; return; }
    const endsAt = new Date(endsAtIso).getTime();
    function tick() {
      const remain = endsAt - Date.now();
      if (remain <= 0) {
        countdownEl.textContent = "⏳ 已經過了預計結算時間，正在等待老師或系統結算，頁面會自動更新...";
        clearInterval(countdownTimer);
        return;
      }
      const h = Math.floor(remain / 3600000);
      const m = Math.floor((remain % 3600000) / 60000);
      const s = Math.floor((remain % 60000) / 1000);
      countdownEl.textContent = `⏳ 預計還有 ${h} 小時 ${m} 分 ${s} 秒結算這一輪（老師也可能提早手動結算）`;
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function renderHonorBoard(rounds) {
    if (!rounds.length) {
      honorEl.innerHTML = `<p style="text-align:center;color:#8a7d68;">還沒有結算過任何一輪，第一輪結算後榮譽榜就會出現在這裡！</p>`;
      return;
    }
    honorEl.innerHTML = rounds
      .map(
        (r) => `
        <div class="honor-round">
          <div class="honor-round-date">${new Date(r.closedAt).toLocaleDateString("zh-TW")}</div>
          <div class="honor-round-entries">
            ${r.entries
              .map(
                (e) => `
              <div class="honor-entry">
                <span class="honor-rank">${RANK_MEDALS[e.rank] || e.rank}</span>
                ${e.imageUrl ? `<img src="${escapeHtml(e.imageUrl)}" alt="${escapeHtml(e.nickname)}">` : ""}
                <span class="honor-name">${escapeHtml(e.nickname)}</span>
                <span class="honor-votes">${e.votes} 票</span>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      `
      )
      .join("");
  }

  async function castVote(artworkId) {
    if (voting) return;
    voting = true;
    try {
      const res = await Api.storyVote(artworkId);
      renderRound(res.round);
    } catch (err) {
      alert("投票失敗：" + err.message + "\n頁面即將重新整理資料。");
      await load();
    } finally {
      voting = false;
    }
  }

  load();
  createPoller(load, 8000); // 5~10 秒輪詢，分頁背景時自動暫停
}

/* ==========================================================================
   我的故事本（雲端保存 + debounce 自動儲存 + 列印頁）
   ========================================================================== */
function initBookEditor(user) {
  const tabsEl = document.getElementById("book-tabs");
  const editorEl = document.getElementById("book-editor");
  const poolEl = document.getElementById("my-story-pool");
  const poolFilterMount = document.getElementById("pool-filter-mount");

  let books = [];       // 摘要列表（來自 books/list）
  let currentBook = null; // 完整資料（來自 books/get），含 hydrated frames
  let saveTimer = null;
  let poolArtworks = [];
  const filterBar = mountSharedFilterBar(poolFilterMount, "pool");

  async function loadBooksList() {
    tabsEl.innerHTML = `<span style="color:#8a7d68;">載入故事本清單中...</span>`;
    try {
      const res = await Api.booksList();
      books = res.books || [];
      if (!books.length) {
        await createNewBook();
        return;
      }
      renderTabs(books[0].bookId);
      await openBook(books[0].bookId);
    } catch (err) {
      tabsEl.innerHTML = `<span style="color:#a8402f;">故事本清單載入失敗：${escapeHtml(err.message)}</span>`;
    }
  }

  function renderTabs(activeId) {
    tabsEl.innerHTML =
      books
        .map(
          (b) => `<button type="button" class="btn ${b.bookId === activeId ? "btn-pin" : "btn-outline-dark"} book-tab-btn" data-book-id="${b.bookId}">📖 ${escapeHtml(b.title)}</button>`
        )
        .join("") +
      (books.length < MAX_BOOKS_HINT ? `<button type="button" class="btn btn-chalk" id="new-book-btn">➕ 新增故事本</button>` : "");

    tabsEl.querySelectorAll(".book-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => openBook(btn.dataset.bookId));
    });
    const newBtn = document.getElementById("new-book-btn");
    if (newBtn) newBtn.addEventListener("click", createNewBook);
  }

  async function createNewBook() {
    try {
      const res = await Api.booksSave("", "未命名故事本", []);
      const listRes = await Api.booksList();
      books = listRes.books || [];
      renderTabs(res.bookId);
      await openBook(res.bookId);
    } catch (err) {
      alert("新增故事本失敗：" + err.message);
    }
  }

  async function openBook(bookId) {
    editorEl.innerHTML = `<p style="text-align:center;color:#8a7d68;">載入故事本中...</p>`;
    try {
      const res = await Api.booksGet(bookId);
      currentBook = res.book;
      renderTabs(bookId);
      renderEditor();
    } catch (err) {
      editorEl.innerHTML = `<p style="color:#a8402f;text-align:center;">載入失敗：${escapeHtml(err.message)}</p>`;
    }
  }

  function scheduleSave() {
    const statusEl = document.getElementById("save-status");
    if (statusEl) statusEl.textContent = "編輯中...";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 1500);
  }

  async function doSave() {
    if (!currentBook) return;
    const statusEl = document.getElementById("save-status");
    if (statusEl) statusEl.textContent = "儲存中...";
    try {
      const frames = currentBook.frames.map((f) => ({ artworkId: f.artworkId, caption: f.caption || "" }));
      await Api.booksSave(currentBook.bookId, currentBook.title, frames);
      if (statusEl) statusEl.textContent = "✅ 已儲存 " + new Date().toLocaleTimeString("zh-TW");
      const listRes = await Api.booksList();
      books = listRes.books || [];
      renderTabs(currentBook.bookId);
    } catch (err) {
      if (statusEl) statusEl.textContent = "❌ 儲存失敗：" + err.message;
    }
  }

  function renderEditor() {
    const framesHtml = currentBook.frames.length
      ? currentBook.frames
          .map(
            (f, i) => `
        <div class="my-story-frame" data-frame-index="${i}">
          <button class="my-frame-remove" type="button" title="移除這一格" data-frame-index="${i}">×</button>
          <div class="story-frame-img">
            ${f.unavailable ? `<div class="no-image-placeholder" style="display:flex;"><span class="no-image-icon">🚫</span><span>圖片已無法顯示</span></div>` : `<img src="${escapeHtml(Api.resolveImageSrc(f))}" alt="${escapeHtml(f.nickname || "")}">`}
          </div>
          <div class="story-frame-caption"><b>${escapeHtml(f.nickname || "")}</b></div>
          <textarea class="my-frame-caption-input" placeholder="這一頁的文字..." data-frame-index="${i}">${escapeHtml(f.caption || "")}</textarea>
        </div>
      `
          )
          .join("")
      : `<p class="my-board-empty">從下面的素材庫點「＋」把作品加進來吧！</p>`;

    editorEl.innerHTML = `
      <div class="my-board-header">
        <input type="text" id="book-title-input" value="${escapeHtml(currentBook.title)}" maxlength="60" style="font-family:var(--font-hand);font-size:1.2rem;flex:1;">
        <button type="button" class="btn btn-outline-dark" id="delete-book-btn">🗑 刪除這本</button>
        <button type="button" class="btn btn-chalk" id="print-book-btn">🖨️ 產生閱讀/列印頁</button>
      </div>
      <div class="save-status" id="save-status" style="text-align:right;color:#8a7d68;font-size:0.85rem;"></div>
      <div class="my-story-board-dropzone" id="frames-dropzone">${framesHtml}</div>
    `;

    document.getElementById("book-title-input").addEventListener("input", (e) => {
      currentBook.title = e.target.value;
      scheduleSave();
    });

    document.getElementById("delete-book-btn").addEventListener("click", async () => {
      if (!confirm("確定要刪除這本故事本嗎？此動作無法復原。")) return;
      try {
        await Api.booksDelete(currentBook.bookId);
        currentBook = null;
        await loadBooksList();
      } catch (err) {
        alert("刪除失敗：" + err.message);
      }
    });

    document.getElementById("print-book-btn").addEventListener("click", () => {
      window.open("print.html?bookId=" + encodeURIComponent(currentBook.bookId), "_blank");
    });

    editorEl.querySelectorAll(".my-frame-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentBook.frames.splice(Number(btn.dataset.frameIndex), 1);
        renderEditor();
        scheduleSave();
      });
    });

    editorEl.querySelectorAll(".my-frame-caption-input").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        currentBook.frames[Number(textarea.dataset.frameIndex)].caption = textarea.value;
        scheduleSave();
      });
    });
  }

  function addArtworkToCurrentBook(artworkId) {
    if (!currentBook) return;
    const art = poolArtworks.find((a) => a.ID === artworkId);
    if (!art) return;
    currentBook.frames.push({
      artworkId: art.ID,
      ID: art.ID,
      caption: "",
      nickname: art.DisplayName,
      ImageURL: art.ImageURL,
      needsProxy: art.needsProxy,
    });
    renderEditor();
    scheduleSave();
  }

  async function loadPool() {
    try {
      const res = await Api.materialLibrary();
      poolArtworks = res.artworks || [];
      filterBar.refreshOptions(poolArtworks);
      renderPool();
    } catch (err) {
      poolEl.innerHTML = `<p style="color:#7a2116;">素材庫載入失敗：${escapeHtml(err.message)}</p>`;
    }
  }

  function renderPool() {
    const filtered = poolArtworks.filter((a) => filterBar.matches(a));
    filterBar.countEl.textContent = `共 ${filtered.length} 件作品`;
    if (!filtered.length) {
      poolEl.innerHTML = `<p style="color:#8a7d68;">找不到符合篩選條件的作品。</p>`;
      return;
    }
    poolEl.innerHTML = filtered
      .map(
        (a) => `
        <div class="my-story-pool-item" data-artwork-id="${escapeHtml(a.ID)}">
          <img src="${escapeHtml(Api.resolveImageSrc(a))}" alt="${escapeHtml(a.DisplayName)}" loading="lazy">
          <span class="pool-item-add" title="加入目前的故事本">＋</span>
          <div class="pool-item-name">${escapeHtml(a.DisplayName)}${a.isMine ? "（我的）" : ""}</div>
        </div>
      `
      )
      .join("");

    poolEl.querySelectorAll(".my-story-pool-item").forEach((el) => {
      el.querySelector(".pool-item-add").addEventListener("click", () => addArtworkToCurrentBook(el.dataset.artworkId));
    });
  }

  filterBar.onChange(renderPool);
  loadBooksList();
  loadPool();
}
