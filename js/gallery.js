document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav("gallery");
  renderFooterYear();

  const filterMount = document.getElementById("gallery-filter-mount");
  const container = document.getElementById("gallery-grid");
  const filterBar = mountSharedFilterBar(filterMount, "gallery");

  renderStateMessage(container, { type: "loading", text: "正在整理公佈欄上的作品..." });

  let allArtworks = [];
  let currentKind = "image"; // "image"（圖片）或 "book"（故事本）
  const artworkById = new Map();
  const cardById = new Map();

  /* 圖片 / 故事本兩個分頁 */
  const kindTabsWrap = document.createElement("div");
  kindTabsWrap.className = "seg-tabs-wrap";
  kindTabsWrap.innerHTML = `
    <div class="seg-tabs">
      <button type="button" class="seg-tab gallery-kind-btn active" data-kind="image">🖼️ 圖片</button>
      <button type="button" class="seg-tab gallery-kind-btn" data-kind="book">📖 故事本</button>
    </div>
  `;
  filterMount.parentNode.insertBefore(kindTabsWrap, filterMount);
  const kindTabs = kindTabsWrap;
  kindTabs.querySelectorAll(".gallery-kind-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentKind = btn.dataset.kind;
      kindTabs.querySelectorAll(".gallery-kind-btn").forEach((b) => b.classList.toggle("active", b === btn));
      // 故事本沒有「使用的 AI 工具」，切過去時把那個下拉藏起來
      filterBar.setToolFilterVisible(currentKind === "image");
      filterBar.refreshOptions(currentKindArtworks());
      renderAll();
    });
  });

  /** 目前分頁對應的作品（先依 Kind 分流，再套篩選條件） */
  function currentKindArtworks() {
    return allArtworks.filter((a) => (currentKind === "book" ? a.Kind === "book" : a.Kind !== "book"));
  }

  async function initialLoad() {
    renderStateMessage(container, { type: "loading", text: "正在整理公佈欄上的作品..." });
    try {
      const res = await Api.getArtworks();
      allArtworks = res.artworks || [];
      allArtworks.forEach((a) => artworkById.set(a.ID, a));
      filterBar.refreshOptions(currentKindArtworks());
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
    const filtered = currentKindArtworks().filter((a) => filterBar.matches(a));
    filterBar.countEl.textContent = `共 ${filtered.length} ${currentKind === "book" ? "本故事本" : "件作品"}`;

    cardById.clear();
    if (!filtered.length) {
      renderStateMessage(container, {
        type: "empty",
        text: currentKind === "book" ? "還沒有人分享故事本，快去做一本吧！" : "找不到符合條件的作品，換個關鍵字試試？",
      });
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
          const inThisKind = currentKind === "book" ? art.Kind === "book" : art.Kind !== "book";
          if (inThisKind && filterBar.matches(art)) {
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
        const inKind = currentKindArtworks();
        filterBar.refreshOptions(inKind);
        filterBar.countEl.textContent = `共 ${inKind.filter((a) => filterBar.matches(a)).length} ${currentKind === "book" ? "本故事本" : "件作品"}`;
        if (container.querySelector(".state-msg") && inKind.some((a) => filterBar.matches(a))) {
          renderAll();
        }
      }
    }, 15000);
  }

  filterBar.onChange(renderAll);
  initialLoad();
});
