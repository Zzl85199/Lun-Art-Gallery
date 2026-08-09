document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("ai");
  renderFooterYear();

  const gateEl = document.getElementById("ai-gate");
  Auth.requireActive(gateEl, (user) => initAiPage(gateEl, user));
});

/* ===================================================================
   三種畫面類型
   - character（角色）：會顯示「描述一下角色吧！」，欄位為 動作 / 在哪 / 風格 / 光線氛圍
   - scenery（場景）：不需要角色設定，純粹描述畫面
   - free（自由創作）：一個大框自己寫
   每個欄位的 promptLabel 就是最後組進 Prompt 時前面的標籤，
   想改 Prompt 的寫法只要改這裡即可，不必動下面的程式。
   =================================================================== */
const AI_TYPE_CONFIGS = {
  character: {
    label: "🧑‍🎨 角色",
    needsCharacter: true,
    fields: [
      {
        key: "action", label: "動作", promptLabel: "動作", placeholder: "例如：在公園裡追蝴蝶",
        examples: ["在公園裡追蝴蝶", "坐在窗邊看書", "在雨中撐傘微笑", "跟朋友一起放風箏", "在廚房裡烤餅乾", "騎著腳踏車往前衝", "抱著一本很大的書打瞌睡"],
      },
      {
        key: "where", label: "在哪", promptLabel: "場景", placeholder: "例如：櫻花盛開的公園，午後陽光",
        examples: ["櫻花盛開的公園", "熱鬧的夜市", "安靜的圖書館一角", "教室的窗邊", "遊樂園摩天輪旁", "海邊的木棧道", "下著小雨的老街"],
      },
      {
        key: "style", label: "風格", promptLabel: "風格", placeholder: "例如：水彩插畫風、色彩柔和",
        examples: ["水彩插畫風、色彩柔和", "日系動漫風", "黏土風、可愛立體", "兒童繪本插畫風", "像素風、復古遊戲感", "蠟筆塗鴉風"],
      },
      {
        key: "mood", label: "光線 / 氛圍（選填）", promptLabel: "光線／氛圍", placeholder: "例如：溫暖的黃昏光線",
        examples: ["溫暖的黃昏光線", "清晨的柔和光線", "夜晚燈籠的暖黃光", "陰天的柔和散射光", "窗邊灑進來的斜射陽光"],
      },
    ],
  },
  scenery: {
    label: "🏞️ 場景",
    needsCharacter: false,
    fields: [
      {
        key: "subject", label: "畫面主題", promptLabel: "", placeholder: "例如：夕陽下的海邊",
        examples: ["夕陽下的海邊", "雪山下的小木屋", "秋天的楓葉林", "雨後的城市街道", "銀河下的草原", "清晨的稻田"],
      },
      {
        key: "setting", label: "場景細節", promptLabel: "場景", placeholder: "例如：礁石、海浪、遠方帆船",
        examples: ["礁石、海浪、遠方帆船", "石板路、老式路燈、磚牆", "梯田、水牛、遠山", "高樓、霓虹燈招牌、車流", "木橋、溪流、落葉"],
      },
      {
        key: "style", label: "風格", promptLabel: "風格", placeholder: "例如：油畫風、寫實",
        examples: ["油畫風、寫實", "水彩風、清新", "吉卜力風格", "賽博龐克風、霓虹色調", "極簡插畫風"],
      },
      {
        key: "mood", label: "光線 / 氛圍（選填）", promptLabel: "光線／氛圍", placeholder: "例如：金色夕陽",
        examples: ["金色夕陽", "藍紫色的黃昏", "薄霧繚繞的清晨", "星空下的深藍夜色"],
      },
    ],
  },
  free: {
    label: "✨ 自由創作",
    needsCharacter: false,
    freeform: true,
    hints: [
      "主體：畫面裡的重點是什麼？",
      "場景：背景／環境長什麼樣子？",
      "風格：什麼畫風？水彩、像素、3D...",
      "光線／氛圍：白天/夜晚、溫暖/冷冽？",
      "構圖：特寫、全景、俯視...？",
    ],
  },
};

