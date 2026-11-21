// background.js — 仅负责创建右键菜单，并在点击时把解码脚本按需注入页面。
// 不监听页面、不常驻解码逻辑；只有用户主动点菜单才注入，满足「不自动运行」。

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "decode-selection",
    title: "解码选中乱码",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "decode-selection") return;
  if (!tab || !tab.id) return;
  // 按序注入：反向表 -> 解码器 -> 页面内逻辑（同一隔离世界，后者可直接用前者定义的全局函数）
  // 注入完成后调用 window.__mojibakeRun('bubble') 走「选区旁气泡」模式。
  chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      files: ["gbk_table.js", "decoder.js", "inline_decode.js"]
    })
    .then(() =>
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__mojibakeRun && window.__mojibakeRun("bubble")
      })
    )
    .catch((err) => console.error("注入解码脚本失败:", err));
});
