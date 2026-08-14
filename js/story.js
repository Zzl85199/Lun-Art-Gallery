document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("story");
  renderFooterYear();

  const gateEl = document.getElementById("story-gate");
  Auth.requireActive(gateEl, (user) => initStoryPage(gateEl, user));
});

const MAX_BOOKS_HINT = 3; // 僅供 UI 顯示，實際上限由後端 Settings 分頁決定

function initStoryPage(root, user) {
  root.innerHTML = `
    <section class="board-section my-story-section" style="padding-top:0;">
      <h2 class="board-heading my-story-heading" style="font-size:1.5rem;">🖼️ 素材庫</h2>
      <p style="text-align:center;color:#6b5f4c;margin-top:-14px;">點作品右上角的 ＋ 就能加進下面目前選中的故事本。</p>
      <div id="pool-filter-mount"></div>
      <div class="my-story-pool" id="my-story-pool"><p style="color:#8a7d68;">載入中...</p></div>

      <h2 class="board-heading my-story-heading" style="font-size:1.7rem;margin-top:44px;">🎨 我的故事本</h2>
      <p style="text-align:center;color:#6b5f4c;margin-top:-16px;">雲端保存，登入任何裝置都能繼續編輯；完成後按「產生繪本」就能直接下載橫式 A4 的 PDF，再到「我的頁面」上傳成故事本。</p>

      <div id="book-tabs" class="btn-row" style="justify-content:center;margin:20px 0;"></div>
      <div id="book-editor"></div>
    </section>
  `;

  initBookEditor(user);
}

/**
 * 即時提示這一頁的文字長度。繪本一頁 1～2 句最好看，
 * 太短會變成圖說、太長印出來會擠在文字帶裡塞不下。
 */
function updateCaptionCounter(textarea, counterEl) {
  if (!counterEl) return;
  const len = textarea.value.trim().length;
  let cls = "";
  let text = "";
  if (len === 0) {
    text = "還沒寫文字";
  } else if (len < 10) {
    cls = "warn";
    text = `${len} 字・有點短，試著寫成一句完整的話`;
  } else if (len <= 60) {
    cls = "good";
    text = `${len} 字・長度剛好 👍`;
  } else if (len <= 120) {
    cls = "warn";
    text = `${len} 字・有點長，一頁 1～2 句最好讀`;
  } else {
    cls = "over";
    text = `${len} 字・太長了，建議拆成兩頁`;
  }
  counterEl.className = "caption-counter " + cls;
  counterEl.textContent = text;
}

