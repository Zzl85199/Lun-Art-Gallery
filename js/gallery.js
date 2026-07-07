document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav("gallery");
  renderFooterYear();

  const container = document.getElementById("gallery-grid");
  const resultCountEl = document.getElementById("result-count");
  const classFilter = document.getElementById("filter-class");
  const toolFilter = document.getElementById("filter-tool");
  const searchInput = document.getElementById("filter-search");

  renderStateMessage(container, { type: "loading", text: "正在整理公佈欄上的作品..." });

  let allArtworks = [];          // 目前已知的完整作品清單
  const artworkById = new Map(); // ID -> art 物件（同一個物件參考，供 modal 同步使用）
  const cardById = new Map();    // ID -> 卡片 DOM 元素

  async function initialLoad() {
    renderStateMessage(container, { type: "loading", text: "正在整理公佈欄上的作品..." });
    try {
      const res = await Api.getArtworks();
      allArtworks = res.artworks || [];
      allArtworks.forEach((a) => artworkById.set(a.ID, a));
      populateFilterOptions(allArtworks);
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

  function populateFilterOptions(artworks) {
    const classes = Array.from(new Set(artworks.map((a) => a.ClassName).filter(Boolean))).sort();
    const tools = Array.from(new Set(artworks.map((a) => a.AITool).filter(Boolean))).sort();

    const prevClass = classFilter.value;
    const prevTool = toolFilter.value;

    classFilter.innerHTML =
      `<option value="">全部班級</option>` +
      classes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    toolFilter.innerHTML =
      `<option value="">全部 AI 工具</option>` +
      tools.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

    // 保留使用者原本選擇的篩選條件（如果該選項還存在）
    if (classes.includes(prevClass)) classFilter.value = prevClass;
    if (tools.includes(prevTool)) toolFilter.value = prevTool;
  }

  function matchesFilter(a) {
    const cls = classFilter.value;
    const tool = toolFilter.value;
    const q = searchInput.value.trim().toLowerCase();
    if (cls && a.ClassName !== cls) return false;
    if (tool && a.AITool !== tool) return false;
    if (q) {
      const haystack = [a.StudentName, a.Prompt, a.Description, a.Tags].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }

  /** 全量重新渲染（篩選條件改變、或初次載入時使用） */
  function renderAll() {
    const filtered = allArtworks.filter(matchesFilter);
    resultCountEl.textContent = `共 ${filtered.length} 件作品`;

    cardById.clear();
    if (!filtered.length) {
      renderStateMessage(container, { type: "empty", text: "找不到符合條件的作品，換個關鍵字試試？" });
      return;
    }
    container.innerHTML = "";
    filtered.forEach((art) => {
      const card = createNoteCardEl(art);
      cardById.set(art.ID, card);
      container.appendChild(card);
    });
  }

  /** 即時輪詢：抓最新清單，跟畫面上現有的做差異比對，只增/刪/更新有變化的部分 */
  function startLivePolling() {
    createPoller(async () => {
      const res = await Api.getArtworks();
      const latest = res.artworks || [];
      const latestIds = new Set(latest.map((a) => a.ID));
      let hasNewOrRemoved = false;

      // 1. 處理刪除／下架的作品
      for (const id of Array.from(artworkById.keys())) {
        if (!latestIds.has(id)) {
          artworkById.delete(id);
          const card = cardById.get(id);
          if (card) {
            card.remove();
            cardById.delete(id);
          }
          allArtworks = allArtworks.filter((a) => a.ID !== id);
          hasNewOrRemoved = true;
        }
      }

      // 2. 處理新增與更新（讚數變化）
      latest.forEach((art) => {
        const existing = artworkById.get(art.ID);
        if (!existing) {
          // 全新作品：加入資料，若符合目前篩選條件就插入畫面最前面並淡入強調
          artworkById.set(art.ID, art);
          allArtworks.unshift(art);
          hasNewOrRemoved = true;
          if (matchesFilter(art)) {
            const card = createNoteCardEl(art);
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
        populateFilterOptions(allArtworks);
        resultCountEl.textContent = `共 ${allArtworks.filter(matchesFilter).length} 件作品`;
        // 若目前清單是「空狀態」畫面，且現在有新作品符合篩選，重新整體渲染一次
        if (container.querySelector(".state-msg") && allArtworks.some(matchesFilter)) {
          renderAll();
        }
      }
    }, 15000);
  }

  classFilter.addEventListener("change", renderAll);
  toolFilter.addEventListener("change", renderAll);
  let debounceTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderAll, 200);
  });

  initialLoad();
});
