/**
 * ===============================================================
 * 共用篩選邏輯 + UI 元件（畫廊 + 我的故事本素材庫都用這裡）
 * ===============================================================
 * 篩選維度：班級 / 暱稱 / AI 工具 / Hashtag / 關鍵字
 * Tag 正規化：接受有無 #、逗號/頓號分隔、去空白及重複
 */

function parseArtTags(art) {
  return (art.Tags || "")
    .split(/[,，、]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function createFilterState() {
  return { className: "", nickname: "", aiTool: "", tag: "", keyword: "" };
}

function artworkMatchesFilter(art, state) {
  if (state.className && art.ClassName !== state.className) return false;
  if (state.nickname && (art.DisplayName || art.Nickname || art.StudentName) !== state.nickname) return false;
  if (state.aiTool && art.AITool !== state.aiTool) return false;
  if (state.tag && !parseArtTags(art).some((t) => t.toLowerCase() === state.tag.toLowerCase())) return false;
  if (state.keyword) {
    const q = state.keyword.trim().toLowerCase();
    if (q) {
      const haystack = [art.DisplayName || art.Nickname || art.StudentName, art.Prompt, art.Description, art.Tags]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
  }
  return true;
}

/** 依目前資料重新產生 <select> 選項，盡量保留使用者原本的選擇 */
function populateFilterSelect(selectEl, values, placeholderText, keepValue) {
  const unique = Array.from(new Set(values.filter(Boolean))).sort();
  selectEl.innerHTML =
    `<option value="">${placeholderText}</option>` +
    unique.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if (unique.includes(keepValue)) selectEl.value = keepValue;
}

/**
 * 建立一組完整的篩選列 UI（班級 / 暱稱 / AI 工具 / Hashtag / 關鍵字），插入到 containerEl 中，
 * 回傳 { state, refreshOptions(artworks), matches(art) }，供畫廊頁與故事本素材庫共用同一套邏輯。
 * artworks 陣列需含 ClassName / DisplayName（或 Nickname/StudentName）/ AITool / Tags 欄位。
 */
function mountSharedFilterBar(containerEl, idPrefix) {
  containerEl.innerHTML = `
    <div class="filter-bar">
      <span class="filter-label">篩選：</span>
      <select id="${idPrefix}-class" aria-label="依班級篩選"><option value="">全部班級</option></select>
      <select id="${idPrefix}-nickname" aria-label="依暱稱篩選"><option value="">全部作者</option></select>
      <select id="${idPrefix}-tool" aria-label="依 AI 工具篩選"><option value="">全部 AI 工具</option></select>
      <select id="${idPrefix}-tag" aria-label="依標籤篩選"><option value="">全部標籤</option></select>
      <input type="text" id="${idPrefix}-keyword" placeholder="搜尋暱稱 / Prompt / 說明...">
    </div>
    <p class="result-count" id="${idPrefix}-count" style="color:#5b4f3f;"></p>
  `;

  const state = createFilterState();
  const classSel = containerEl.querySelector(`#${idPrefix}-class`);
  const nickSel = containerEl.querySelector(`#${idPrefix}-nickname`);
  const toolSel = containerEl.querySelector(`#${idPrefix}-tool`);
  const tagSel = containerEl.querySelector(`#${idPrefix}-tag`);
  const keywordInput = containerEl.querySelector(`#${idPrefix}-keyword`);
  const countEl = containerEl.querySelector(`#${idPrefix}-count`);

  let onChangeCb = () => {};
  let debounceTimer;

  classSel.addEventListener("change", () => { state.className = classSel.value; onChangeCb(); });
  nickSel.addEventListener("change", () => { state.nickname = nickSel.value; onChangeCb(); });
  toolSel.addEventListener("change", () => { state.aiTool = toolSel.value; onChangeCb(); });
  tagSel.addEventListener("change", () => { state.tag = tagSel.value; onChangeCb(); });
  keywordInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { state.keyword = keywordInput.value; onChangeCb(); }, 200);
  });

  return {
    state,
    countEl,
    onChange(cb) { onChangeCb = cb; },
    setTag(tag) { tagSel.value = tag; state.tag = tag; onChangeCb(); },
    /** 故事本沒有「使用的 AI 工具」這個概念，切到故事本分頁時把這個下拉藏起來 */
    setToolFilterVisible(visible) {
      toolSel.style.display = visible ? "" : "none";
      if (!visible && state.aiTool) { toolSel.value = ""; state.aiTool = ""; }
    },
    refreshOptions(artworks) {
      const classes = artworks.map((a) => a.ClassName);
      const nicknames = artworks.map((a) => a.DisplayName || a.Nickname || a.StudentName);
      const tools = artworks.map((a) => a.AITool);
      const tags = artworks.flatMap(parseArtTags);
      populateFilterSelect(classSel, classes, "全部班級", state.className);
      populateFilterSelect(nickSel, nicknames, "全部作者", state.nickname);
      populateFilterSelect(toolSel, tools, "全部 AI 工具", state.aiTool);
      populateFilterSelect(tagSel, tags, "全部標籤", state.tag);
    },
    matches(art) { return artworkMatchesFilter(art, state); },
  };
}
