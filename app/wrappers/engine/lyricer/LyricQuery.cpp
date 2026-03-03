#include "LyricQuery.h"
#include <algorithm>

namespace lyricer {

LyricQueryState LyricQuery::query(const LyricDocument &doc,
                                  double timeSeconds) {
  LyricQueryState state;
  if (doc.lines.empty())
    return state;

  // 根据全局偏移量调整查询时间
  double adjustTime = timeSeconds - doc.offset;

  // 二分查找或顺序查找定位对应的 "行"
  // std::upper_bound 返回第一个其 start "大于" adjustTime 的元素游标
  auto it = std::upper_bound(
      doc.lines.begin(), doc.lines.end(), adjustTime,
      [](double val, const LineLyric &line) { return val < line.start; });

  // 如果所有的 start 都比 adjustTime 大（也就是还未唱到这一首歌的第一句）
  if (it == doc.lines.begin()) {
    return state; // 保持所有为 -1，无渲染
  }

  // `it - 1` 就是最后一个其 `start <= adjustTime` 的那一行游标
  --it;

  state.currentLineIndex = std::distance(doc.lines.begin(), it);
  state.hasValidLine = true;
  state.currentLine = *it;

  double lineStart = state.currentLine.start;
  double lineEnd = lineStart + state.currentLine.duration;

  // 如果传入的时间已经超过了这行的总长，说明处在两行中间的 "间奏" 或 "留白" 期
  if (adjustTime >= lineEnd && state.currentLine.duration > 0.0) {
    // 有些播放器策略是间奏期依然高亮上一句，或者重置状态。我们这里严格返回这句已结束
    state.lineProgress = 1.0;
    // 如果你需要间奏期不亮任何一句，也可以在这里强制设 currentLineIndex = -1
  } else {
    // 计算这一整行的进行进度百分比
    if (state.currentLine.duration > 0.0) {
      state.lineProgress =
          (adjustTime - lineStart) / state.currentLine.duration;
      state.lineProgress = std::max(0.0, std::min(1.0, state.lineProgress));
    } else {
      state.lineProgress = 1.0;
    }
  }

  // ====== 进入子查询：逐字歌词高光计算 ======
  if (state.currentLine.isWordByWord && !state.currentLine.words.empty()) {
    // 先假设都不亮或者是间隙
    state.currentWordIndex = -1;
    state.wordProgress = 0.0;

    double firstWordStart = state.currentLine.words.front().start;
    double lastWordEnd = state.currentLine.words.back().start +
                         state.currentLine.words.back().duration;
    double wordSpan = lastWordEnd - firstWordStart;

    // 1. 计算绝对行进度：基于字跨度
    if (wordSpan > 0.0) {
      state.lineProgress = std::max(
          0.0, std::min(1.0, (adjustTime - firstWordStart) / wordSpan));
    } else {
      state.lineProgress = 1.0;
    }

    // 2. 查找当前正在唱的字索引及字内进度
    for (size_t i = 0; i < state.currentLine.words.size(); ++i) {
      const auto &word = state.currentLine.words[i];
      double wStart = word.start;
      double wEnd = word.start + word.duration;

      if (adjustTime >= wStart && adjustTime < wEnd) {
        state.currentWordIndex = static_cast<int>(i);
        if (word.duration > 0.0) {
          state.wordProgress = (adjustTime - wStart) / word.duration;
        } else {
          state.wordProgress = 1.0;
        }
        break;
      }
    }
  }

  return state;
}

} // namespace lyricer
