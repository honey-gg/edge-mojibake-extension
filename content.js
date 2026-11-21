// content.js — 仅在被 popup 主动询问时才读取选中文本，平时不做任何事。
// 不自动运行解码逻辑，满足「看到乱码再点一下」的需求。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "getSelection") {
    const text = (window.getSelection && window.getSelection().toString()) || "";
    sendResponse({ text });
  }
  return true; // 保持消息通道开放以支持异步 sendResponse
});
