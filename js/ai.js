document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("ai");
  renderFooterYear();

  const gateEl = document.getElementById("ai-gate");
  Auth.requireActive(gateEl, (user) => initAiPage(gateEl, user));
});

/* 三種畫面類型，各自有一組更貼切的引導欄位（A+B 組合：類型切換 + 全部選填 + 範例按鈕） */
const AI_TYPE_CONFIGS = {
  character: {
    label: "🧑‍🎨 角色故事",
    fields: [
      { key: "subject", label: "主體 / 動作", placeholder: "例如：在公園裡追蝴蝶",
        examples: ["在公園裡追蝴蝶", "坐在窗邊看書", "在雨中撐傘微笑", "跟朋友一起放風箏", "在廚房裡烤餅乾"] },
      { key: "setting", label: "場景", placeholder: "例如：櫻花盛開的公園，午後陽光",
        examples: ["櫻花盛開的公園", "熱鬧的夜市", "安靜的圖書館一角", "教室的窗邊", "遊樂園摩天輪旁"] },
      { key: "style", label: "風格", placeholder: "例如：水彩插畫風、色彩柔和",
        examples: ["水彩插畫風、色彩柔和", "日系動漫風", "黏土風、可愛立體", "兒童繪本插畫風", "像素風、復古遊戲感"] },
      { key: "mood", label: "光線 / 氛圍（選填）", placeholder: "例如：溫暖的黃昏光線",
        examples: ["溫暖的黃昏光線", "清晨的柔和光線", "夜晚燈籠的暖黃光", "陰天的柔和散射光"] },
    ],
  },
  scenery: {
    label: "🏞️ 場景風景",
    fields: [
      { key: "subject", label: "畫面主題", placeholder: "例如：夕陽下的海邊",
        examples: ["夕陽下的海邊", "雪山下的小木屋", "秋天的楓葉林", "雨後的城市街道", "銀河下的草原"] },
      { key: "setting", label: "場景細節", placeholder: "例如：礁石、海浪、遠方帆船",
        examples: ["礁石、海浪、遠方帆船", "石板路、老式路燈、磚牆", "梯田、水牛、遠山", "高樓、霓虹燈招牌、車流"] },
      { key: "style", label: "風格", placeholder: "例如：油畫風、寫實",
        examples: ["油畫風、寫實", "水彩風、清新", "吉卜力風格", "賽博龐克風、霓虹色調", "極簡插畫風"] },
      { key: "mood", label: "光線 / 氛圍（選填）", placeholder: "例如：金色夕陽",
        examples: ["金色夕陽", "藍紫色的黃昏", "薄霧繚繞的清晨", "星空下的深藍夜色"] },
    ],
  },
  free: {
    label: "✨ 自由創作",
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

function initAiPage(root, user) {
  root.innerHTML = `
    <div class="page-hero-row">
      <span class="page-hero-emoji" aria-hidden="true">🪄</span>
      <h1 class="hero-title" style="font-size:clamp(2rem,5vw,3rem);text-align:center;">AI 作圖</h1>
      <span class="page-hero-emoji" aria-hidden="true">🎨</span>
    </div>

    <div id="quota-banner" class="steps-note"></div>

    <div class="steps-note" style="margin-top:16px;">
      <h3>🧑‍🎨 我的角色設定（選填，畫風景就不用填）</h3>
      <div class="form-row">
        <textarea id="character-sheet-input" maxlength="800" rows="3" placeholder="例如：一隻橘色短毛貓，戴紅色圍巾，大大的圓眼睛，圓滾滾的身材"></textarea>
        <div class="form-hint">如果這次是要畫「同一個角色」的故事，這段描述會自動加在每次生成的 Prompt 最前面，幫助角色在不同頁面盡量長得一樣。純風景/場景可以留空。</div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-outline-dark" id="save-character-btn">💾 儲存角色設定</button>
        <span class="form-msg-inline" id="character-save-msg"></span>
      </div>
    </div>

    <form class="submit-form" id="ai-form" style="margin-top:20px;">
      <h3 style="font-family:var(--font-hand);">✏️ 這一頁的畫面內容</h3>
      <div class="btn-row" id="ai-type-tabs"></div>
      <div id="ai-type-fields" style="margin-top:12px;"></div>

      <div class="form-row">
        <label>參考圖（選填，讓這次生成盡量貼近某張圖的角色/風格長相）</label>
        <div class="btn-row" id="reference-mode-tabs">
          <button type="button" class="btn btn-outline-dark reference-mode-btn active" data-mode="none">不使用參考圖</button>
          <button type="button" class="btn btn-outline-dark reference-mode-btn" data-mode="pick">從我的作品選一張</button>
          <button type="button" class="btn btn-outline-dark reference-mode-btn" data-mode="upload">上傳新的參考圖</button>
        </div>
        <div id="reference-pick-row" style="display:none;margin-top:10px;">
          <div id="reference-picker"><p style="color:#8a7d68;">載入我的作品中...</p></div>
        </div>
        <div id="reference-upload-row" style="display:none;margin-top:10px;">
          <input type="file" id="reference-file-input" accept="image/*">
          <div class="form-hint">這張參考圖只會用在這一次生成，不會另外存成一件作品。</div>
          <img id="reference-upload-preview" class="image-preview" alt="參考圖預覽" style="display:none;">
        </div>
      </div>

      <div class="form-row">
        <label>組合出的完整 Prompt（送出前可以再手動微調）</label>
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
  let referenceMode = "none";
  let selectedReferenceId = "";
  let uploadedReference = null; // { base64, mimeType }
  let myArtworks = [];

  const quotaBanner = document.getElementById("quota-banner");
  const characterInput = document.getElementById("character-sheet-input");
  const saveCharacterBtn = document.getElementById("save-character-btn");
  const characterSaveMsg = document.getElementById("character-save-msg");
  const form = document.getElementById("ai-form");
  const typeTabsEl = document.getElementById("ai-type-tabs");
  const typeFieldsEl = document.getElementById("ai-type-fields");
  const previewInput = document.getElementById("final-prompt-preview");
  const referencePickRow = document.getElementById("reference-pick-row");
  const referenceUploadRow = document.getElementById("reference-upload-row");
  const referencePicker = document.getElementById("reference-picker");
  const referenceFileInput = document.getElementById("reference-file-input");
  const referenceUploadPreview = document.getElementById("reference-upload-preview");
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
      renderTypeFields();
      composePrompt();
    });
  });

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

  function composePrompt() {
    const parts = [];
    if (characterInput.value.trim()) parts.push(characterInput.value.trim());

    const config = AI_TYPE_CONFIGS[currentType];
    if (config.freeform) {
      if (freeformValue.trim()) parts.push(freeformValue.trim());
    } else {
      const values = fieldValues[currentType] || {};
      config.fields.forEach((f) => {
        const v = (values[f.key] || "").trim();
        if (!v) return;
        if (f.key === "setting") parts.push("場景：" + v);
        else if (f.key === "style") parts.push("風格：" + v);
        else parts.push(v);
      });
    }
    previewInput.value = parts.join("，");
  }
  characterInput.addEventListener("input", composePrompt);
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

  /* ---------------- 參考圖：不使用 / 從我的作品選 / 上傳新的 ---------------- */
  document.querySelectorAll(".reference-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      referenceMode = btn.dataset.mode;
      document.querySelectorAll(".reference-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
      referencePickRow.style.display = referenceMode === "pick" ? "block" : "none";
      referenceUploadRow.style.display = referenceMode === "upload" ? "block" : "none";
    });
  });

  referenceFileInput.addEventListener("change", async () => {
    uploadedReference = null;
    referenceUploadPreview.style.display = "none";
    const file = referenceFileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("請選擇圖片檔案"); referenceFileInput.value = ""; return; }
    try {
      uploadedReference = await compressImageFile(file, 1200, 0.85);
      referenceUploadPreview.src = "data:" + uploadedReference.mimeType + ";base64," + uploadedReference.base64;
      referenceUploadPreview.style.display = "block";
    } catch (err) {
      alert("圖片處理失敗：" + err.message);
      referenceFileInput.value = "";
    }
  });

  function renderReferencePicker() {
    const withImages = myArtworks.filter((a) => a.isMine);
    if (!withImages.length) {
      referencePicker.innerHTML = `<p style="color:#8a7d68;">你還沒有作品可以當參考圖，先產生或投稿一張之後就可以選了。</p>`;
      return;
    }
    referencePicker.innerHTML = `
      <div class="my-story-pool">
        ${withImages
          .map(
            (a) => `
          <div class="my-story-pool-item reference-option ${selectedReferenceId === a.ID ? "selected" : ""}" data-ref-id="${escapeHtml(a.ID)}">
            <img alt="${escapeHtml(a.DisplayName)}" loading="lazy">
            <div class="pool-item-name">${escapeHtml(a.DisplayName)}</div>
          </div>
        `
          )
          .join("")}
      </div>
    `;
    referencePicker.querySelectorAll(".reference-option").forEach((el) => {
      const art = withImages.find((a) => a.ID === el.dataset.refId);
      if (art) Api.setImageSrc(el.querySelector("img"), art);
      el.addEventListener("click", () => {
        selectedReferenceId = el.dataset.refId;
        referencePicker.querySelectorAll(".reference-option").forEach((o) => o.classList.toggle("selected", o === el));
      });
    });
  }

  async function loadMyArtworksForReference() {
    try {
      const res = await Api.listMine();
      myArtworks = res.artworks || [];
      renderReferencePicker();
    } catch (err) {
      referencePicker.innerHTML = `<p style="color:#a8402f;">載入失敗：${escapeHtml(err.message)}</p>`;
    }
  }

  function renderQuota(quota) {
    const used = quota.usedCount;
    const limit = quota.quotaLimit;
    const pct = limit > 0 ? used / limit : 0;
    const nextReset = new Date(quota.nextResetIso).toLocaleString("zh-TW");
    let warning = "";
    if (limit > 0 && pct >= 0.7 && used < limit) {
      warning = `<p style="color:#a8402f;font-weight:600;margin-top:8px;">你已使用超過今日額度的 70%。請好好打字，系統性、有條理地告訴 AI 你的想法，先想清楚再產生圖片喔！</p>`;
    }
    quotaBanner.innerHTML = `
      <h3>📊 今日額度</h3>
      <p>今日已用 <b>${used} / ${limit}</b> 次，下次重置時間：${escapeHtml(nextReset)}</p>
      ${warning}
    `;
    generateBtn.disabled = limit > 0 && used >= limit;
    generateBtn.textContent = generateBtn.disabled ? "今日額度已用完" : "✨ 產生圖片";
  }

  async function loadQuota() {
    try {
      const res = await Api.aiQuota();
      renderQuota(res.quota);
    } catch (err) {
      quotaBanner.innerHTML = `<p style="color:#a8402f;">額度載入失敗：${escapeHtml(err.message)}</p>`;
    }
  }

  function showMsg(type, text) {
    msgEl.className = "form-msg show " + type;
    msgEl.textContent = text;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (generating) return;

    const finalPrompt = previewInput.value.trim();
    if (!finalPrompt) {
      showMsg("error", "Prompt 是空的，請至少填寫一項畫面內容。");
      return;
    }
    if (referenceMode === "upload" && !uploadedReference) {
      showMsg("error", "請選擇要上傳的參考圖片，或改選其他參考圖模式。");
      return;
    }

    generating = true;
    generateBtn.disabled = true;
    generateBtn.textContent = "產生中，請稍候（約 10~30 秒）...";
    showMsg("pending", "AI 正在畫畫，請稍候...");
    resultEl.innerHTML = "";

    try {
      const options = {};
      if (referenceMode === "upload" && uploadedReference) {
        options.referenceImageBase64 = uploadedReference.base64;
        options.referenceImageMimeType = uploadedReference.mimeType;
      } else if (referenceMode === "pick" && selectedReferenceId) {
        options.referenceArtworkId = selectedReferenceId;
      }

      const res = await Api.aiGenerate(finalPrompt, options);
      showMsg("success", "🎉 圖片產生成功！已存為「私人」作品，可以到「我要投稿」頁面調整公開狀態。（提醒：私人的 AI 產圖如果一直沒有調整公開範圍，超過一段時間可能會被系統清理，記得要保留的話請到「我要投稿」設為公開或僅畫廊）");
      const art = res.artwork;
      resultEl.innerHTML = `
        <div class="note-card" style="max-width:340px;margin:0 auto;">
          <div class="note-thumb-wrap"><img alt="AI 產生的圖片"></div>
          <div class="note-footer-row" style="justify-content:center;">🔒 私人（只有你看得到）</div>
        </div>
      `;
      Api.setImageSrc(resultEl.querySelector("img"), art);
      renderQuota(res.quota);
      fieldValues[currentType] = {};
      freeformValue = "";
      renderTypeFields();
      composePrompt();
      loadMyArtworksForReference(); // 讓剛產生的這張也能被之後選為參考圖
    } catch (err) {
      showMsg("error", "產生失敗：" + err.message);
      loadQuota();
    } finally {
      generating = false;
      generateBtn.disabled = false;
      loadQuota();
    }
  });

  loadQuota();
  loadMyArtworksForReference();
}
