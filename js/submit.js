document.addEventListener("DOMContentLoaded", () => {
  setActiveNav("submit");
  renderFooterYear();

  const classSelect = document.getElementById("field-class");
  const toolSelect = document.getElementById("field-tool");
  const toolOtherInput = document.getElementById("field-tool-other");
  const imageInput = document.getElementById("field-image");
  const imageCheckEl = document.getElementById("image-check");
  const imagePreviewEl = document.getElementById("image-preview");
  const rosterFallbackHint = document.getElementById("roster-fallback-hint");

  toolSelect.innerHTML = CONFIG.AI_TOOLS.map((t) => `<option>${escapeHtml(t)}</option>`).join("");

  toolSelect.addEventListener("change", () => {
    const isOther = toolSelect.value === "其他";
    toolOtherInput.style.display = isOther ? "block" : "none";
    toolOtherInput.required = isOther;
    if (!isOther) toolOtherInput.value = "";
  });

  let nameSelect = document.getElementById("field-name");
  let classToStudents = {}; // { className: [studentName, ...] }
  let rosterMode = true;    // true = 下拉選單連動 Google Sheet；false = 手動輸入（備援模式）
  let imageValidationOk = false; // 圖片是否通過驗證，決定能不能送出

  /* =========================================================
     1. 載入班級 / 姓名名單（連動 Google Sheet 的 AuthorizedUsers 分頁）
     ========================================================= */
  loadRoster();

  async function loadRoster() {
    try {
      const res = await Api.getRoster();
      const roster = res.roster || [];
      if (!roster.length) throw new Error("名單是空的");

      classToStudents = {};
      roster.forEach((r) => {
        if (!classToStudents[r.className]) classToStudents[r.className] = [];
        classToStudents[r.className].push(r.studentName);
      });

      const classNames = Object.keys(classToStudents);
      classSelect.innerHTML =
        `<option value="">請選擇班級</option>` +
        classNames.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
      classSelect.disabled = false;

      nameSelect.innerHTML = `<option value="">請先選擇班級</option>`;
      nameSelect.disabled = true;

      classSelect.addEventListener("change", () => {
        const students = classToStudents[classSelect.value] || [];
        if (!classSelect.value) {
          nameSelect.innerHTML = `<option value="">請先選擇班級</option>`;
          nameSelect.disabled = true;
          return;
        }
        nameSelect.innerHTML =
          `<option value="">請選擇姓名</option>` +
          students.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
        nameSelect.disabled = false;
      });
    } catch (err) {
      // 連不到 Google Sheet 名單時的備援：改用固定班級清單 + 手動輸入姓名，
      // 並提示老師收到投稿後仍需自行核對授權名單。
      rosterMode = false;
      classSelect.innerHTML = CONFIG.CLASSES.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
      classSelect.disabled = false;

      const input = document.createElement("input");
      input.type = "text";
      input.id = "field-name";
      input.required = true;
      input.maxLength = 20;
      input.placeholder = "例如：王小明";
      nameSelect.replaceWith(input);
      nameSelect = input;

      rosterFallbackHint.style.display = "block";
      console.warn("班級/姓名名單載入失敗，改用手動輸入模式：", err.message);
    }
  }

  /* =========================================================
     2. Imgur 圖片連結驗證
     ========================================================= */
  const IMGUR_ALBUM_RE = /^https?:\/\/(www\.)?imgur\.com\/(a|gallery|t)\//i;
  const IMGUR_PAGE_RE = /^https?:\/\/(www\.)?imgur\.com\/[a-zA-Z0-9]+\/?$/i;

  let imageCheckToken = 0;
  imageInput.addEventListener("input", () => {
    clearTimeout(imageInput._debounce);
    imageInput._debounce = setTimeout(checkImageUrl, 500);
  });
  imageInput.addEventListener("blur", checkImageUrl);

  function setImageCheck(state, text) {
    imageCheckEl.className = "image-check show " + state;
    imageCheckEl.textContent = text;
  }

  function checkImageUrl() {
    const url = imageInput.value.trim();
    const myToken = ++imageCheckToken;
    imageValidationOk = false;
    imagePreviewEl.style.display = "none";

    if (!url) {
      imageCheckEl.className = "image-check";
      imageCheckEl.textContent = "";
      return;
    }

    if (IMGUR_ALBUM_RE.test(url)) {
      setImageCheck(
        "error",
        "⚠️ 這是 Imgur 相簿／貼文網址，不是圖片直接連結。請打開圖片，在圖片上按右鍵選「複製圖片網址」，貼上結尾是 .jpg/.png 的網址。"
      );
      return;
    }
    if (IMGUR_PAGE_RE.test(url)) {
      setImageCheck(
        "error",
        "⚠️ 這看起來是 Imgur 的頁面網址，不是圖片直接連結。請在圖片上按右鍵選「複製圖片網址」，網址開頭通常會是 i.imgur.com。"
      );
      return;
    }

    setImageCheck("pending", "🔍 正在確認圖片是否能正常開啟...");
    const testImg = new Image();
    testImg.onload = () => {
      if (myToken !== imageCheckToken) return; // 使用者已經改輸入其他網址，這次結果過期了
      imageValidationOk = true;
      setImageCheck("success", "✅ 圖片可以正常載入！");
      imagePreviewEl.src = url;
      imagePreviewEl.style.display = "block";
    };
    testImg.onerror = () => {
      if (myToken !== imageCheckToken) return;
      imageValidationOk = false;
      setImageCheck("error", "❌ 這個網址無法載入圖片，請確認連結是否正確、圖片是否還存在。");
    };
    testImg.src = url;
  }

  /* =========================================================
     3. 送出投稿
     ========================================================= */
  const form = document.getElementById("submit-form");
  const msgEl = document.getElementById("submit-msg");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const studentName = nameSelect.value.trim();
    const className = classSelect.value.trim();
    const imageUrl = imageInput.value.trim();

    if (!className) {
      showMsg("error", "請選擇班級。");
      return;
    }
    if (!studentName) {
      showMsg("error", rosterMode ? "請選擇姓名。" : "請輸入姓名。");
      return;
    }
    if (!imageUrl) {
      showMsg("error", "請貼上 Imgur 圖片直接連結。");
      return;
    }
    if (!imageValidationOk) {
      showMsg("error", "圖片連結尚未通過驗證，請確認網址是否正確（需為圖片直接連結，且能正常開啟）。");
      return;
    }

    const isOtherTool = toolSelect.value === "其他";
    const customTool = toolOtherInput.value.trim();
    if (isOtherTool && !customTool) {
      showMsg("error", "選了「其他」，請輸入你使用的 AI 工具名稱。");
      return;
    }

    const payload = {
      studentName,
      className,
      imageUrl,
      aiTool: isOtherTool ? customTool : toolSelect.value,
      prompt: document.getElementById("field-prompt").value.trim(),
      description: document.getElementById("field-desc").value.trim(),
      tags: document.getElementById("field-tags").value.trim(),
    };

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
      toolOtherInput.style.display = "none";
      toolOtherInput.required = false;
      imageCheckEl.className = "image-check";
      imageCheckEl.textContent = "";
      imagePreviewEl.style.display = "none";
      imageValidationOk = false;
      if (rosterMode) {
        nameSelect.innerHTML = `<option value="">請先選擇班級</option>`;
        nameSelect.disabled = true;
      }
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
