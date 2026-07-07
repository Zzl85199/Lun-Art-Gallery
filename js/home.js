document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav("home");
  renderFooterYear();

  const container = document.getElementById("featured-grid");
  renderStateMessage(container, { type: "loading", text: "正在從公佈欄取下作品..." });

  const featuredIds = new Set();

  try {
    const res = await Api.getArtworks();
    const artworks = res.artworks || [];

    if (!artworks.length) {
      renderStateMessage(container, {
        type: "empty",
        text: "公佈欄還空空的，快來當第一個投稿的人吧！",
      });
      return;
    }

    // 隨機挑選最多 6 件作品（每次重新整理才會換一批，避免瀏覽中一直跳動）
    const shuffled = [...artworks].sort(() => Math.random() - 0.5);
    const featured = shuffled.slice(0, Math.min(6, shuffled.length));

    container.innerHTML = "";
    featured.forEach((art) => {
      featuredIds.add(art.ID);
      container.appendChild(createNoteCardEl(art));
    });

    startLikeSync();
  } catch (err) {
    renderStateMessage(container, {
      type: "error",
      text: "作品載入失敗：" + err.message,
      onRetry: () => location.reload(),
    });
  }

  /** 首頁只做讚數即時同步，不重排精選卡片，避免使用者瀏覽時版面跳動 */
  function startLikeSync() {
    createPoller(async () => {
      const res = await Api.getArtworks();
      (res.artworks || []).forEach((art) => {
        if (featuredIds.has(art.ID)) {
          updateNoteCardLikesInDom(art.ID, art.Likes);
          syncModalLikesIfOpen(art.ID, art.Likes);
        }
      });
    }, 20000);
  }
});
