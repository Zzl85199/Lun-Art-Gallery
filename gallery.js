document.addEventListener("DOMContentLoaded", async () => {
  setActiveNav("gallery");
  renderFooterYear();

  const container = document.getElementById("gallery-grid");
  const resultCountEl = document.getElementById("result-count");
  const classFilter = document.getElementById("filter-class");
  const toolFilter = document.getElementById("filter-tool");
  const searchInput = document.getElementById("filter-search");

  renderStateMessage(container, { type: "loading", text: "正在整理公佈欄上的作品..." });

  let allArtworks = [];

  async function load() {
    renderStateMessage(container, { type: "loading", text: "正在整理公佈欄上的作品..." });
    try {
      const res = await Api.getArtworks();
      allArtworks = res.artworks || [];
      populateFilterOptions(allArtworks);
      applyFilters();
    } catch (err) {
      renderStateMessage(container, {
        type: "error",
        text: "作品載入失敗（可能是 Apps Script 額度用盡或網址設定錯誤）：" + err.message,
        onRetry: load,
      });
    }
  }

  function populateFilterOptions(artworks) {
    const classes = Array.from(new Set(artworks.map((a) => a.ClassName).filter(Boolean))).sort();
    const tools = Array.from(new Set(artworks.map((a) => a.AITool).filter(Boolean))).sort();

    classFilter.innerHTML =
      `<option value="">全部班級</option>` +
      classes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

    toolFilter.innerHTML =
      `<option value="">全部 AI 工具</option>` +
      tools.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  }

  function applyFilters() {
    const cls = classFilter.value;
    const tool = toolFilter.value;
    const q = searchInput.value.trim().toLowerCase();

    const filtered = allArtworks.filter((a) => {
      if (cls && a.ClassName !== cls) return false;
      if (tool && a.AITool !== tool) return false;
      if (q) {
        const haystack = [a.StudentName, a.Prompt, a.Description, a.Tags]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    resultCountEl.textContent = `共 ${filtered.length} 件作品`;

    if (!filtered.length) {
      renderStateMessage(container, { type: "empty", text: "找不到符合條件的作品，換個關鍵字試試？" });
      return;
    }

    container.innerHTML = "";
    filtered.forEach((art) => container.appendChild(createNoteCardEl(art)));
  }

  classFilter.addEventListener("change", applyFilters);
  toolFilter.addEventListener("change", applyFilters);
  let debounceTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  });

  load();
});
