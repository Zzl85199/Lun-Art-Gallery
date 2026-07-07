document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("submit");
  renderFooterYear();

  // 動態填入班級 / AI 工具選項
  const classSelect = document.getElementById("field-class");
  const toolSelect = document.getElementById("field-tool");
  classSelect.innerHTML = CONFIG.CLASSES.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
  toolSelect.innerHTML = CONFIG.AI_TOOLS.map((t) => `<option>${escapeHtml(t)}</option>`).join("");

  const form = document.getElementById("submit-form");
  const msgEl = document.getElementById("submit-msg");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      studentName: document.getElementById("field-name").value.trim(),
      className: classSelect.value,
      imageUrl: document.getElementById("field-image").value.trim(),
      aiTool: toolSelect.value,
      prompt: document.getElementById("field-prompt").value.trim(),
      description: document.getElementById("field-desc").value.trim(),
      tags: document.getElementById("field-tags").value.trim(),
    };

    if (!payload.studentName) {
      showMsg("error", "請至少填寫姓名後再送出。");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "上傳中，請稍候...";
    showMsg("pending", "作品傳送中，請稍候，若有附圖片會需要一點時間備份...");

    try {
      const res = await Api.submitArtwork(payload);
      if (res.approved) {
        showMsg("success", "🎉 投稿成功，已直接上架到畫廊囉！");
      } else {
        showMsg("pending", "✅ 投稿成功，待老師審核後會出現在畫廊中，請耐心等候～");
      }
      form.reset();
    } catch (err) {
      showMsg("error", "投稿失敗：" + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出投稿";
    }
  });

  function showMsg(type, text) {
    msgEl.className = `form-msg show ${type}`;
    msgEl.textContent = text;
    msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
