// decoder.js — GBK-mojibake 还原核心算法（浏览器端纯 JS 实现）
//
// 原理（与已验证的 Python recover 管线逐字节一致）：
//   原始 UTF-8 中文被错误地按 GBK 解码，得到一堆「銆銆…」乱码。
//   还原 = 把乱码重新编码回 GBK 字节流，再按 UTF-8 流式解码回去。
//   难点：浏览器没有原生 GBK 编码，故用 gbk_table.js 提供的反向表
//   （unicode 码点 -> 2 字节 GBK）来重建字节流。
//
// 注意：原 UTF-8 字节中若含 0x80 这类无法作为 GBK 引导/随从字节的值，
//   当初被错译时就已经被丢弃，对应位置会丢掉一个汉字，无法还原，用 '?' 标记。

// gbkBytesFromCodePoint 来自 gbk_table.js（浏览器全局 / Node require 均可）

const LOST_SENTINEL = 0xFF; // GBK 字节流中不可能出现 0xFF，用作「丢失字节」标记

function recover(garbled) {
  // 1) 把乱码字符串还原成原始字节流
  const bytes = [];
  let lost = 0;
  for (const ch of garbled) {
    const cp = ch.codePointAt(0);
    const g = gbkBytesFromCodePoint(cp);
    if (g === null) {
      if (cp < 0x80) {
        bytes.push(cp); // 普通 ASCII 单字节
      } else {
        // 既非 ASCII、又不在 GBK 表中（如 €、私有区占位符）→ 一个汉字已丢失
        lost++;
        bytes.push(LOST_SENTINEL);
      }
    } else {
      for (const b of g) bytes.push(b);
    }
  }

  // 2) 按 UTF-8 流式解码（支持 1/2/3/4 字节，与原始 UTF-8 字节流完全对应）
  const out = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      out.push(String.fromCharCode(b));
      i++;
      continue;
    }
    if (b === LOST_SENTINEL) {
      out.push("?"); // 可见地标记一个无法还原的汉字
      i++;
      continue;
    }
    let len = 0, cp = 0, ok = false;
    if ((b & 0xE0) === 0xC0 && i + 1 < n && (bytes[i + 1] & 0xC0) === 0x80) {
      cp = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F);
      len = 2; ok = true;
    } else if ((b & 0xF0) === 0xE0 && i + 2 < n &&
               (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
      cp = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
      len = 3; ok = true;
    } else if ((b & 0xF8) === 0xF0 && i + 3 < n &&
               (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80 &&
               (bytes[i + 3] & 0xC0) === 0x80) {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) |
           ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
      len = 4; ok = true;
    }
    if (ok) {
      out.push(String.fromCodePoint(cp));
      i += len;
    } else {
      i++; // 非法引导字节（如孤立的续字节）→ 跳 1 字节
    }
  }
  return { text: out.join(""), lost };
}

// 浏览器中作为全局函数；Node 测试中导出
if (typeof module !== "undefined" && module.exports) {
  module.exports = { recover, LOST_SENTINEL };
}
