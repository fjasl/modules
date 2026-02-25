#pragma once

#include "LyricTypes.h"

namespace lyricer {

/**
 * @struct LyricQueryState
 * @brief 描述在某一特定时间点下，歌词的高亮播放状态。
 * 这个结构体将通过查询获得，是驱动 UI
 * 渲染（卡拉OK效果或滚动高亮）的直接数据源。
 */
struct LyricQueryState {
  int currentLineIndex = -1; // 当前正在唱的行号（-1 表示还未开始或者没有歌词）
  int currentWordIndex =
      -1; // 当前这一行正在唱的字号（-1 表示不在任何字的区间内，或不是逐字歌词）

  // 以下进度均为 0.0 ~ 1.0 的百分比：
  double lineProgress = 0.0; // 这一整行的演唱进度（可选，用于行级遮罩）
  double wordProgress =
      0.0; // 当前正在唱的“字”的演唱进度（用于精确到字的颜料填充动画）

  // 快捷引用（仅当 Index 合法时有效，否则为空对象或未定义结果，UI 侧按需获取）
  bool hasValidLine = false;
  LineLyric currentLine;
};

/**
 * @class LyricQuery
 * @brief 歌词状态查询引擎。
 * 提供纯粹的、无状态的算法接口：输入“完整歌词数据”和“当前时间”，返回“应该高亮的高精度状态数据”。
 */
class LyricQuery {
public:
  /**
   * @brief 根据给定时间查询当前歌词状态。
   * @param doc 预先解析好的歌词文档数据。
   * @param timeSeconds 当前播放进度（秒）。
   * @return 详尽的高亮进度和索引状态 `LyricQueryState`。
   */
  static LyricQueryState query(const LyricDocument &doc, double timeSeconds);
};

} // namespace lyricer
