/**
 * ===============================================================
 * 繪本預覽 + 一鍵下載 PDF
 * ===============================================================
 * 舊版是用瀏覽器列印功能存 PDF，但列印對話框會自動加上日期、網址、
 * 頁碼等頁首頁尾，印出來一看就知道是網頁，而且每個學生都要自己去
 * 取消勾選，很難教。
 *
 * 這一版改成整本繪本由 JS 自己畫在 canvas 上，再用 jsPDF 組成
 * 橫式 A4 的 PDF 直接下載，學生不需要做任何列印設定。
 *
 * 頁面結構：封面 → 內頁 ×N → 版權/結尾頁
 *
 * 圖片一律透過後端 image/get 取回 base64 再畫，避免跨網域圖片
 * 汙染 canvas（tainted canvas 會讓 toDataURL 直接失敗）。
 */

/* ---------------- 版面常數 ----------------
   A4 橫式 297×210mm。學生的 AI 圖大多是 1024×1024，橫跨整頁時
   原生解析度本來就只有約 120dpi，所以輸出用 150dpi 就夠了，
   再往上加只會讓檔案變大、上傳容易超過 9MB。 */
const PAGE_W = 1754; // 297mm @150dpi
const PAGE_H = 1240; // 210mm @150dpi

const C = {
  paper: "#faf4e4",
  paperDeep: "#f1e7cd",
  ink: "#3a3226",
  inkSoft: "#6b5f4c",
  gold: "#c99a3f",
  line: "#d8c9a4",
};

const FONT_HAND = '"Huninn", "Noto Sans TC", sans-serif';
const FONT_BODY = '"Noto Sans TC", sans-serif';

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================================================
   基礎繪圖工具
   ========================================================================= */

function newPageCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** 把圖片等比放大到「填滿」指定範圍（超出的部分會被裁掉） */
function drawImageCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** 把圖片等比縮到「完整放進」指定範圍，回傳實際畫出來的矩形 */
function drawImageContain(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  return { x: dx, y: dy, w: dw, h: dh };
}

/** 用同一張圖模糊放大鋪滿整頁當背景，正方形圖放在橫式頁面上也不會有難看的白邊 */
function drawBlurBackdrop(ctx, img, veilAlpha) {
  ctx.save();
  ctx.filter = "blur(46px)";
  // 往外多畫一圈，避免模糊到邊緣時出現透明縫隙
  drawImageCover(ctx, img, -80, -80, PAGE_W + 160, PAGE_H + 160);
  ctx.restore();
  if (veilAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = veilAlpha;
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.restore();
  }
}

/** 圖片外框：白邊 + 陰影，像一張貼上去的印刷照片 */
function drawFramedImage(ctx, img, areaX, areaY, areaW, areaH) {
  const pad = 16;
  const fit = (() => {
    const scale = Math.min((areaW - pad * 2) / img.naturalWidth, (areaH - pad * 2) / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    return { x: areaX + (areaW - w) / 2, y: areaY + (areaH - h) / 2, w, h };
  })();

  ctx.save();
  ctx.shadowColor = "rgba(40, 30, 15, 0.32)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#fffdf7";
  roundRectPath(ctx, fit.x - pad, fit.y - pad, fit.w + pad * 2, fit.h + pad * 2, 22);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, fit.x, fit.y, fit.w, fit.h, 12);
  ctx.clip();
  ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
  ctx.restore();
  return fit;
}

/* ---------------- 中文斷行 ----------------
   中文沒有空白可以斷，所以逐字量寬度；標點不能出現在行首（避頭點）。 */
const NO_LINE_START = "，。、；：！？」』）》〉】…—·,.!?;:)]}";

function wrapLines(ctx, text, maxWidth, maxLines) {
  const paragraphs = String(text || "").split(/\r?\n/);
  const lines = [];
  paragraphs.forEach((para) => {
    if (!para.trim()) { lines.push(""); return; }
    let line = "";
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        if (NO_LINE_START.includes(ch) && line.length > 1) {
          // 避頭點：把前一行最後一個字挪下來陪它
          const moved = line.slice(-1);
          lines.push(line.slice(0, -1));
          line = moved + ch;
        } else {
          lines.push(line);
          line = ch;
        }
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  });
  if (maxLines && lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, -1) + "…";
    return kept;
  }
  return lines;
}

