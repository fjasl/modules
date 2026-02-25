# 1px Pango 进度条实现方案

在 Waybar 中通过 Pango 标记渲染极细（1px）进度条。

## 核心原理

利用带 `background` 属性的空格 + `size='1024'`（1pt 字号） 来模拟一条极细的彩色线条。

```xml
<span size='1024'><span background='#ffff00'>   </span><span background='#333300'>     </span></span>
```

由于字号设为 1pt，空格实际高度极低，视觉上呈现为 1px 细线，不会撑高 Waybar 模块。

## 宽度计算

进度条的总宽度需与上方歌词的视觉宽度对齐。

```js
const getVisualWidth = (str) => {
    let w = 0;
    for (const char of str) w += (/[^\x00-\xff]/.test(char) ? 2 : 1);
    return w;
};
const lyricWidth = getVisualWidth(currentText);
```

- 中文/全角字符计 2 单位宽
- 英文/半角字符计 1 单位宽

由于进度条使用的是 1pt 字号，其空格单位宽度远小于正常字体。需要一个补偿系数（`widthScale`）将列宽换算为色块数量。

> 实测最佳系数为 **6.5**（依据具体系统字体而定，可微调）。

```js
const widthScale = 6.5;
const barWidth = Math.round(lyricWidth * widthScale);
```

## 生成函数

```js
/**
 * 生成 Pango 1px 进度条标记字符串
 * @param {number} progress  - 进度值 [0, 1]
 * @param {number} width     - 色块总数（由 lyricWidth * widthScale 得到）
 * @param {string} fillColor - 已播放部分的背景色（如 '#ffff00'）
 * @param {string} emptyColor- 未播放部分的背景色（如 '#333300'）
 * @returns {string} Pango markup 字符串
 */
function create1pxBar(progress, width, fillColor, emptyColor) {
    if (width <= 0) return '';
    const filledCount = Math.round(progress * width);
    const emptyCount = width - filledCount;

    const filledStr = filledCount > 0
        ? `<span background='${fillColor}'>${' '.repeat(filledCount)}</span>`
        : '';
    const emptyStr = emptyCount > 0
        ? `<span background='${emptyColor}'>${' '.repeat(emptyCount)}</span>`
        : '';

    return filledStr + emptyStr;
}
```

## 完整使用示例

```js
const lyricWidth = getVisualWidth(currentLyric); // 如 "你好 world" => 7
const widthScale = 6.5;
const barWidth = Math.round(lyricWidth * widthScale); // 45

const lineProgress = 0.6; // 当前行已播放 60%
const songProgress  = 0.3; // 全曲已播放 30%

// 黄色: 行进度 / 蓝色: 全曲进度
const barLine = create1pxBar(lineProgress, barWidth, '#ffff00', '#333300');
const barSong = create1pxBar(songProgress, barWidth, '#5294e2', '#1e2a3a');

const fullText = `${currentLyric}\n<span size='1024'>${barLine}</span>\n<span size='1024'>${barSong}</span>`;
```

## Waybar 配置要求

Waybar 模块需启用 `return-type: json`，Pango 标记将自动生效：

```jsonc
"custom/agplayer_info": {
    "exec": "socat ...",
    "return-type": "json",
    "interval": "once"
}
```
