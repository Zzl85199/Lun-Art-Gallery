document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav("gallery");
  renderFooterYear();

  const filterMount = document.getElementById("gallery-filter-mount");
  const container = document.getElementById("gallery-grid");
  const filterBar = mountSharedFilterBar(filterMount, "gallery");

  renderStateMessage(container, { type: "loading", text: "正在整理公佈欄上的作品..." });

  let allArtworks = [];
  const artworkById = new Map();
  const cardById = new Map();

  async function initialLoad() {
    renderStateMessage(container, { type: "loading", text: "正在整理公佈欄上的作品..." });
    try {
      const res = await Api.getArtworks();
      allArtworks = res.artworks || [];
      allArtworks.forEach((a) => artworkById.set(a.ID, a));
      filterBar.refreshOptions(allArtworks);
      renderAll();
      startLivePolling();
    } catch (err) {
      renderStateMessage(container, {
        type: "error",
        text: "作品載入失敗（可能是 Apps Script 額度用盡或網址設定錯誤）：" + err.message,
        onRetry: initialLoad,
      });
    }
  }

  function renderAll() {
    const filtered = allArtworks.filter((a) => filterBar.matches(a));
    filterBar.countEl.textContent = `共 ${filtered.length} 件作品`;

    cardById.clear();
    if (!filtered.length) {
      renderStateMessage(container, { type: "empty", text: "找不到符合條件的作品，換個關鍵字試試？" });
      return;
    }
    container.innerHTML = "";
    filtered.forEach((art) => {
      const card = createNoteCardEl(art, { showVisibilityBadge: true, onTagClick: (tag) => filterBar.setTag(tag) });
      cardById.set(art.ID, card);
      container.appendChild(card);
    });
  }

  function startLivePolling() {
    createPoller(async () => {
      const res = await Api.getArtworks();
      const latest = res.artworks || [];
      const latestIds = new Set(latest.map((a) => a.ID));
      let hasNewOrRemoved = false;

      for (const id of Array.from(artworkById.keys())) {
        if (!latestIds.has(id)) {
          artworkById.delete(id);
          const card = cardById.get(id);
          if (card) { card.remove(); cardById.delete(id); }
          allArtworks = allArtworks.filter((a) => a.ID !== id);
          hasNewOrRemoved = true;
        }
      }

      latest.forEach((art) => {
        const existing = artworkById.get(art.ID);
        if (!existing) {
          artworkById.set(art.ID, art);
          allArtworks.unshift(art);
          hasNewOrRemoved = true;
          if (filterBar.matches(art)) {
            const card = createNoteCardEl(art, { showVisibilityBadge: true, onTagClick: (tag) => filterBar.setTag(tag) });
            cardById.set(art.ID, card);
            container.prepend(card);
            flashNewCard(card);
          }
        } else if (Number(existing.Likes) !== Number(art.Likes)) {
          existing.Likes = art.Likes;
          updateNoteCardLikesInDom(art.ID, art.Likes);
          syncModalLikesIfOpen(art.ID, art.Likes);
        }
      });

      if (hasNewOrRemoved) {
        filterBar.refreshOptions(allArtworks);
        filterBar.countEl.textContent = `共 ${allArtworks.filter((a) => filterBar.matches(a)).length} 件作品`;
        if (container.querySelector(".state-msg") && allArtworks.some((a) => filterBar.matches(a))) {
          renderAll();
        }
      }
    }, 15000);
  }

  filterBar.onChange(renderAll);
  initialLoad();
});