/** 自動挑一個能在限定行數內放完的字級 */
function fitLines(ctx, text, maxWidth, sizes, weight, family, maxLines) {
  for (const size of sizes) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrapLines(ctx, text, maxWidth, null);
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = `${weight} ${size}px ${family}`;
  return { size, lines: wrapLines(ctx, text, maxWidth, maxLines) };
}

function drawCenteredLines(ctx, lines, centerX, startY, lineHeight) {
  lines.forEach((line, i) => {
    ctx.fillText(line, centerX, startY + i * lineHeight);
  });
}

/* =========================================================================
   各種頁型
   ========================================================================= */

/** 封面：模糊背景鋪滿 + 完整主圖 + 書名牌 */
function renderCoverPage(book, meta, img) {
  const { canvas, ctx } = newPageCanvas();

  if (img) {
    drawBlurBackdrop(ctx, img, 0.18);
  } else {
    ctx.fillStyle = C.paperDeep;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  }

  // 上方主圖區
  if (img) drawFramedImage(ctx, img, 0, 44, PAGE_W, 748);

  // 下方書名牌
  const plateW = 1240;
  const plateH = 336;
  const plateX = (PAGE_W - plateW) / 2;
  const plateY = 826;

  ctx.save();
  ctx.shadowColor = "rgba(40, 30, 15, 0.28)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "rgba(255, 253, 246, 0.96)";
  roundRectPath(ctx, plateX, plateY, plateW, plateH, 28);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  roundRectPath(ctx, plateX + 14, plateY + 14, plateW - 28, plateH - 28, 18);
  ctx.stroke();

  ctx.textAlign = "center";
  const titleFit = fitLines(ctx, book.title || "未命名繪本", plateW - 140, [96, 84, 72, 60, 52], "700", FONT_HAND, 2);
  ctx.fillStyle = C.ink;
  const titleLineH = titleFit.size * 1.24;
  const titleBlockH = titleFit.lines.length * titleLineH;
  const titleTop = plateY + 118 - (titleBlockH - titleLineH) / 2;
  drawCenteredLines(ctx, titleFit.lines, PAGE_W / 2, titleTop, titleLineH);

  const dividerY = titleTop + titleBlockH - titleLineH + 54;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAGE_W / 2 - 150, dividerY);
  ctx.lineTo(PAGE_W / 2 + 150, dividerY);
  ctx.stroke();

  ctx.fillStyle = C.inkSoft;
  ctx.font = `500 38px ${FONT_HAND}`;
  const authorLines = wrapLines(ctx, meta.authorLine, plateW - 160, 2);
  drawCenteredLines(ctx, authorLines, PAGE_W / 2, dividerY + 54, 48);

  ctx.font = `400 26px ${FONT_BODY}`;
  ctx.fillStyle = "#8a7d68";
  ctx.fillText(meta.dateText, PAGE_W / 2, plateY + plateH - 34);

  return canvas;
}

/** 內頁：一頁一圖 + 下方文字帶 */
function renderStoryPage(frame, img, pageNo, fillMode) {
  const { canvas, ctx } = newPageCanvas();
  const bandH = 268;
  const imageAreaH = PAGE_H - bandH;

  if (!img) {
    ctx.fillStyle = C.paperDeep;
    ctx.fillRect(0, 0, PAGE_W, imageAreaH);
    ctx.textAlign = "center";
    ctx.fillStyle = "#a8402f";
    ctx.font = `500 44px ${FONT_HAND}`;
    ctx.fillText("（這一頁的圖片無法載入）", PAGE_W / 2, imageAreaH / 2);
  } else if (fillMode) {
    // 真正的裁切滿版：圖片鋪滿整頁，文字帶半透明疊在上面
    drawImageCover(ctx, img, 0, 0, PAGE_W, PAGE_H);
  } else {
    // 預設：模糊背景鋪滿 + 主圖完整呈現，不裁掉任何構圖
    drawBlurBackdrop(ctx, img, 0.3);
    drawFramedImage(ctx, img, 0, 34, PAGE_W, imageAreaH - 34);
  }

  // 文字帶
  ctx.save();
  ctx.globalAlpha = fillMode ? 0.93 : 1;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, PAGE_H - bandH, PAGE_W, bandH);
  ctx.restore();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, PAGE_H - bandH + 1.5);
  ctx.lineTo(PAGE_W, PAGE_H - bandH + 1.5);
  ctx.stroke();

  const caption = (frame.caption || "").trim();
  ctx.textAlign = "center";
  if (caption) {
    const fit = fitLines(ctx, caption, PAGE_W - 300, [50, 44, 38, 32, 28], "500", FONT_HAND, 3);
    ctx.fillStyle = C.ink;
    const lineH = fit.size * 1.42;
    const blockH = fit.lines.length * lineH;
    const startY = PAGE_H - bandH + (bandH - blockH) / 2 + fit.size * 1.06;
    drawCenteredLines(ctx, fit.lines, PAGE_W / 2, startY, lineH);
  } else {
    ctx.fillStyle = "#b6a98f";
    ctx.font = `400 34px ${FONT_HAND}`;
    ctx.fillText("（這一頁還沒有文字）", PAGE_W / 2, PAGE_H - bandH / 2 + 12);
  }

  // 頁碼
  ctx.textAlign = "right";
  ctx.fillStyle = "#a2957c";
  ctx.font = `400 24px ${FONT_BODY}`;
  ctx.fillText(String(pageNo), PAGE_W - 46, PAGE_H - 30);

  return canvas;
}

