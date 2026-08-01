function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("print-status");
  const contentEl = document.getElementById("print-content");
  const params = new URLSearchParams(location.search);
  const bookId = params.get("bookId");

  if (!Api.getSessionToken()) {
    statusEl.textContent = "尚未登入，請先回到主網站登入後再開啟這個頁面。";
    return;
  }
  if (!bookId) {
    statusEl.textContent = "缺少故事本 ID。";
    return;
  }

  statusEl.textContent = "載入中...";
  try {
    const res = await Api.booksGet(bookId);
    const book = res.book;
    document.title = book.title + " - 故事本列印預覽";
    statusEl.textContent = `共 ${book.frames.length} 頁`;

    contentEl.innerHTML =
      `<div class="print-title">${escapeHtml(book.title)}</div>` +
      book.frames
        .map(
          (f) => `
        <div class="print-page">
          ${f.unavailable ? `<p style="text-align:center;color:#a8402f;">（這一頁的圖片已無法顯示）</p>` : `<img src="${escapeHtml(Api.resolveImageSrc(f))}" alt="${escapeHtml(f.nickname || "")}">`}
          <div class="caption">${escapeHtml(f.caption || "")}</div>
        </div>
      `
        )
        .join("");
  } catch (err) {
    statusEl.textContent = "載入失敗：" + err.message;
  }
});