/* 歷史 Prompt（存在這台裝置的瀏覽器，依帳號分開存） */
const PROMPT_HISTORY_MAX = 20;

function promptHistoryKey(user) {
  return "ai_prompt_history_v1_" + (user && user.userId ? user.userId : "guest");
}

function loadPromptHistory(user) {
  try {
    const raw = localStorage.getItem(promptHistoryKey(user));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.trim()) : [];
  } catch (e) {
    return [];
  }
}

function savePromptToHistory(user, prompt) {
  const text = String(prompt || "").trim();
  if (!text) return loadPromptHistory(user);
  const list = loadPromptHistory(user).filter((p) => p !== text);
  list.unshift(text);
  const trimmed = list.slice(0, PROMPT_HISTORY_MAX);
  try {
    localStorage.setItem(promptHistoryKey(user), JSON.stringify(trimmed));
  } catch (e) {
    /* localStorage 滿了或無痕模式限制時就放棄記錄，不影響產圖 */
  }
  return trimmed;
}

/** 把重置時間顯示成「2026/8/7 23:59:59」這種格式（固定顯示到秒） */
function formatResetTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:59`;
}

function initAiPage(root, user) {
  root.innerHTML = `
    <div class="page-hero-row">
      <span class="page-hero-emoji" aria-hidden="true">🪄</span>
      <h1 class="hero-title" style="font-size:clamp(2rem,5vw,3rem);text-align:center;">AI 作圖</h1>
      <span class="page-hero-emoji" aria-hidden="true">🎨</span>
    </div>

    <div id="quota-banner" class="steps-note"></div>

    <form class="submit-form" id="ai-form" style="margin-top:20px;">
      <h3 style="font-family:var(--font-hand);">✏️ 這一頁的畫面內容</h3>
      <div class="btn-row" id="ai-type-tabs"></div>

      <div class="steps-note" id="character-block" style="margin-top:16px;">
        <h3>🧑‍🎨 描述一下角色吧！</h3>
        <div class="form-row">
          <textarea id="character-sheet-input" maxlength="800" rows="3" placeholder="例如：一隻橘色短毛貓，戴紅色圍巾，大大的圓眼睛，圓滾滾的身材"></textarea>
          <div class="form-hint">這段描述會自動加在每次生成的 Prompt 最前面，幫助同一個角色在不同頁面盡量長得一樣。按下儲存後，下次進來還會在。</div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-outline-dark" id="save-character-btn">💾 儲存角色設定</button>
          <span class="form-msg-inline" id="character-save-msg"></span>
        </div>
      </div>

      <div id="ai-type-fields" style="margin-top:12px;"></div>

      <div class="form-row">
        <label for="reference-file-input">參考圖（選填，讓這次生成盡量貼近某張圖的角色/風格長相）</label>
        <input type="file" id="reference-file-input" accept="image/*">
        <div class="form-hint">沒有選擇檔案就是不使用參考圖。這張參考圖只會用在這一次生成，不會另外存成一件作品。</div>
        <img id="reference-upload-preview" class="image-preview" alt="參考圖預覽" style="display:none;">
        <button type="button" class="btn btn-outline-dark" id="reference-clear-btn" style="display:none;margin-top:8px;align-self:flex-start;">✕ 不使用這張參考圖</button>
      </div>

      <div class="form-row">
        <label for="final-prompt-preview">組合出的完整 Prompt（送出前可以再手動微調）</label>
        <div class="prompt-history-row" id="prompt-history-row" style="display:none;">
          <select id="prompt-history-select" aria-label="用過的 Prompt">
            <option value="">📜 用過的 Prompt（選一個直接填入）</option>
          </select>
          <button type="button" class="btn btn-outline-dark" id="prompt-history-clear-btn">清空紀錄</button>
        </div>
        <textarea id="final-prompt-preview" rows="3"></textarea>
      </div>

      <button type="submit" class="btn btn-pin" id="ai-generate-btn" style="width:100%;">✨ 產生圖片</button>
      <div class="form-msg" id="ai-msg"></div>
    </form>

    <div id="ai-result" style="margin-top:24px;"></div>
  `;

  let generating = false;
  let currentType = "character";
  let fieldValues = {}; // { [typeKey]: { [fieldKey]: value } }
  let freeformValue = "";
  let uploadedReference = null; // { base64, mimeType }
  let latestQuota = null; // 最近一次從後端拿到的額度快照
  let myArtworkCount = null; // 這個帳號目前有幾件作品（達上限就不給產圖）

  const quotaBanner = document.getElementById("quota-banner");
  const characterBlock = document.getElementById("character-block");
  const characterInput = document.getElementById("character-sheet-input");
  const saveCharacterBtn = document.getElementById("save-character-btn");
  const characterSaveMsg = document.getElementById("character-save-msg");
  const form = document.getElementById("ai-form");
  const typeTabsEl = document.getElementById("ai-type-tabs");
  const typeFieldsEl = document.getElementById("ai-type-fields");
  const previewInput = document.getElementById("final-prompt-preview");
  const historyRow = document.getElementById("prompt-history-row");
  const historySelect = document.getElementById("prompt-history-select");
  const historyClearBtn = document.getElementById("prompt-history-clear-btn");
  const referenceFileInput = document.getElementById("reference-file-input");
  const referenceUploadPreview = document.getElementById("reference-upload-preview");
  const referenceClearBtn = document.getElementById("reference-clear-btn");
  const generateBtn = document.getElementById("ai-generate-btn");
  const msgEl = document.getElementById("ai-msg");
  const resultEl = document.getElementById("ai-result");

  characterInput.value = user.characterSheet || "";

  /* ---------------- 畫面類型分頁 ---------------- */
  typeTabsEl.innerHTML = Object.keys(AI_TYPE_CONFIGS)
    .map((key) => `<button type="button" class="btn btn-outline-dark ai-type-btn ${key === currentType ? "active" : ""}" data-type="${key}">${AI_TYPE_CONFIGS[key].label}</button>`)
    .join("");
  typeTabsEl.querySelectorAll(".ai-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentType = btn.dataset.type;
      typeTabsEl.querySelectorAll(".ai-type-btn").forEach((b) => b.classList.toggle("active", b === btn));
      syncCharacterBlock();
      renderTypeFields();
      composePrompt();
    });
  });

  /** 只有「角色」模式才顯示角色設定區塊 */
  function syncCharacterBlock() {
    characterBlock.style.display = AI_TYPE_CONFIGS[currentType].needsCharacter ? "" : "none";
  }

  function renderTypeFields() {
    const config = AI_TYPE_CONFIGS[currentType];
    if (!fieldValues[currentType]) fieldValues[currentType] = {};

    if (config.freeform) {
      typeFieldsEl.innerHTML = `
        <div class="form-row">
          <textarea id="freeform-input" rows="4" placeholder="直接描述你想要的畫面，越具體越好...">${escapeHtml(freeformValue)}</textarea>
        </div>
        <div class="steps-note" style="margin-top:0;">
          <b>可以想想這些：</b>
          <ul style="margin:8px 0 0 20px;padding:0;">
            ${config.hints.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}
          </ul>
        </div>
      `;
      document.getElementById("freeform-input").addEventListener("input", (e) => {
        freeformValue = e.target.value;
        composePrompt();
      });
      return;
    }

    typeFieldsEl.innerHTML = config.fields
      .map(
        (f) => `
      <div class="form-row">
        <label for="field-${f.key}">${escapeHtml(f.label)}</label>
        <div class="btn-row" style="align-items:flex-start;">
          <input type="text" id="field-${f.key}" maxlength="200" placeholder="${escapeHtml(f.placeholder)}" style="flex:1;" value="${escapeHtml(fieldValues[currentType][f.key] || "")}">
          <button type="button" class="btn btn-outline-dark example-btn" data-key="${f.key}" title="給我一個範例">🎲 範例</button>
        </div>
      </div>
    `
      )
      .join("");

    config.fields.forEach((f) => {
      const input = document.getElementById("field-" + f.key);
      input.addEventListener("input", () => {
        fieldValues[currentType][f.key] = input.value;
        composePrompt();
      });
    });
    typeFieldsEl.querySelectorAll(".example-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const field = config.fields.find((f) => f.key === btn.dataset.key);
        const example = field.examples[Math.floor(Math.random() * field.examples.length)];
        const input = document.getElementById("field-" + field.key);
        input.value = example;
        fieldValues[currentType][field.key] = example;
        composePrompt();
      });
    });
  }

  /** 依目前類型把各欄位組成完整 Prompt（角色設定只在「角色」模式加進去） */
  function composePrompt() {
    const parts = [];
    const config = AI_TYPE_CONFIGS[currentType];

    if (config.needsCharacter && characterInput.value.trim()) {
      parts.push(characterInput.value.trim());
    }

    if (config.freeform) {
      if (freeformValue.trim()) parts.push(freeformValue.trim());
    } else {
      const values = fieldValues[currentType] || {};
      config.fields.forEach((f) => {
        const v = (values[f.key] || "").trim();
        if (!v) return;
        parts.push(f.promptLabel ? f.promptLabel + "：" + v : v);
      });
    }
    previewInput.value = parts.join("，");
  }
  characterInput.addEventListener("input", composePrompt);
  syncCharacterBlock();
  renderTypeFields();
  composePrompt();

  saveCharacterBtn.addEventListener("click", async () => {
    saveCharacterBtn.disabled = true;
    characterSaveMsg.textContent = "儲存中...";
    try {
      const res = await Api.authUpdateCharacterSheet(characterInput.value.trim());
      Auth.currentUser = res.user;
      characterSaveMsg.textContent = "✅ 已儲存";
    } catch (err) {
      characterSaveMsg.textContent = "❌ " + err.message;
    } finally {
      saveCharacterBtn.disabled = false;
    }
  });

  /* ---------------- 歷史 Prompt 下拉選單 ---------------- */
  function renderPromptHistory() {
    const list = loadPromptHistory(user);
    if (!list.length) {
      historyRow.style.display = "none";
      return;
    }
    historyRow.style.display = "flex";
    historySelect.innerHTML =
      `<option value="">📜 用過的 Prompt（選一個直接填入）</option>` +
      list
        .map((p, i) => {
          const short = p.length > 46 ? p.slice(0, 46) + "…" : p;
          return `<option value="${i}">${escapeHtml(short)}</option>`;
        })
        .join("");
    historySelect.value = "";
  }

  historySelect.addEventListener("change", () => {
    const idx = Number(historySelect.value);
    if (historySelect.value === "" || !isFinite(idx)) return;
    const list = loadPromptHistory(user);
    if (!list[idx]) return;
    previewInput.value = list[idx];
    previewInput.focus();
    historySelect.value = "";
  });

  historyClearBtn.addEventListener("click", () => {
    if (!confirm("要清空這台裝置上記錄的 Prompt 嗎？（不會影響已經產生的作品）")) return;
    try { localStorage.removeItem(promptHistoryKey(user)); } catch (e) { /* 忽略 */ }
    renderPromptHistory();
  });

  renderPromptHistory();

  /* ---------------- 參考圖：只保留上傳，沒上傳就是不使用 ---------------- */
  function clearReference() {
    uploadedReference = null;
    referenceFileInput.value = "";
    referenceUploadPreview.style.display = "none";
    referenceUploadPreview.removeAttribute("src");
    referenceClearBtn.style.display = "none";
  }

  referenceClearBtn.addEventListener("click", clearReference);

  referenceFileInput.addEventListener("change", async () => {
    uploadedReference = null;
    referenceUploadPreview.style.display = "none";
    referenceClearBtn.style.display = "none";
    const file = referenceFileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("請選擇圖片檔案"); referenceFileInput.value = ""; return; }
    try {
      uploadedReference = await compressImageFile(file, 1200, 0.85);
      referenceUploadPreview.src = "data:" + uploadedReference.mimeType + ";base64," + uploadedReference.base64;
      referenceUploadPreview.style.display = "block";
      referenceClearBtn.style.display = "inline-block";
    } catch (err) {
      alert("圖片處理失敗：" + err.message);
      clearReference();
    }
  });

  /* ---------------- 額度 ---------------- */
  function remainingCount() {
    if (!latestQuota) return null;
    const limit = Number(latestQuota.quotaLimit);
    if (!isFinite(limit) || limit <= 0) return null; // 0 或無效值代表不限制
    return Math.max(0, limit - Number(latestQuota.usedCount || 0));
  }

  /** 產生按鈕的文字與可否點擊：括號裡永遠顯示還剩幾次 */
  function syncGenerateBtn() {
    if (generating) return;
    const left = remainingCount();
    if (left === null) {
      generateBtn.disabled = false;
      generateBtn.textContent = "✨ 產生圖片";
      return;
    }
    if (left <= 0) {
      generateBtn.disabled = true;
      generateBtn.textContent = "今日額度已用完（剩下 0 次）";
      return;
    }
    generateBtn.disabled = false;
    generateBtn.textContent = `✨ 產生圖片（剩下 ${left} 次）`;
  }

  function renderQuota(quota) {
    latestQuota = quota;
    const used = Number(quota.usedCount || 0);
    const limit = Number(quota.quotaLimit);
    const pct = limit > 0 ? used / limit : 0;
    const nextReset = formatResetTime(quota.nextResetIso);
    let warning = "";
    if (limit > 0 && pct >= 0.7 && used < limit) {
      warning = `<p style="color:#a8402f;font-weight:600;margin-top:8px;">你已使用超過今日額度的 70%。請好好打字，系統性、有條理地告訴 AI 你的想法，先想清楚再產生圖片喔！</p>`;
    }
    let countInfo = "";
    if (myArtworkCount !== null) {
      const nearLimit = myArtworkCount >= CONFIG.WARN_ARTWORKS_AT;
      countInfo = `<p style="margin-top:6px;">目前圖片作品數：<b${nearLimit ? ' style="color:#a8402f;"' : ""}>${myArtworkCount} / ${CONFIG.MAX_ARTWORKS_PER_USER}</b> 張</p>`;
      if (nearLimit && myArtworkCount < CONFIG.MAX_ARTWORKS_PER_USER) {
        countInfo += `<p style="color:#a8402f;font-weight:600;margin-top:4px;">⚠️ 作品數快到上限了，建議先到「我的頁面」刪掉一些不需要的作品。</p>`;
      }
    }
    quotaBanner.innerHTML = `
      <h3>📊 今日額度</h3>
      <p>今日已用 <b>${used} / ${limit}</b> 次，下次重置時間：${escapeHtml(nextReset)}</p>
      ${countInfo}
      ${warning}
    `;
    syncGenerateBtn();
  }

  async function loadQuota() {
    try {
      const res = await Api.aiQuota();
      renderQuota(res.quota);
    } catch (err) {
      quotaBanner.innerHTML = `<p style="color:#a8402f;">額度載入失敗：${escapeHtml(err.message)}</p>`;
    }
  }

  /** 讀取這個帳號目前的作品數量（產圖前的張數上限檢查用） */
  async function loadMyArtworkCount() {
    try {
      const res = await Api.listMine();
      // 只算圖片作品，上傳的故事本 PDF 有自己獨立的上限
      myArtworkCount = (res.artworks || []).filter((a) => a.Kind !== "book").length;
      if (latestQuota) renderQuota(latestQuota);
      return myArtworkCount;
    } catch (err) {
      myArtworkCount = null;
      return null;
    }
  }

  function showMsg(type, text) {
    msgEl.className = "form-msg show " + type;
    msgEl.textContent = text;
  }

  /* ---------------- 共用的產圖流程 ---------------- */
  /**
   * 主表單的「產生圖片」與結果視窗的「微調後再產生一次」都走這一條，
   * 確保兩邊的作品數上限檢查、額度更新、Prompt 紀錄行為完全一致。
   * 回傳後端的回應；檢查沒過或後端出錯都會 throw。
   */
  async function generateImage(prompt, options) {
    // 產圖前先確認作品數：達到上限就不送出，請使用者先去「我的頁面」刪掉一些
    const count = await loadMyArtworkCount();
    if (count !== null && count >= CONFIG.MAX_ARTWORKS_PER_USER) {
      const err = new Error(`你目前已經有 ${count} 張圖片作品（上限 ${CONFIG.MAX_ARTWORKS_PER_USER} 張），請先到「我的頁面」刪除一些作品再來產圖吧！`);
      err.isArtworkLimit = true;
      throw err;
    }

    const res = await Api.aiGenerate(prompt, options || {});

    // 記住這次的 Prompt，之後可以從下拉選單直接選回來
    savePromptToHistory(user, prompt);
    renderPromptHistory();

    if (myArtworkCount !== null) myArtworkCount += 1;
    renderQuota(res.quota);
    return res;
  }

  /** 頁面上那張小小的結果卡片 */
  function renderResultCard(art) {
    resultEl.innerHTML = `
      <div class="note-card" style="max-width:340px;margin:0 auto;">
        <div class="note-thumb-wrap"><img alt="AI 產生的圖片"></div>
        <div class="note-footer-row" style="justify-content:center;">🔒 私人（只有你看得到）</div>
      </div>
    `;
    Api.setImageSrc(resultEl.querySelector("img"), art);
  }

  /* ---------------- 送出產圖 ---------------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (generating) return;

    const finalPrompt = previewInput.value.trim();
    if (!finalPrompt) {
      showMsg("error", "Prompt 是空的，請至少填寫一項畫面內容。");
      return;
    }

    generating = true;
    generateBtn.disabled = true;
    generateBtn.textContent = "檢查作品數量中...";
    showMsg("pending", "AI 正在畫畫，請稍候...");
    resultEl.innerHTML = "";

    try {
      const options = {};
      if (uploadedReference) {
        options.referenceImageBase64 = uploadedReference.base64;
        options.referenceImageMimeType = uploadedReference.mimeType;
      }

      generateBtn.textContent = "產生中，請稍候（約 10~30 秒）...";
      const res = await generateImage(finalPrompt, options);

      showMsg("success", "🎉 圖片產生成功！已存為「私人」作品，可以到「我的頁面」調整公開狀態。（提醒：私人的 AI 產圖如果一直沒有調整公開範圍，超過一段時間可能會被系統清理，記得要保留的話請到「我的頁面」設為公開或僅畫廊）");

      renderResultCard(res.artwork);
      // 從主表單產生的是「全新的一張」，微調次數重新計算
      openResultModal(res.artwork, finalPrompt, { resetTweaks: true });

      fieldValues[currentType] = {};
      freeformValue = "";
      renderTypeFields();
      composePrompt();
      clearReference();
    } catch (err) {
      if (err.isArtworkLimit) alert("請先刪除一些作品再來產圖吧！");
      showMsg("error", err.isArtworkLimit ? err.message : "產生失敗：" + err.message);
    } finally {
      generating = false;
      syncGenerateBtn();
      loadQuota();
    }
  });

  /* ===================================================================
     產生結果視窗：圖片 + 下載 PNG + 可修改 Prompt 再產生一次（微調）
     =================================================================== */
  const modal = ensureAiResultModal();
  const mImg = modal.querySelector("#ai-result-img");
  const mPrompt = modal.querySelector("#ai-result-prompt");
  const mDownloadBtn = modal.querySelector("#ai-result-download-btn");
  const mCopyBtn = modal.querySelector("#ai-result-copy-btn");
  const mTweakBtn = modal.querySelector("#ai-result-tweak-btn");
  const mUseRefInput = modal.querySelector("#ai-result-use-reference");
  const mMsg = modal.querySelector("#ai-result-msg");
  const mTweakNote = modal.querySelector("#ai-result-tweak-note");

  // 這個視窗目前顯示的那一張圖的狀態
  let modalArt = null;
  let modalDataUrl = "";
  let tweaksLeft = 0;
  let tweaking = false;

  function modalMsg(type, text) {
    mMsg.className = type ? "form-msg show " + type : "form-msg";
    mMsg.textContent = text || "";
  }

  /** 微調按鈕的文字／可否點擊：同時受「微調次數」與「今日總額度」限制 */
  function syncTweakBtn() {
    if (tweaking) return;
    const dailyLeft = remainingCount();

    if (tweaksLeft <= 0) {
      mTweakBtn.disabled = true;
      mTweakBtn.textContent = "微調次數已用完";
      mTweakNote.textContent = `這張圖的微調次數已經用完了（上限 ${CONFIG.MAX_TWEAKS_PER_IMAGE} 次）。想繼續調整，請關掉這個視窗，回到上面重新產生一張。`;
      return;
    }
    if (dailyLeft !== null && dailyLeft <= 0) {
      mTweakBtn.disabled = true;
      mTweakBtn.textContent = "今日額度已用完";
      mTweakNote.textContent = "今天的 AI 作圖額度已經用完了，明天再來吧！";
      return;
    }
    mTweakBtn.disabled = false;
    mTweakBtn.textContent = `🪄 微調後再產生一次（剩 ${tweaksLeft} 次）`;
    mTweakNote.textContent = `改完上面的 Prompt 再按這個按鈕，就會依照新的描述重畫一張。每按一次也會扣掉今日總額度 1 次${
      dailyLeft === null ? "" : `（今日還剩 ${dailyLeft} 次）`
    }。`;
  }

  /** 把視窗內容換成指定的那一張圖 */
  async function showInModal(art, prompt) {
    modalArt = art;
    modalDataUrl = "";
    mPrompt.value = prompt || "";
    mImg.removeAttribute("src");
    mImg.classList.add("img-loading");

    try {
      modalDataUrl = art.ImageURL || (await Api.fetchPrivateImageDataUrl(art.ID));
      mImg.src = modalDataUrl;
    } catch (err) {
      modalMsg("error", "圖片載入失敗：" + err.message);
    } finally {
      mImg.classList.remove("img-loading");
    }
  }

  async function openResultModal(art, prompt, opts) {
    if (opts && opts.resetTweaks) tweaksLeft = CONFIG.MAX_TWEAKS_PER_IMAGE;
    modalMsg("", "");
    modal.classList.add("open");
    syncTweakBtn();
    await showInModal(art, prompt);
  }

  mTweakBtn.addEventListener("click", async () => {
    if (tweaking || generating) return;

    const newPrompt = mPrompt.value.trim();
    if (!newPrompt) {
      modalMsg("error", "Prompt 不能是空的，請先寫一點描述再產生。");
      return;
    }
    if (tweaksLeft <= 0) return;

    tweaking = true;
    generating = true; // 微調期間，主表單的產生按鈕也要一起鎖住
    generateBtn.disabled = true;
    mTweakBtn.disabled = true;
    mTweakBtn.textContent = "重新產生中，請稍候（約 10~30 秒）...";
    modalMsg("pending", "AI 正在依照新的 Prompt 重畫，請稍候...");

    try {
      const options = {};
      // 以目前這張圖當參考圖，讓微調後的結果盡量維持同樣的角色與風格
      if (mUseRefInput.checked && modalArt && modalArt.ID) {
        options.referenceArtworkId = modalArt.ID;
      }

      const res = await generateImage(newPrompt, options);

      tweaksLeft--;
      await showInModal(res.artwork, newPrompt);
      renderResultCard(res.artwork);
      modalMsg("success", `🎉 重新產生完成！${tweaksLeft > 0 ? `這張圖還可以再微調 ${tweaksLeft} 次。` : "微調次數已經用完了。"}`);
      showMsg("success", "🎉 微調完成！新的圖一樣已存成你的「私人」作品。");
    } catch (err) {
      if (err.isArtworkLimit) alert("請先刪除一些作品再來產圖吧！");
      modalMsg("error", err.isArtworkLimit ? err.message : "產生失敗：" + err.message);
    } finally {
      tweaking = false;
      generating = false;
      syncTweakBtn();
      syncGenerateBtn();
      loadQuota();
    }
  });

  mDownloadBtn.addEventListener("click", async () => {
    mDownloadBtn.disabled = true;
    const original = mDownloadBtn.textContent;
    mDownloadBtn.textContent = "準備下載中...";
    try {
      if (!modalDataUrl) modalDataUrl = await Api.fetchPrivateImageDataUrl(modalArt.ID);
      const stamp = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const name = `AI作品_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.png`;
      await downloadDataUrlAsPng(modalDataUrl, name);
      modalMsg("success", "✅ 已下載：" + name);
    } catch (err) {
      modalMsg("error", "下載失敗：" + err.message);
    } finally {
      mDownloadBtn.disabled = false;
      mDownloadBtn.textContent = original;
    }
  });

  mCopyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mPrompt.value);
      modalMsg("success", "✅ Prompt 已複製");
    } catch (err) {
      // 沒有剪貼簿權限（例如非 https）時退回選取全部，讓使用者自己按 Ctrl+C
      mPrompt.select();
      modalMsg("pending", "已幫你選取，請按 Ctrl+C（Mac 是 ⌘+C）複製。");
    }
  });

  loadQuota();
  loadMyArtworkCount();
}

/* ===================================================================
   產生結果視窗：圖片 + 下載 PNG + 這次使用的完整 Prompt
   =================================================================== */
function ensureAiResultModal() {
  let overlay = document.getElementById("ai-result-modal");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "ai-result-modal";
  overlay.className = "modal-overlay ai-result-modal";
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="ai-result-title">
      <button class="modal-close" aria-label="關閉">✕</button>
      <h2 class="modal-title" id="ai-result-title" style="margin-bottom:14px;">🎨 你的圖完成了！</h2>

      <div class="ai-result-img-frame">
        <img id="ai-result-img" alt="AI 產生的圖片">
      </div>

      <div class="btn-row" style="margin-top:14px;justify-content:center;">
        <button type="button" class="btn btn-pin" id="ai-result-download-btn">⬇️ 下載 PNG</button>
        <button type="button" class="btn btn-outline-dark" id="ai-result-copy-btn">📋 複製 Prompt</button>
      </div>
      <div class="form-msg" id="ai-result-msg"></div>

      <div class="ai-tweak-block">
        <h3>🪄 想再調整看看？</h3>
        <div class="form-row">
          <label for="ai-result-prompt">這次使用的完整 Prompt（可以直接修改，再產生一次）</label>
          <textarea class="ai-result-prompt" id="ai-result-prompt" rows="5"></textarea>
        </div>

        <label class="ai-tweak-checkbox">
          <input type="checkbox" id="ai-result-use-reference" checked>
          <span>以現在這張圖為基礎（角色和風格會盡量保持一樣，只改你寫的地方）</span>
        </label>

        <button type="button" class="btn btn-pin" id="ai-result-tweak-btn" style="width:100%;margin-top:12px;">🪄 微調後再產生一次</button>
        <div class="form-hint" id="ai-result-tweak-note" style="margin-top:8px;"></div>
      </div>

      <p style="color:#6b5f4c;font-size:0.88rem;margin:14px 0 0;">
        每一張圖都會自動存成你的「私人」作品，可以到「我的頁面」調整公開範圍。
      </p>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.classList.remove("open");
  overlay.querySelector(".modal-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) close();
  });

  return overlay;
}
