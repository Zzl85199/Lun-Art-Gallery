document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("story");
  renderFooterYear();

  const loadingEl = document.getElementById("story-loading");
  const emptyEl = document.getElementById("story-empty");
  const errorEl = document.getElementById("story-error");
  const contentEl = document.getElementById("story-content");
  const chainEl = document.getElementById("story-chain");
  const roundSection = document.getElementById("round-section");
  const roundGridEl = document.getElementById("story-round-grid");
  const roundCountdownEl = document.getElementById("round-countdown");
  const roundFinishedEl = document.getElementById("round-finished");
  const voteWrapEl = document.getElementById("story-vote-wrap");

  const voterId = getVoterId();
  let countdownTimer = null;
  let pollTimer = null;
  let voting = false; // 避免同一個人手快連點造成重複請求

  function getVoterId() {
    let id = localStorage.getItem("story_voter_id");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : "voter-" + Date.now() + "-" + Math.random());
      localStorage.setItem("story_voter_id", id);
    }
    return id;
  }

  function showState(state) {
    loadingEl.style.display = state === "loading" ? "block" : "none";
    emptyEl.style.display = state === "empty" ? "block" : "none";
    errorEl.style.display = state === "error" ? "block" : "none";
    contentEl.style.display = state === "content" ? "block" : "none";
    if (voteWrapEl) voteWrapEl.style.display = state === "content" ? "block" : "none";
  }

  async function loadStory() {
    try {
      const res = await Api.getStory();
      const story = res.story || { chain: [], round: {} };
      const chain = story.chain || [];
      const round = story.round || {};

      if (chain.length === 0 && (!round.candidates || round.candidates.length === 0)) {
        showState("empty");
        return;
      }

      showState("content");
      renderChain(chain);
      renderRound(round);
    } catch (err) {
      errorEl.textContent = "載入失敗：" + err.message;
      showState("error");
    }
  }

  function renderChain(chain) {
    if (chain.length === 0) {
      chainEl.innerHTML = `<p style="text-align:center;color:#8a7d68;">還沒有故事，等第一輪投票結算後就會出現在這裡！</p>`;
      return;
    }
    chainEl.innerHTML = chain
      .map((link, i) => {
        const isLast = i === chain.length - 1;
        return `
          <div class="story-frame">
            <div class="story-frame-number">第 ${link.Order} 話</div>
            <div class="story-frame-img">
              <img src="${escapeHtml(link.ImageURL)}" alt="故事第 ${link.Order} 話" loading="lazy"
                   onerror="this.onerror=null;this.src='${escapeHtml(link.ImageURL)}';this.classList.add('story-frame-broken');">
            </div>
            <div class="story-frame-caption">
              <b>${escapeHtml(link.StudentName)}</b>
              <span class="tag-chip">${escapeHtml(link.ClassName)}</span>
              ${link.WinningVotes ? `<span class="story-frame-votes">🏆 ${link.WinningVotes} 票勝出</span>` : ""}
            </div>
          </div>
          ${isLast ? "" : `<div class="story-arrow">➜</div>`}
        `;
      })
      .join("");
  }

  function renderRound(round) {
    clearInterval(countdownTimer);

    if (round.finished || !round.candidates || round.candidates.length === 0) {
      roundSection.style.display = "none";
      roundFinishedEl.style.display = round.finished ? "block" : "none";
      return;
    }

    roundSection.style.display = "block";
    roundFinishedEl.style.display = "none";

    const totalVotes = round.candidates.reduce((sum, c) => sum + c.voteCount, 0);
    const myVoteId = localStorage.getItem("story_my_vote_round_" + round.roundNumber) || "";

    roundGridEl.innerHTML = round.candidates
      .map((c) => {
        const pct = totalVotes > 0 ? Math.round((c.voteCount / totalVotes) * 100) : 0;
        const isMine = c.artworkId === myVoteId;
        return `
          <div class="story-vote-card ${isMine ? "is-my-vote" : ""}" data-artwork-id="${escapeHtml(c.artworkId)}">
            <div class="story-vote-img">
              <img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.studentName)} 的作品" loading="lazy">
            </div>
            <div class="story-vote-info">
              <b>${escapeHtml(c.studentName)}</b>
              <span class="tag-chip">${escapeHtml(c.className)}</span>
            </div>
            <div class="vote-bar-track"><div class="vote-bar-fill" style="width:${pct}%;"></div></div>
            <div class="vote-count-label">${c.voteCount} 票（${pct}%）</div>
            ${
              isMine
                ? `<button class="btn btn-outline-dark vote-btn retract-btn" type="button">❌ 取消這一票</button>`
                : `<button class="btn btn-pin vote-btn" type="button">投給這張</button>`
            }
          </div>
        `;
      })
      .join("");

    roundGridEl.querySelectorAll(".vote-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const card = e.target.closest(".story-vote-card");
        if (btn.classList.contains("retract-btn")) {
          retractVote(round.roundNumber);
        } else {
          castVote(card.dataset.artworkId, round.roundNumber);
        }
      });
    });

    startCountdown(round.estimatedEndsAt);
  }

  function startCountdown(estimatedEndsAtIso) {
    if (!estimatedEndsAtIso) {
      roundCountdownEl.textContent = "";
      return;
    }
    const endsAt = new Date(estimatedEndsAtIso).getTime();

    function tick() {
      const remain = endsAt - Date.now();
      if (remain <= 0) {
        roundCountdownEl.textContent = "⏳ 已經過了預計結算時間，正在等待老師或系統結算，請稍候（頁面會自動更新）...";
        clearInterval(countdownTimer);
        return;
      }
      const h = Math.floor(remain / 3600000);
      const m = Math.floor((remain % 3600000) / 60000);
      const s = Math.floor((remain % 60000) / 1000);
      roundCountdownEl.textContent = `⏳ 預計還有 ${h} 小時 ${m} 分 ${s} 秒結算這一輪（老師也可能提早手動結算）`;
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  async function castVote(artworkId, roundNumber) {
    if (voting) return;
    voting = true;
    try {
      const res = await Api.voteStory(voterId, artworkId);
      localStorage.setItem("story_my_vote_round_" + roundNumber, artworkId);
      renderRound(res.round);
    } catch (err) {
      alert("投票失敗：" + err.message + "\n頁面即將重新整理資料。");
      await loadStory();
    } finally {
      voting = false;
    }
  }

  async function retractVote(roundNumber) {
    if (voting) return;
    voting = true;
    try {
      const res = await Api.retractStoryVote(voterId);
      localStorage.removeItem("story_my_vote_round_" + roundNumber);
      renderRound(res.round);
    } catch (err) {
      alert("取消投票失敗：" + err.message + "\n頁面即將重新整理資料。");
      await loadStory();
    } finally {
      voting = false;
    }
  }

  loadStory();
  pollTimer = setInterval(loadStory, 15000); // 每 15 秒同步一次最新票數與故事進度

  /* =========================================================
     我的故事本 — 純前端、localStorage，不會送到後端、不會被其他人看到
     ========================================================= */
  const MY_BOARDS_KEY = "my_story_boards_v1";
  const MAX_BOARDS = 3;
  const poolEl = document.getElementById("my-story-pool");
  const boardsEl = document.getElementById("my-story-boards");
  const addBoardBtn = document.getElementById("add-story-board-btn");

  let galleryPool = []; // 素材庫：畫廊裡所有作品
  let myBoards = loadMyBoards();
  let activeBoardIndex = Math.max(myBoards.length - 1, 0); // 點擊「＋」時預設加進的故事版

  function loadMyBoards() {
    try {
      const raw = localStorage.getItem(MY_BOARDS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {
      /* 資料壞掉就當作沒有，重新開始 */
    }
    return [{ frames: [] }];
  }

  function saveMyBoards() {
    localStorage.setItem(MY_BOARDS_KEY, JSON.stringify(myBoards));
  }

  async function loadGalleryPool() {
    try {
      const res = await Api.getArtworks();
      galleryPool = res.artworks || [];
      renderPool();
    } catch (err) {
      poolEl.innerHTML = `<p style="color:#7a2116;">素材庫載入失敗：${escapeHtml(err.message)}</p>`;
    }
  }

  function renderPool() {
    if (galleryPool.length === 0) {
      poolEl.innerHTML = `<p style="color:#8a7d68;">畫廊裡還沒有作品，等大家投稿後就會出現在這裡。</p>`;
      return;
    }
    poolEl.innerHTML = galleryPool
      .map(
        (a) => `
        <div class="my-story-pool-item" draggable="true" data-artwork-id="${escapeHtml(a.ID)}">
          <img src="${escapeHtml(a.ImageURL)}" alt="${escapeHtml(a.StudentName)} 的作品" loading="lazy">
          <span class="pool-item-add" title="加入目前的故事版">＋</span>
          <div class="pool-item-name">${escapeHtml(a.StudentName)}</div>
        </div>
      `
      )
      .join("");

    poolEl.querySelectorAll(".my-story-pool-item").forEach((el) => {
      const artworkId = el.dataset.artworkId;
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ type: "pool", artworkId }));
      });
      el.querySelector(".pool-item-add").addEventListener("click", () => {
        addFrameToBoard(activeBoardIndex, artworkId);
      });
    });
  }

  function findArtwork(artworkId) {
    return galleryPool.find((a) => String(a.ID) === String(artworkId));
  }

  function addFrameToBoard(boardIndex, artworkId, insertAt) {
    const art = findArtwork(artworkId);
    if (!art || !myBoards[boardIndex]) return;
    const frame = {
      artworkId: String(art.ID),
      imageUrl: art.ImageURL,
      studentName: art.StudentName,
      className: art.ClassName,
      caption: "",
    };
    const frames = myBoards[boardIndex].frames;
    if (typeof insertAt === "number" && insertAt >= 0 && insertAt <= frames.length) {
      frames.splice(insertAt, 0, frame);
    } else {
      frames.push(frame);
    }
    saveMyBoards();
    renderBoards();
  }

  function renderBoards() {
    boardsEl.innerHTML = myBoards
      .map((board, boardIndex) => {
        const framesHtml =
          board.frames.length === 0
            ? `<p class="my-board-empty">把素材庫的圖片拖到這裡，或點圖片上的「＋」加進來</p>`
            : board.frames
                .map(
                  (f, frameIndex) => `
              <div class="my-story-frame" draggable="true" data-board="${boardIndex}" data-frame="${frameIndex}">
                <button class="my-frame-remove" type="button" title="移除這一格" data-board="${boardIndex}" data-frame="${frameIndex}">×</button>
                <div class="story-frame-img"><img src="${escapeHtml(f.imageUrl)}" alt="${escapeHtml(f.studentName)}"></div>
                <div class="story-frame-caption"><b>${escapeHtml(f.studentName)}</b></div>
                <input type="text" class="my-frame-caption-input" placeholder="加一句話說說這一格的故事..."
                       value="${escapeHtml(f.caption || "")}" data-board="${boardIndex}" data-frame="${frameIndex}">
              </div>
            `
                )
                .join("");

        return `
          <div class="my-story-board" data-board-index="${boardIndex}">
            <div class="my-board-header">
              <span class="my-board-title">📖 故事版 ${boardIndex + 1}</span>
              ${myBoards.length > 1 ? `<button class="my-board-delete" type="button" data-board="${boardIndex}">🗑 刪除這個故事版</button>` : ""}
            </div>
            <div class="my-story-board-dropzone" data-board="${boardIndex}">${framesHtml}</div>
          </div>
        `;
      })
      .join("");

    addBoardBtn.style.display = myBoards.length >= MAX_BOARDS ? "none" : "inline-block";
    wireBoardEvents();
  }

  function wireBoardEvents() {
    // 點某個故事版任何地方，之後從素材庫按「＋」預設就加進這一版
    boardsEl.querySelectorAll(".my-story-board").forEach((el) => {
      el.addEventListener("click", () => {
        activeBoardIndex = Number(el.dataset.boardIndex);
      });
    });

    boardsEl.querySelectorAll(".my-board-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.board);
        if (!confirm("確定要刪除這個故事版嗎？裡面排好的內容會不見喔。")) return;
        myBoards.splice(idx, 1);
        if (myBoards.length === 0) myBoards.push({ frames: [] });
        activeBoardIndex = Math.max(myBoards.length - 1, 0);
        saveMyBoards();
        renderBoards();
      });
    });

    boardsEl.querySelectorAll(".my-frame-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const boardIdx = Number(btn.dataset.board);
        const frameIdx = Number(btn.dataset.frame);
        myBoards[boardIdx].frames.splice(frameIdx, 1);
        saveMyBoards();
        renderBoards();
      });
    });

    boardsEl.querySelectorAll(".my-frame-caption-input").forEach((input) => {
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("input", () => {
        const boardIdx = Number(input.dataset.board);
        const frameIdx = Number(input.dataset.frame);
        myBoards[boardIdx].frames[frameIdx].caption = input.value;
        saveMyBoards();
      });
    });

    // 故事版內既有的格子也可以拖曳，重新排序或搬到別的故事版
    boardsEl.querySelectorAll(".my-story-frame").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            type: "frame",
            fromBoard: Number(el.dataset.board),
            fromFrame: Number(el.dataset.frame),
          })
        );
      });
    });

    boardsEl.querySelectorAll(".my-story-board-dropzone").forEach((zone) => {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("is-drag-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-drag-over"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("is-drag-over");
        const boardIdx = Number(zone.dataset.board);
        activeBoardIndex = boardIdx;

        let payload;
        try {
          payload = JSON.parse(e.dataTransfer.getData("application/json"));
        } catch (err) {
          return;
        }

        // 算出要插入到這一版的第幾格：如果放在某個既有格子上，就插在它前面；否則放最後面
        const targetFrameEl = e.target.closest(".my-story-frame");
        const insertAt = targetFrameEl ? Number(targetFrameEl.dataset.frame) : myBoards[boardIdx].frames.length;

        if (payload.type === "pool") {
          addFrameToBoard(boardIdx, payload.artworkId, insertAt);
        } else if (payload.type === "frame") {
          const [moved] = myBoards[payload.fromBoard].frames.splice(payload.fromFrame, 1);
          let adjustedInsertAt = insertAt;
          if (payload.fromBoard === boardIdx && payload.fromFrame < insertAt) {
            adjustedInsertAt -= 1; // 拿掉前面的元素後，後面的索引要往前補
          }
          myBoards[boardIdx].frames.splice(adjustedInsertAt, 0, moved);
          saveMyBoards();
          renderBoards();
        }
      });
    });
  }

  addBoardBtn.addEventListener("click", () => {
    if (myBoards.length >= MAX_BOARDS) return;
    myBoards.push({ frames: [] });
    activeBoardIndex = myBoards.length - 1;
    saveMyBoards();
    renderBoards();
  });

  renderBoards();
  loadGalleryPool();
});