/** 版權 / 結尾頁：作者群、頁數、日期、工具，像真書最後一頁的版權頁 */
function renderCreditsPage(book, meta) {
  const { canvas, ctx } = newPageCanvas();

  ctx.fillStyle = C.paperDeep;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.fillStyle = C.paper;
  ctx.fillRect(46, 46, PAGE_W - 92, PAGE_H - 92);

  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  ctx.strokeRect(70, 70, PAGE_W - 140, PAGE_H - 140);
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.line;
  ctx.strokeRect(84, 84, PAGE_W - 168, PAGE_H - 168);

  ctx.textAlign = "center";

  ctx.fillStyle = "#8a7d68";
  ctx.font = `500 28px ${FONT_BODY}`;
  ctx.fillText("・ 全 書 完 ・", PAGE_W / 2, 196);

  const titleFit = fitLines(ctx, book.title || "未命名繪本", PAGE_W - 460, [62, 54, 46], "700", FONT_HAND, 2);
  ctx.fillStyle = C.ink;
  drawCenteredLines(ctx, titleFit.lines, PAGE_W / 2, 292, titleFit.size * 1.3);

  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAGE_W / 2 - 190, 372);
  ctx.lineTo(PAGE_W / 2 + 190, 372);
  ctx.stroke();

  let y = 452;
  const rowGap = 66;

  function infoRow(label, value, valueSize) {
    if (!value) return;
    ctx.fillStyle = "#9a8d75";
    ctx.font = `500 26px ${FONT_BODY}`;
    ctx.fillText(label, PAGE_W / 2, y);
    ctx.fillStyle = C.ink;
    ctx.font = `500 ${valueSize || 38}px ${FONT_HAND}`;
    const lines = wrapLines(ctx, value, PAGE_W - 460, 3);
    drawCenteredLines(ctx, lines, PAGE_W / 2, y + 48, (valueSize || 38) * 1.35);
    y += rowGap + lines.length * (valueSize || 38) * 1.35;
  }

  infoRow("創  作  者", meta.authorLine, 38);
  infoRow("使 用 工 具", meta.toolLine, 32);
  infoRow("頁 數 與 日 期", `全書 ${meta.pageCount} 頁 ・ ${meta.dateText}`, 32);

  ctx.fillStyle = C.inkSoft;
  ctx.font = `400 26px ${FONT_BODY}`;
  const stmt = wrapLines(ctx, "本書插圖由學生使用 AI 工具生成並挑選，文字由學生自行撰寫，圖文著作權與創作責任歸屬創作學生。", PAGE_W - 520, 3);
  drawCenteredLines(ctx, stmt, PAGE_W / 2, PAGE_H - 226, 40);

  ctx.fillStyle = C.gold;
  ctx.font = `700 34px ${FONT_HAND}`;
  ctx.fillText(CONFIG.SITE_TITLE || "AI 創作畫廊", PAGE_W / 2, PAGE_H - 130);
  ctx.fillStyle = "#a2957c";
  ctx.font = `400 24px ${FONT_BODY}`;
  ctx.fillText(CONFIG.SITE_SUBTITLE || "", PAGE_W / 2, PAGE_H - 96);

  return canvas;
}

/* =========================================================================
   圖片載入
   ========================================================================= */

function loadImageEl(src, useCors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = src;
  });
}