/* ==========================================================================
   我的故事本（雲端保存 + debounce 自動儲存 + 繪本 PDF）
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
        <div class="my-story-frame" data-frame-index="${i}" data-artwork-id="${escapeHtml(f.artworkId || "")}">
          <button class="my-frame-remove" type="button" title="移除這一格" data-frame-index="${i}">×</button>
          <div class="my-frame-drag" title="按住這裡拖曳，就能改變順序">拖曳排序</div>
          <div class="story-frame-img">
            ${f.unavailable ? `<div class="no-image-placeholder" style="display:flex;"><span class="no-image-icon">🚫</span><span>圖片已無法顯示</span></div>` : `<img data-frame-img-index="${i}" alt="${escapeHtml(f.nickname || "")}">`}
          </div>
          <div class="story-frame-caption"><b>${escapeHtml(f.nickname || "")}</b></div>
          <textarea class="my-frame-caption-input" placeholder="用 1～2 句話寫出這一頁發生什麼事…" maxlength="200" data-frame-index="${i}">${escapeHtml(f.caption || "")}</textarea>
          <div class="caption-counter" data-frame-index="${i}"></div>
        </div>
      `
          )
          .join("")
      : `<p class="my-board-empty">從下面的素材庫點「＋」把作品加進來吧！</p>`;

    editorEl.innerHTML = `
      <div class="my-board-header">
        <input type="text" id="book-title-input" value="${escapeHtml(currentBook.title)}" maxlength="60" style="font-family:var(--font-hand);font-size:1.2rem;flex:1;">
        <button type="button" class="btn btn-outline-dark" id="delete-book-btn">🗑 刪除這本</button>
        <button type="button" class="btn btn-chalk" id="print-book-btn">📕 產生繪本 / 下載 PDF</button>
      </div>
      <div class="save-status" id="save-status" style="text-align:right;color:#8a7d68;font-size:0.85rem;"></div>
      <div class="writing-tips">
        <b>📝 每一頁的文字這樣寫，才像繪本</b>
        <ul>
          <li><b>一頁 1～2 句就好</b>，寫成完整的句子，句末記得加標點符號。</li>
          <li><b>寫「發生什麼事 ＋ 心情」</b>，不要只寫圖片裡有什麼。<br>
            ✗ 皮皮在讀書　→　✓ 皮皮把書搬到窗邊，一邊看書一邊等櫻花落下來。</li>
          <li><b>跟前一頁接起來</b>：用「後來」「沒想到」「這時候」開頭最好接。</li>
          <li><b>主角名字每頁都要出現</b>，讀的人才不會搞混誰是誰。</li>
        </ul>
      </div>
      <div class="my-story-board-dropzone" id="frames-dropzone">${framesHtml}</div>
    `;

    editorEl.querySelectorAll("img[data-frame-img-index]").forEach((img) => {
      const frame = currentBook.frames[Number(img.dataset.frameImgIndex)];
      if (frame) Api.setImageSrc(img, frame);
    });

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
      const counter = editorEl.querySelector(`.caption-counter[data-frame-index="${textarea.dataset.frameIndex}"]`);
      updateCaptionCounter(textarea, counter);
      textarea.addEventListener("input", () => {
        currentBook.frames[Number(textarea.dataset.frameIndex)].caption = textarea.value;
        updateCaptionCounter(textarea, counter);
        scheduleSave();
      });
    });

    initFrameDragSort();
  }

  /* ---------------- 拖曳排序 ----------------
     用 Pointer Events 而不是 HTML5 drag and drop，因為後者在 iPad / 觸控裝置上不會觸發。
     拖曳只從「拖曳排序」把手開始，這樣文字框還是可以正常點選與輸入。            */
  function initFrameDragSort() {
    const zone = document.getElementById("frames-dropzone");
    if (!zone) return;

    let dragEl = null;

    /** 找出目前指標位置應該插在哪一格前面（回傳 null 代表放到最後） */
    function frameAfterPoint(x, y) {
      const others = Array.from(zone.querySelectorAll(".my-story-frame:not(.dragging)"));
      for (const el of others) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // 指標已經在這一格所在列的上方，或在同一列但還沒越過中線 → 插在它前面
        if (cy > y + r.height / 2 || (Math.abs(cy - y) <= r.height / 2 && cx > x)) return el;
      }
      return null;
    }

    /** 拖曳結束後，把畫面上的順序寫回資料並存檔 */
    function commitOrder() {
      const orderedIds = Array.from(zone.querySelectorAll(".my-story-frame")).map((el) => el.dataset.artworkId);
      const remaining = currentBook.frames.slice();
      const reordered = [];
      orderedIds.forEach((id) => {
        const idx = remaining.findIndex((f) => String(f.artworkId) === String(id));
        if (idx !== -1) reordered.push(remaining.splice(idx, 1)[0]);
      });
      // 保險：有對不上的就接在後面，絕對不要弄丟任何一格
      currentBook.frames = reordered.concat(remaining);
      renderEditor();
      scheduleSave();
    }

    zone.querySelectorAll(".my-frame-drag").forEach((handle) => {
      const frame = handle.closest(".my-story-frame");

      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        dragEl = frame;
        frame.classList.add("dragging");
        zone.classList.add("is-sorting");
        handle.setPointerCapture(e.pointerId);
      });

      handle.addEventListener("pointermove", (e) => {
        if (!dragEl) return;
        e.preventDefault();
        const after = frameAfterPoint(e.clientX, e.clientY);
        if (after === null) {
          if (zone.lastElementChild !== dragEl) zone.appendChild(dragEl);
        } else if (after !== dragEl && after.previousElementSibling !== dragEl) {
          zone.insertBefore(dragEl, after);
        }
      });

      function endDrag(e) {
        if (!dragEl) return;
        dragEl.classList.remove("dragging");
        zone.classList.remove("is-sorting");
        dragEl = null;
        try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* 已經釋放就忽略 */ }
        commitOrder();
      }

      handle.addEventListener("pointerup", endDrag);
      handle.addEventListener("pointercancel", endDrag);
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
          <img alt="${escapeHtml(a.DisplayName)}" loading="lazy">
          <span class="pool-item-add" title="加入目前的故事本">＋</span>
          <div class="pool-item-name">${escapeHtml(a.DisplayName)}${a.isMine ? "（我的）" : ""}</div>
        </div>
      `
      )
      .join("");

    poolEl.querySelectorAll(".my-story-pool-item").forEach((el) => {
      const art = filtered.find((a) => a.ID === el.dataset.artworkId);
      if (art) Api.setImageSrc(el.querySelector("img"), art);
      el.querySelector(".pool-item-add").addEventListener("click", () => addArtworkToCurrentBook(el.dataset.artworkId));
    });
  }

  filterBar.onChange(renderPool);
  loadBooksList();
  loadPool();
}
