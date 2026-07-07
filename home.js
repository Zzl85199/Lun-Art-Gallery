document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav("home");
  renderFooterYear();

  const container = document.getElementById("featured-grid");
  renderStateMessage(container, { type: "loading", text: "正在從公佈欄取下作品..." });

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

    // 隨機挑選最多 6 件作品
    const shuffled = [...artworks].sort(() => Math.random() - 0.5);
    const featured = shuffled.slice(0, Math.min(6, shuffled.length));

    container.innerHTML = "";
    featured.forEach((art) => container.appendChild(createNoteCardEl(art)));
  } catch (err) {
    renderStateMessage(container, {
      type: "error",
      text: "作品載入失敗：" + err.message,
      onRetry: () => location.reload(),
    });
  }
});