/**
 * 取得可以安全畫進 canvas 的圖片。
 * 先走後端 image/get 拿 base64（同源，最保險），失敗才退回原網址 + CORS。
 * 兩者都失敗就回 null，那一頁會印出「圖片無法載入」而不是整本失敗。
 */
async function loadFrameImage(frame) {
  const id = frame.ID || frame.artworkId;
  if (id) {
    try {
      return await loadImageEl(await Api.fetchPrivateImageDataUrl(id), false);
    } catch (e) { /* 換下一招 */ }
  }
  if (frame.ImageURL) {
    try {
      return await loadImageEl(frame.ImageURL, true);
    } catch (e) { /* 放棄這一頁的圖 */ }
  }
  return null;
}

/* =========================================================================
   主流程
   ========================================================================= */

async function ensureFontsReady() {
  const specs = [
    `700 96px ${FONT_HAND}`,
    `500 52px ${FONT_HAND}`,
    `400 34px ${FONT_HAND}`,
    `500 28px ${FONT_BODY}`,
  ];
  try {
    await Promise.all(specs.map((s) => document.fonts.load(s, "繪本文字測試 AI 123")));
    await document.fonts.ready;
  } catch (e) { /* 字型載入失敗就用系統字型，不影響流程 */ }
}

/* =========================================================================
   PDF 組裝
   ========================================================================= */

/** 故事本的公開範圍選項（和「我的頁面」上傳故事本用同一套文字） */
const BOOK_VISIBILITY_OPTIONS = [
  { value: "public", label: "🌍 公開", hint: "老師與同學都可以下載這本繪本" },
  { value: "gallery_only", label: "🖼️ 僅畫廊", hint: "同上，登入後的同學可以看到" },
  { value: "private", label: "🔒 私人", hint: "只有你自己登入後看得到" },
];

/** 後端 submitBook 的檔案大小上限是 9MB，這裡留一點餘裕 */
const MAX_PDF_BYTES = 8.4 * 1024 * 1024;

function pagesToPdf(pages, quality) {
  const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pages.forEach((p, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(p.canvas.toDataURL("image/jpeg", quality), "JPEG", 0, 0, 297, 210);
  });
  return pdf;
}

function base64FromDataUri(dataUri) {
  const comma = dataUri.indexOf(",");
  return comma === -1 ? dataUri : dataUri.slice(comma + 1);
}

function base64Bytes(base64) {
  return Math.floor((base64.length * 3) / 4);
}

/**
 * 產生要上傳的 PDF base64。頁數多的時候 8.4MB 會爆，
 * 所以品質從高往低試，讓學生不用自己回去刪頁。
 */
function makePdfBase64(pages, onProgress) {
  const qualities = [0.92, 0.82, 0.72, 0.62];
  let last = null;
  for (const q of qualities) {
    if (onProgress) onProgress(q);
    const base64 = base64FromDataUri(pagesToPdf(pages, q).output("datauristring"));
    last = { base64, quality: q, bytes: base64Bytes(base64) };
    if (last.bytes <= MAX_PDF_BYTES) return last;
  }
  return last; // 連最低品質都還是太大，交給呼叫端顯示錯誤
}

