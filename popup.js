// popup.js — 弹出窗逻辑：自动填入选中文本，点「解码」才运行还原。
(function () {
  const inp = document.getElementById("inp");
  const out = document.getElementById("out");
  const loss = document.getElementById("loss");
  const btnDecode = document.getElementById("decode");
  const btnCopy = document.getElementById("copy");
  const btnCover = document.getElementById("cover");
  const btnPick = document.getElementById("pick");
  const btnPage = document.getElementById("page");

  // 打开弹窗时，向当前标签页的内容脚本请求选中的文本
  function fillSelection() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      chrome.tabs.sendMessage(tab.id, { type: "getSelection" }, (resp) => {
        if (chrome.runtime.lastError) return; // 页面无内容脚本（如 edge:// 内部页）时静默跳过
        const text = (resp && resp.text) || "";
        if (text && !inp.value) inp.value = text;
      });
    });
  }

  btnDecode.addEventListener("click", () => {
    const raw = inp.value || "";
    if (!raw.trim()) {
      out.value = "";
      loss.textContent = "请先粘贴或选中乱码。";
      btnCopy.disabled = true;
      return;
    }
    const res = recover(raw);
    out.value = res.text;
    btnCopy.disabled = !res.text;
    loss.textContent = res.lost > 0
      ? `注意：${res.lost} 处因原字节丢失无法还原，已用「?」标记。`
      : "完美还原，无丢失。";
  });

  btnCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(out.value);
      const old = btnCopy.textContent;
      btnCopy.textContent = "已复制";
      setTimeout(() => (btnCopy.textContent = old), 1200);
    } catch (e) {
      // 某些环境 clipboard 受限，退回传统方法
      out.select();
      document.execCommand("copy");
    }
  });

  // 在页面上覆盖显示：注入解码脚本后调用 cover 模式。不依赖右键菜单，适合禁右键的页面。
  btnCover.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      btnCover.textContent = "注入中…";
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          files: ["gbk_table.js", "decoder.js", "inline_decode.js"]
        })
        .then(() =>
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.__mojibakeRun && window.__mojibakeRun("cover")
          })
        )
        .then(() => window.close())
        .catch(() => {
          btnCover.textContent = "此页不支持（如 edge:// 内部页）";
          setTimeout(() => (btnCover.textContent = "在页面覆盖显示"), 2000);
        });
    });
  });

  // 点选网页区块解码：注入脚本后进入「点选模式」，用户在页面点任意区块即自动解码整块文字。
  // 不依赖选区、也不依赖右键菜单，适合禁右键的页面。
  btnPick.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      btnPick.textContent = "注入中…";
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          files: ["gbk_table.js", "decoder.js", "inline_decode.js"]
        })
        .then(() =>
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.__mojibakeRun && window.__mojibakeRun("pick")
          })
        )
        .then(() => window.close())
        .catch(() => {
          btnPick.textContent = "此页不支持（如 edge:// 内部页）";
          setTimeout(() => (btnPick.textContent = "点选网页区块解码"), 2000);
        });
    });
  });

  // 整页解码：注入脚本后取整个 body 的文字一次性还原，居中大窗口显示。
  btnPage.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      btnPage.textContent = "注入中…";
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          files: ["gbk_table.js", "decoder.js", "inline_decode.js"]
        })
        .then(() =>
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.__mojibakeRun && window.__mojibakeRun("page")
          })
        )
        .then(() => window.close())
        .catch(() => {
          btnPage.textContent = "此页不支持（如 edge:// 内部页）";
          setTimeout(() => (btnPage.textContent = "整页解码"), 2000);
        });
    });
  });

  fillSelection();
})();
