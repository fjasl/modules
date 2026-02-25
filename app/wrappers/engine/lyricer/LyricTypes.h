#pragma once

#include <string>
#include <vector>

namespace lyricer {

/**
 * @struct WordLyric
 * @brief 表示歌词中的单个字/词（用于支持逐字高亮的动态 LRC）。
 */
struct WordLyric {
  std::string text;      // 文本内容
  double start = 0.0;    // 起始时间 (秒)
  double duration = 0.0; // 持续时间 (秒)
};

/**
 * @struct LineLyric
 * @brief 表示一整行歌词。
 */
struct LineLyric {
  std::string text;      // 该行的完整纯文本
  double start = 0.0;    // 这行歌词的起始时间 (秒)
  double duration = 0.0; // 这行歌词的持续时间 (秒)

  // 如果为 true，表示这一行包含精确到每个字的时间信息（逐字 LRC）。
  // 如果为 false，words 数组将为空。
  bool isWordByWord = false;
  std::vector<WordLyric>
      words; // 组成该行的单个字列表（仅当 isWordByWord 为 true 时有效）
};

/**
 * @struct LyricDocument
 * @brief 解析后生成的完整歌词文档。
 * 包含歌曲元数据及按时间顺序排列的所有歌词行。
 */
struct LyricDocument {
  std::string title;   // 歌曲名 [ti:xxx]
  std::string artist;  // 歌手 [ar:xxx]
  std::string album;   // 专辑 [al:xxx]
  std::string by;      // 歌词制作者 [by:xxx]
  double offset = 0.0; // 全局时间偏移量 (秒) [offset:xxx]

  std::vector<LineLyric> lines; // 按时间正序排列的歌词行
};

} // namespace lyricer
