// inline_decode.js — 被 background / popup 按需注入页面后执行（同一隔离世界，可直接用 decoder.js 的 recover）。
// 暴露 window.__mojibakeRun(mode)：
//   mode === 'bubble' : 选区旁浮气泡（复制 / 替换原文 / 关闭）—— 右键菜单走这条
//   mode === 'cover'  : 在选区上方盖一层不透明框，遮住原乱码并显示还原结果 —— 适合禁右键的页面
//   mode === 'pick'   : 进入「点选模式」，用户点页面任意区块即自动解码整块文字 —— 无需选中、绕开禁右键
// 平时完全不加载；只有点菜单 / 点弹窗按钮才注入，满足「不自动运行」。
(function () {
  const STYLE_ID = "mojibake-style";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
      [data-mojibake-bubble]{
        position:fixed;z-index:2147483647;max-width:420px;box-sizing:border-box;
        padding:12px 14px;border-radius:10px;background:#fff;color:#111;
        font:16px/1.6 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
        box-shadow:0 6px 24px rgba(0,0,0,.22);border:1px solid rgba(0,0,0,.12);
      }
      [data-mojibake-cover]{
        position:fixed;z-index:2147483647;box-sizing:border-box;max-width:560px;
        padding:10px 12px;border-radius:10px;background:#fff;color:#111;
        font:16px/1.6 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
        box-shadow:0 6px 24px rgba(0,0,0,.22);border:1px solid rgba(0,0,0,.12);
      }
      .mojibake-dark [data-mojibake-cover]{background:#1e1e1e;color:#eee;border-color:rgba(255,255,255,.14);}
      .mojibake-dark [data-mojibake-bubble]{background:#1e1e1e;color:#eee;border-color:rgba(255,255,255,.14);}
      [data-mojibake-cover] .mb-head{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;}
      [data-mojibake-cover] .mb-title{font-weight:600;opacity:.85;flex:1;min-width:0;}
      [data-mojibake-cover] .mb-btn{border:none;border-radius:7px;background:#2f6df6;color:#fff;font-size:14px;padding:5px 12px;cursor:pointer;}
      [data-mojibake-cover] .mb-btn.ghost{background:#8883;color:inherit;}
      [data-mojibake-cover] .mb-body{white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;}
      [data-mojibake-cover] .mb-loss{margin-top:6px;font-size:14px;color:#e0533d;}
      [data-mojibake-input]{
        position:fixed;z-index:2147483647;left:50%;top:18%;transform:translateX(-50%);
        width:440px;max-width:92vw;background:#fff;color:#111;border:1px solid #8884;
        border-radius:12px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.3);
        font:16px/1.5 sans-serif;box-sizing:border-box;
      }
      .mojibake-dark [data-mojibake-input]{background:#1e1e1e;color:#eee;}
      [data-mojibake-input] textarea{width:100%;min-height:96px;box-sizing:border-box;border-radius:8px;
        border:1px solid #8884;background:#8881;color:inherit;padding:8px;font-family:monospace;font-size:16px;resize:vertical;}
      [data-mojibake-input] .mb-row{display:flex;gap:8px;margin-top:8px;align-items:center;}
      [data-mojibake-input] button{border:none;border-radius:8px;background:#2f6df6;color:#fff;padding:9px 16px;font-size:16px;cursor:pointer;}
      [data-mojibake-input] button.ghost{background:#8883;color:inherit;}
      [data-mojibake-pickbar]{
        position:fixed;z-index:2147483647;top:0;left:0;right:0;
        background:#2f6df6;color:#fff;text-align:center;
        font:16px/1.6 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
        padding:10px 12px;box-shadow:0 2px 10px rgba(0,0,0,.3);cursor:default;
      }
      .mojibake-dark [data-mojibake-pickbar]{background:#1b4fd1;}
    `;
    document.head.appendChild(s);
  }

  function isDark() {
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        const [r, g, b] = m.map(Number);
        return 0.299 * r + 0.587 * g + 0.114 * b < 128;
      }
    } catch (e) {}
    return false;
  }

  function applyDark() {
    ensureStyle();
    if (isDark()) document.documentElement.classList.add("mojibake-dark");
  }

  function makeBtn(label, ghost) {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = ghost ? "mb-btn ghost" : "mb-btn";
    return b;
  }

  function copyText(t) {
    const done = () => {};
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t));
        return;
      }
    } catch (e) {}
    fallbackCopy(t);
  }
  function fallbackCopy(t) {
    const ta = document.createElement("textarea");
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  // 滚动 / 缩放时让覆盖框始终贴住其锚点（选区 range 或点选的元素）
  let scrollBound = false;
  function bindReposition() {
    if (scrollBound) return;
    scrollBound = true;
    const handler = () => {
      document.querySelectorAll("[data-mojibake-cover]").forEach((box) => {
        let rect = null;
        if (box._el) { try { rect = box._el.getBoundingClientRect(); } catch (e) { box.remove(); return; } }
        else if (box._range) { try { rect = box._range.getBoundingClientRect(); } catch (e) { box.remove(); return; } }
        if (!rect) return;
        if (rect.width === 0 && rect.height === 0) return; // 元素已离屏/消失，保留框但不再乱动
        box.style.top = Math.max(8, rect.top) + "px";
        box.style.left = Math.max(8, rect.left) + "px";
      });
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
  }

  // 公共：构造一个覆盖框。opts = { title, onReplace }
  function buildCoverBox(res, opts) {
    opts = opts || {};
    const box = document.createElement("div");
    box.setAttribute("data-mojibake-cover", "1");

    const head = document.createElement("div");
    head.className = "mb-head";
    const title = document.createElement("div");
    title.className = "mb-title";
    title.textContent = opts.title || "乱码还原（已覆盖原文）";
    head.appendChild(title);

    if (typeof opts.onReplace === "function") {
      const btnReplace = makeBtn("替换原文");
      btnReplace.onclick = opts.onReplace;
      head.appendChild(btnReplace);
    }

    let peek = false;
    const btnPeek = makeBtn("显示原文", true);
    btnPeek.onclick = () => {
      peek = !peek;
      box.style.background = peek ? "transparent" : "";
      box.style.boxShadow = peek ? "none" : "";
      box.style.borderColor = peek ? "transparent" : "";
      box.style.pointerEvents = peek ? "none" : "";
      btnPeek.textContent = peek ? "隐藏原文" : "显示原文";
    };
    head.appendChild(btnPeek);

    const btnCopy = makeBtn("复制");
    btnCopy.onclick = () => { copyText(res.text); btnCopy.textContent = "已复制"; setTimeout(() => (btnCopy.textContent = "复制"), 1200); };
    head.appendChild(btnCopy);

    const btnClose = makeBtn("关闭", true);
    btnClose.onclick = () => box.remove();
    head.appendChild(btnClose);

    const body = document.createElement("div");
    body.className = "mb-body";
    body.textContent = res.text;
    box.appendChild(head); box.appendChild(body);

    if (res.lost > 0) {
      const loss = document.createElement("div");
      loss.className = "mb-loss";
      loss.textContent = "注意：" + res.lost + " 处因原字节丢失无法还原，已用「?」标记。";
      box.appendChild(loss);
    }
    return box;
  }

  function mountCover(box, anchor) {
    // anchor: 一个 getBoundingClientRect() 的对象（Range 或 Element）；并把锚点记到 box 上便于滚动贴住
    box._range = anchor.getRangeAt ? anchor.getRangeAt(0) : null;
    box._el = anchor.getRangeAt ? null : anchor;
    applyDark();
    document.body.appendChild(box);
    const rect0 = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    if (rect0) {
      box.style.top = Math.max(8, rect0.top) + "px";
      box.style.left = Math.max(8, rect0.left) + "px";
    }
    bindReposition();
  }

  // ---------------- 气泡模式（右键菜单） ----------------
  function runBubble() {
    const prev = document.querySelector("[data-mojibake-bubble]");
    if (prev) prev.remove();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const text = sel.toString();
    if (!text.trim()) return;
    const res = recover(text);

    const bubble = document.createElement("div");
    bubble.setAttribute("data-mojibake-bubble", "1");
    const title = document.createElement("div");
    title.textContent = "乱码还原";
    title.style.cssText = "font-weight:600;margin-bottom:6px;opacity:.85";
    bubble.appendChild(title);

    const out = document.createElement("div");
    out.textContent = res.text;
    out.style.cssText = "white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto";
    bubble.appendChild(out);

    const loss = document.createElement("div");
    loss.textContent = res.lost > 0
      ? "注意：" + res.lost + " 处因原字节丢失无法还原，已用「?」标记。"
      : "完美还原，无丢失。";
    loss.style.cssText = "margin-top:6px;font-size:12px;color:" + (res.lost > 0 ? "#e0533d" : "#2a9d4a");
    bubble.appendChild(loss);

    const bar = document.createElement("div");
    bar.style.cssText = "margin-top:8px;display:flex;gap:8px";

    const btnCopy = makeBtn("复制");
    btnCopy.onclick = () => { copyText(res.text); btnCopy.textContent = "已复制"; setTimeout(() => (btnCopy.textContent = "复制"), 1200); };

    const btnReplace = makeBtn("替换原文", true);
    btnReplace.onclick = () => {
      try {
        const range = sel.getRangeAt(0);
        const span = document.createElement("span");
        span.textContent = res.text;
        span.title = "原乱码：" + text;
        span.style.cssText = "background:rgba(47,109,246,.18);border-radius:3px;padding:0 2px";
        range.deleteContents(); range.insertNode(span);
        sel.removeAllRanges(); bubble.remove();
      } catch (e) { btnReplace.textContent = "替换失败"; }
    };

    const btnClose = makeBtn("关闭", true);
    btnClose.onclick = () => bubble.remove();

    bar.appendChild(btnCopy); bar.appendChild(btnReplace); bar.appendChild(btnClose);
    bubble.appendChild(bar);

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    applyDark();
    document.body.appendChild(bubble);
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + bw > window.innerWidth - 8) left = window.innerWidth - bw - 8;
    if (top + bh > window.innerHeight - 8) top = rect.top - bh - 8;
    if (top < 8) top = 8;
    bubble.style.left = Math.max(8, left) + "px";
    bubble.style.top = Math.max(8, top) + "px";
  }

  // ---------------- 覆盖模式（图标弹窗按钮，绕开禁右键页面） ----------------
  function runCover() {
    document.querySelectorAll("[data-mojibake-cover],[data-mojibake-input]").forEach((e) => e.remove());
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) {
      showInputBox(); // 没选区就给个粘贴框
      return;
    }
    const text = sel.toString();
    const res = recover(text);
    const range = sel.getRangeAt(0);
    const box = buildCoverBox(res, {
      title: "乱码还原（已覆盖原文）",
      onReplace: () => {
        try {
          const span = document.createElement("span");
          span.textContent = res.text;
          span.title = "原乱码：" + text;
          span.style.cssText = "background:rgba(47,109,246,.18);border-radius:3px;padding:0 2px";
          range.deleteContents(); range.insertNode(span);
          sel.removeAllRanges(); box.remove();
        } catch (e) { /* ignore */ }
      }
    });
    mountCover(box, range);
  }

  // ---------------- 点选模式（图标弹窗按钮，绕开禁右键 + 无需选中） ----------------
  function runPick() {
    document.querySelectorAll("[data-mojibake-cover],[data-mojibake-input],[data-mojibake-pickbar]").forEach((e) => e.remove());
    showPickBar();
  }

  function showPickBar() {
    const bar = document.createElement("div");
    bar.setAttribute("data-mojibake-pickbar", "1");
    bar.textContent = "请点击要解码的网页区块（Esc 取消）";
    applyDark();
    document.body.appendChild(bar);

    let done = false;
    function cleanup() {
      if (done) return;
      done = true;
      bar.remove();
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); cleanup(); }
    }
    function onDown(e) {
      if (done) return;
      const t = e.target;
      // 点到了插件自己的 UI（提示条 / 已有覆盖框 / 气泡 / 粘贴框）就忽略，让按钮照常工作
      if (t && t.closest && t.closest("[data-mojibake-cover],[data-mojibake-bubble],[data-mojibake-input],[data-mojibake-pickbar]")) return;
      e.preventDefault();
      e.stopPropagation();
      let block = null;
      try {
        const SEL = "div,p,section,article,li,blockquote,pre,td,main,header,footer,aside,dl,dd,dt,ul,ol,table,h1,h2,h3,h4,h5,h6";
        block = t.closest ? t.closest(SEL) : t;
      } catch (err) { block = t; }
      if (!block || block === document.body || block === document.documentElement) block = t;
      let text = "";
      try { text = (block.innerText || block.textContent || "").replace(/\s+/g, " ").trim(); } catch (err) {}
      cleanup();
      if (!text) {
        const tip = document.createElement("div");
        tip.setAttribute("data-mojibake-pickbar", "1");
        tip.textContent = "该区块没有可解码的文字";
        applyDark();
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 1500);
        return;
      }
      const res = recover(text);
      const box = buildCoverBox(res, { title: "乱码还原（整块解码）" });
      mountCover(box, block);
    }
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }

  // ---------------- 整页解码（图标弹窗按钮，一次性还原整个网页文字） ----------------
  function runPage() {
    document.querySelectorAll("[data-mojibake-cover],[data-mojibake-input],[data-mojibake-pickbar]").forEach((e) => e.remove());
    let text = "";
    try {
      text = (document.body.innerText || document.body.textContent || "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch (e) {}
    if (!text) {
      const tip = document.createElement("div");
      tip.setAttribute("data-mojibake-pickbar", "1");
      tip.textContent = "该页面没有可解码的文字";
      applyDark();
      document.body.appendChild(tip);
      setTimeout(() => tip.remove(), 1500);
      return;
    }
    const res = recover(text);
    const box = buildCoverBox(res, { title: "整页乱码还原结果" });
    box.style.left = "50%";
    box.style.top = "4%";
    box.style.transform = "translateX(-50%)";
    box.style.maxWidth = "92vw";
    const bodyEl = box.querySelector(".mb-body");
    if (bodyEl) bodyEl.style.maxHeight = "82vh";
    box._range = null;
    box._el = null;
    applyDark();
    document.body.appendChild(box);
  }

  function showInputBox() {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-mojibake-input", "1");
    const ta = document.createElement("textarea");
    ta.placeholder = "此页未选中文字，可在此粘贴乱码后点「解码」";
    const row = document.createElement("div");
    row.className = "mb-row";
    const go = makeBtn("解码");
    const cls = makeBtn("关闭", true);
    cls.onclick = () => wrap.remove();
    row.appendChild(go); row.appendChild(cls);
    wrap.appendChild(ta); wrap.appendChild(row);

    applyDark();
    document.body.appendChild(wrap);
    ta.focus();

    go.onclick = () => {
      const raw = ta.value;
      if (!raw.trim()) return;
      const res = recover(raw);
      wrap.remove();
      showResultPanel(res);
    };
  }

  function showResultPanel(res) {
    const box = buildCoverBox(res, { title: "乱码还原结果" });
    box.style.left = "50%";
    box.style.top = "18%";
    box.style.transform = "translateX(-50%)";
    box._range = null;
    box._el = null;
    applyDark();
    document.body.appendChild(box);
  }

  window.__mojibakeRun = function (mode) {
    ensureStyle();
    if (mode === "cover") runCover();
    else if (mode === "pick") runPick();
    else if (mode === "page") runPage();
    else runBubble();
  };
})();
