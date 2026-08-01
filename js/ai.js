document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("ai");
  renderFooterYear();

  const gateEl = document.getElementById("ai-gate");
  Auth.requireActive(gateEl, (user) => initAiPage(gateEl, user));
});

function initAiPage(root) {
  root.innerHTML = `
    <div class="page-hero-row">
      <span class="page-hero-emoji" aria-hidden="true">🪄</span>
      <h1 class="hero-title" style="font-size:clamp(2rem,5vw,3rem);text-align:center;">AI 作圖</h1>
      <span class="page-hero-emoji" aria-hidden="true">🎨</span>
    </div>

    <div id="quota-banner" class="steps-note"></div>

    <form class="submit-form" id="ai-form">
      <div class="form-row">
        <label for="ai-prompt">Prompt（請具體描述你想要的畫面）*</label>
        <textarea id="ai-prompt" required maxlength="1000" placeholder="例如：一隻穿著太空衣的橘貓，站在月球表面，背景是地球，插畫風格，色彩鮮豔..."></textarea>
      </div>
      <button type="submit" class="btn btn-pin" id="ai-generate-btn" style="width:100%;">✨ 產生圖片</button>
      <div class="form-msg" id="ai-msg"></div>
    </form>

    <div id="ai-result" style="margin-top:24px;"></div>
  `;

  let generating = false;
  const quotaBanner = document.getElementById("quota-banner");
  const form = document.getElementById("ai-form");
  const promptInput = document.getElementById("ai-prompt");
  const generateBtn = document.getElementById("ai-generate-btn");
  const msgEl = document.getElementById("ai-msg");
  const resultEl = document.getElementById("ai-result");

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (generating) return;
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    generating = true;
    generateBtn.disabled = true;
    generateBtn.textContent = "產生中，請稍候（約 10~30 秒）...";
    msgEl.className = "form-msg show pending";
    msgEl.textContent = "AI 正在畫畫，請稍候...";
    resultEl.innerHTML = "";

    try {
      const res = await Api.aiGenerate(prompt);
      msgEl.className = "form-msg show success";
      msgEl.textContent = "🎉 圖片產生成功！已存為「私人」作品，可以到「我要投稿」頁面調整公開狀態。";
      const art = res.artwork;
      resultEl.innerHTML = `
        <div class="note-card" style="max-width:340px;margin:0 auto;">
          <div class="note-thumb-wrap"><img src="${escapeHtml(Api.resolveImageSrc(art))}" alt="AI 產生的圖片"></div>
          <div class="note-footer-row" style="justify-content:center;">🔒 私人（只有你看得到）</div>
        </div>
      `;
      renderQuota(res.quota);
      promptInput.value = "";
    } catch (err) {
      msgEl.className = "form-msg show error";
      msgEl.textContent = "產生失敗：" + err.message;
      loadQuota();
    } finally {
      generating = false;
      generateBtn.disabled = false;
      loadQuota();
    }
  });

  loadQuota();
}