function buildMeta(book, frames) {
  const seen = new Set();
  const authors = [];
  frames.forEach((f) => {
    const name = (f.nickname || "").trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    authors.push(f.className ? `${name}（${f.className}）` : name);
  });

  const tools = Array.from(new Set(frames.map((f) => (f.aiTool || "").trim()).filter(Boolean)));

  const now = new Date();
  return {
    authorLine: authors.join("、") || "匿名",
    toolLine: tools.join("、"),
    pageCount: frames.length,
    dateText: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`,
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("print-status");
  const contentEl = document.getElementById("print-content");
  const noteEl = document.getElementById("print-note");
  const downloadBtn = document.getElementById("download-pdf-btn");
  const fillToggle = document.getElementById("fill-mode-toggle");
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

  let book = null;
  let images = [];
  let meta = null;

  statusEl.textContent = "載入故事本中...";
  try {
    const res = await Api.booksGet(bookId);
    book = res.book;
  } catch (err) {
    statusEl.textContent = "載入失敗：" + err.message;
    return;
  }

  document.title = (book.title || "繪本") + " - 繪本預覽";
  if (!book.frames.length) {
    statusEl.textContent = "這本故事本還沒有任何頁面。";
    return;
  }

  await ensureFontsReady();

  // 圖片一張一張載入，順便回報進度（後端代理一張要一兩秒，學生才知道沒有卡住）
  images = [];
  for (let i = 0; i < book.frames.length; i++) {
    statusEl.textContent = `載入圖片 ${i + 1} / ${book.frames.length}...`;
    images.push(await loadFrameImage(book.frames[i]));
  }
  meta = buildMeta(book, book.frames);

  let pages = [];

  function renderAll() {
    const fillMode = fillToggle.checked;
    contentEl.innerHTML = "";
    pages = [];

    const cover = renderCoverPage(book, meta, images[0]);
    pages.push({ canvas: cover, label: "封面" });

    book.frames.forEach((frame, i) => {
      pages.push({ canvas: renderStoryPage(frame, images[i], i + 1, fillMode), label: `第 ${i + 1} 頁` });
    });

    pages.push({ canvas: renderCreditsPage(book, meta), label: "版權頁" });

    pages.forEach((p) => {
      const wrap = document.createElement("div");
      wrap.className = "book-page-wrap";
      wrap.appendChild(p.canvas);
      const label = document.createElement("p");
      label.className = "book-page-label";
      label.textContent = p.label;
      wrap.appendChild(label);
      contentEl.appendChild(wrap);
    });

    const missing = images.filter((img) => !img).length;
    statusEl.textContent = `共 ${pages.length} 頁（封面 + ${book.frames.length} 頁內文 + 版權頁）` + (missing ? `・有 ${missing} 頁圖片載入失敗` : "");
    downloadBtn.disabled = false;
  }

  noteEl.innerHTML = `
    這是最終印出來的樣子，下面每一張就是 PDF 的一頁，不會有網址和日期頁首頁尾。
    圖是正方形時，預設把同一張圖模糊放大當背景鋪滿整頁、主圖完整呈現；
    勾選「圖片裁切鋪滿整頁」可以改成真正的滿版，但上下會被裁掉一部分。<br>
    滿意的話直接按「📤 上傳成故事本」就會存進「我的頁面」，不需要先下載再手動上傳；
    想留一份在電腦裡再按「⬇️ 只下載 PDF」。
  `;

  fillToggle.addEventListener("change", renderAll);
  renderAll();

  function pdfReady() {
    if (window.jspdf && window.jspdf.jsPDF) return true;
    alert("PDF 元件載入失敗，請檢查網路連線後重新整理頁面。");
    return false;
  }

  downloadBtn.addEventListener("click", () => {
    if (!pdfReady()) return;
    downloadBtn.disabled = true;
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = "產生 PDF 中...";

    // 讓瀏覽器先把按鈕狀態畫出來，再做這個會卡住畫面的同步工作
    setTimeout(() => {
      try {
        const safeTitle = (book.title || "繪本").replace(/[\\/:*?"<>|]/g, "_");
        pagesToPdf(pages, 0.92).save(`${safeTitle}_繪本.pdf`);
        statusEl.textContent = "✅ PDF 已下載。";
      } catch (err) {
        alert("產生 PDF 失敗：" + err.message);
      } finally {
        downloadBtn.disabled = false;
        downloadBtn.textContent = originalText;
      }
    }, 50);
  });

  /* ---------------- 直接上傳成故事本 ----------------
     省掉「下載 PDF → 回到我的頁面 → 再選檔案上傳」這一趟。 */
  const uploadBtn = document.getElementById("upload-book-btn");
  const uploadPanel = document.getElementById("upload-panel");
  const uploadVis = document.getElementById("upload-visibility");
  const uploadVisHint = document.getElementById("upload-visibility-hint");
  const uploadDesc = document.getElementById("upload-desc");
  const uploadTags = document.getElementById("upload-tags");
  const uploadConfirmBtn = document.getElementById("upload-confirm-btn");
  const uploadCancelBtn = document.getElementById("upload-cancel-btn");
  const uploadMsg = document.getElementById("upload-msg");
  const uploadQuota = document.getElementById("upload-quota");
  let existingBooks = null; // 我的故事本清單（用來顯示數量與提醒重複上傳）

  uploadVis.innerHTML = BOOK_VISIBILITY_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  function updateVisHint() {
    const opt = BOOK_VISIBILITY_OPTIONS.find((o) => o.value === uploadVis.value);
    uploadVisHint.textContent = opt ? opt.hint : "";
  }
  uploadVis.addEventListener("change", updateVisHint);
  updateVisHint();

  function showUploadMsg(type, text) {
    uploadMsg.className = `form-msg show ${type}`;
    uploadMsg.textContent = text;
  }

  /** 背景撈一次「我的作品」，順便顯示故事本數量，額度快滿時先提醒 */
  async function loadBookQuota() {
    try {
      const res = await Api.listMine();
      existingBooks = (res.artworks || []).filter((a) => a.Kind === "book");
      const max = CONFIG.MAX_BOOKS_PER_USER;
      uploadQuota.textContent = `目前故事本：${existingBooks.length} / ${max} 本`;
      if (existingBooks.length >= max) {
        uploadQuota.textContent += "（已達上限，請先到「我的頁面」刪掉舊的）";
      }
    } catch (e) {
      uploadQuota.textContent = "";
    }
  }

  uploadBtn.addEventListener("click", () => {
    uploadPanel.hidden = !uploadPanel.hidden;
    if (!uploadPanel.hidden) {
      if (existingBooks === null) loadBookQuota();
      uploadPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  uploadCancelBtn.addEventListener("click", () => {
    uploadPanel.hidden = true;
  });

  uploadConfirmBtn.addEventListener("click", async () => {
    if (!pdfReady()) return;

    if (existingBooks && existingBooks.length >= CONFIG.MAX_BOOKS_PER_USER) {
      showUploadMsg("error", `故事本已達上限 ${CONFIG.MAX_BOOKS_PER_USER} 本，請先到「我的頁面」刪掉一些再上傳。`);
      return;
    }
    // 同名的故事本很可能是重複上傳（改了幾個字又按一次），先問一下
    const sameTitle = (existingBooks || []).some((b) => String(b.Title || "").trim() === String(book.title || "").trim());
    if (sameTitle && !confirm(`你已經上傳過一本叫「${book.title}」的故事本了。\n\n要再上傳一份新的嗎？（舊的不會被覆蓋，需要自己去刪）`)) {
      return;
    }

    uploadConfirmBtn.disabled = true;
    uploadCancelBtn.disabled = true;
    const originalText = uploadConfirmBtn.textContent;
    uploadConfirmBtn.textContent = "產生 PDF 中...";
    showUploadMsg("pending", "正在把繪本轉成 PDF，頁數多的時候要等一下...");

    // 產生 PDF 是同步的重工作，先讓畫面把上面的訊息畫出來
    await new Promise((r) => setTimeout(r, 50));

    let pdfData = null;
    try {
      pdfData = makePdfBase64(pages, (q) => {
        uploadConfirmBtn.textContent = q < 0.92 ? "檔案較大，重新壓縮中..." : "產生 PDF 中...";
      });
    } catch (err) {
      showUploadMsg("error", "產生 PDF 失敗：" + err.message);
      uploadConfirmBtn.disabled = false;
      uploadCancelBtn.disabled = false;
      uploadConfirmBtn.textContent = originalText;
      return;
    }

    if (!pdfData || pdfData.bytes > MAX_PDF_BYTES) {
      const mb = pdfData ? (pdfData.bytes / 1024 / 1024).toFixed(1) : "?";
      showUploadMsg("error", `PDF 有 ${mb}MB，超過 9MB 的上傳上限。請回到「故事接龍」把頁數減少一些再試。`);
      uploadConfirmBtn.disabled = false;
      uploadCancelBtn.disabled = false;
      uploadConfirmBtn.textContent = originalText;
      return;
    }

    const sizeMb = (pdfData.bytes / 1024 / 1024).toFixed(1);
    uploadConfirmBtn.textContent = "上傳中，請稍候...";
    showUploadMsg("pending", `PDF 已產生（${sizeMb}MB），正在上傳，請不要關掉這個頁面...`);

    try {
      await Api.submitBook({
        title: book.title || "未命名繪本",
        description: uploadDesc.value.trim(),
        tags: uploadTags.value.trim(),
        visibility: uploadVis.value,
        fileBase64: pdfData.base64,
        mimeType: "application/pdf",
      });
      showUploadMsg("success", "🎉 上傳成功！可以到「我的頁面 → 故事本」看到這本繪本了。");
      uploadConfirmBtn.textContent = "✅ 已上傳";
      uploadCancelBtn.disabled = false;
      await loadBookQuota();
    } catch (err) {
      showUploadMsg("error", "上傳失敗：" + err.message);
      uploadConfirmBtn.disabled = false;
      uploadCancelBtn.disabled = false;
      uploadConfirmBtn.textContent = originalText;
    }
  });

  uploadBtn.disabled = false;
});
