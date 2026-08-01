document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("ai");
  renderFooterYear();

  const gateEl = document.getElementById("ai-gate");
  Auth.requireActive(gateEl, (user) => initAiPage(gateEl, user));
});

function initAiPage(root, user) {
  root.innerHTML = `
    <div class="page-hero-row">
      <span class="page-hero-emoji" aria-hidden="true">🪄</span>
      <h1 class="hero-title" style="font-size:clamp(2rem,5vw,3rem);text-align:center;">AI 作圖</h1>
      <span class="page-hero-emoji" aria-hidden="true">🎨</span>
    </div>

    <div id="quota-banner" class="steps-note"></div>

    <div class="steps-note" style="margin-top:16px;">
      <h3>🧑‍🎨 我的角色設定（必填，讓角色在故事裡長得一樣）</h3>
      <div class="form-row">
        <textarea id="character-sheet-input" maxlength="800" rows="3" placeholder="例如：一隻橘色短毛貓，戴紅色圍巾，大大的圓眼睛，圓滾滾的身材"></textarea>
        <div class="form-hint">這段描述會自動加在每次生成的 Prompt 最前面。寫得越具體（顏色、服裝、表情、體型），角色在不同頁面就越容易保持一致。</div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-outline-dark" id="save-character-btn">💾 儲存角色設定</button>
        <span class="form-msg-inline" id="character-save-msg"></span>
      </div>
    </div>

    <form class="submit-form" id="ai-form" style="margin-top:20px;">
      <h3 style="font-family:var(--font-hand);">✏️ 這一頁的畫面內容</h3>
      <div class="form-row">
        <label for="field-subject">主體 / 動作</label>
        <input type="text" id="field-subject" maxlength="200" placeholder="例如：在公園裡追蝴蝶">
      </div>
      <div class="form-row">
        <label for="field-setting">場景</label>
        <input type="text" id="field-setting" maxlength="200" placeholder="例如：櫻花盛開的公園，午後陽光">
      </div>
      <div class="form-row">
        <label for="field-style">風格</label>
        <input type="text" id="field-style" maxlength="200" placeholder="例如：水彩插畫風、色彩柔和">
      </div>
      <div class="form-row">
        <label for="field-mood">光線 / 氛圍（選填）</label>
        <input type="text" id="field-mood" maxlength="200" placeholder="例如：溫暖的黃昏光線">
      </div>

      <div class="form-row">
        <label>參考圖（選填，讓這次生成盡量貼近某張舊圖的角色長相）</label>
        <div id="reference-picker"><p style="color:#8a7d68;">載入我的作品中...</p></div>
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
  let selectedReferenceId = "";
  let myArtworks = [];

  const quotaBanner = document.getElementById("quota-banner");
  const characterInput = document.getElementById("character-sheet-input");
  const saveCharacterBtn = document.getElementById("save-character-btn");
  const characterSaveMsg = document.getElementById("character-save-msg");
  const form = document.getElementById("ai-form");
  const subjectInput = document.getElementById("field-subject");
  const settingInput = document.getElementById("field-setting");
  const styleInput = document.getElementById("field-style");
  const moodInput = document.getElementById("field-mood");
  const previewInput = document.getElementById("final-prompt-preview");
  const referencePicker = document.getElementById("reference-picker");
  const generateBtn = document.getElementById("ai-generate-btn");
  const msgEl = document.getElementById("ai-msg");
  const resultEl = document.getElementById("ai-result");

  characterInput.value = user.characterSheet || "";

  function composePrompt() {
    const parts = [];
    if (characterInput.value.trim()) parts.push(characterInput.value.trim());
    if (subjectInput.value.trim()) parts.push(subjectInput.value.trim());
    if (settingInput.value.trim()) parts.push("場景：" + settingInput.value.trim());
    if (styleInput.value.trim()) parts.push("風格：" + styleInput.value.trim());
    if (moodInput.value.trim()) parts.push(moodInput.value.trim());
    previewInput.value = parts.join("，");
  }
  [characterInput, subjectInput, settingInput, styleInput, moodInput].forEach((el) =>
    el.addEventListener("input", composePrompt)
  );
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

  function renderReferencePicker() {
    const withImages = myArtworks.filter((a) => a.isMine);
    if (!withImages.length) {
      referencePicker.innerHTML = `<p style="color:#8a7d68;">你還沒有作品可以當參考圖，先產生或投稿一張之後就可以選了。</p>`;
      return;
    }
    referencePicker.innerHTML = `
      <div class="my-story-pool">
        <div class="my-story-pool-item reference-option ${selectedReferenceId === "" ? "selected" : ""}" data-ref-id="" style="display:flex;align-items:center;justify-content:center;aspect-ratio:1;background:var(--kraft);">不使用參考圖</div>
        ${withImages
          .map(
            (a) => `
          <div class="my-story-pool-item reference-option ${selectedReferenceId === a.ID ? "selected" : ""}" data-ref-id="${escapeHtml(a.ID)}">
            <img src="${escapeHtml(Api.resolveImageSrc(a))}" alt="${escapeHtml(a.DisplayName)}" loading="lazy">
            <div class="pool-item-name">${escapeHtml(a.DisplayName)}</div>
          </div>
        `
          )
          .join("")}
      </div>
    `;
    referencePicker.querySelectorAll(".reference-option").forEach((el) => {
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

    if (!characterInput.value.trim()) {
      showMsg("error", "請先填寫「我的角色設定」，這樣才能讓角色在不同頁面盡量長得一樣。");
      characterInput.focus();
      return;
    }
    const finalPrompt = previewInput.value.trim();
    if (!finalPrompt) {
      showMsg("error", "Prompt 是空的，請至少填寫「主體 / 動作」。");
      return;
    }

    generating = true;
    generateBtn.disabled = true;
    generateBtn.textContent = "產生中，請稍候（約 10~30 秒）...";
    showMsg("pending", "AI 正在畫畫，請稍候...");
    resultEl.innerHTML = "";

    try {
      const res = await Api.aiGenerate(finalPrompt, selectedReferenceId);
      showMsg("success", "🎉 圖片產生成功！已存為「私人」作品，可以到「我要投稿」頁面調整公開狀態。");
      const art = res.artwork;
      resultEl.innerHTML = `
        <div class="note-card" style="max-width:340px;margin:0 auto;">
          <div class="note-thumb-wrap"><img src="${escapeHtml(Api.resolveImageSrc(art))}" alt="AI 產生的圖片"></div>
          <div class="note-footer-row" style="justify-content:center;">🔒 私人（只有你看得到）</div>
        </div>
      `;
      renderQuota(res.quota);
      subjectInput.value = "";
      settingInput.value = "";
      moodInput.value = "";
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
