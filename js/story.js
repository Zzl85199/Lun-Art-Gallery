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
            <button class="btn btn-pin vote-btn" type="button" ${isMine ? "disabled" : ""}>
              ${isMine ? "✅ 已投這張" : "投給這張"}
            </button>
          </div>
        `;
      })
      .join("");

    roundGridEl.querySelectorAll(".vote-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const card = e.target.closest(".story-vote-card");
        castVote(card.dataset.artworkId, round.roundNumber);
      });
    });

    startCountdown(round.endsAt);
  }

  function startCountdown(endsAtIso) {
    if (!endsAtIso) {
      roundCountdownEl.textContent = "";
      return;
    }
    const endsAt = new Date(endsAtIso).getTime();

    function tick() {
      const remain = endsAt - Date.now();
      if (remain <= 0) {
        roundCountdownEl.textContent = "⏳ 這一輪投票時間到了，正在結算中，請稍候...";
        clearInterval(countdownTimer);
        setTimeout(loadStory, 2000); // 給後端一點時間結算，再重新載入
        return;
      }
      const h = Math.floor(remain / 3600000);
      const m = Math.floor((remain % 3600000) / 60000);
      const s = Math.floor((remain % 60000) / 1000);
      roundCountdownEl.textContent = `⏳ 這一輪投票倒數：${h} 小時 ${m} 分 ${s} 秒`;
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

  loadStory();
  pollTimer = setInterval(loadStory, 15000); // 每 15 秒同步一次最新票數與故事進度
});
