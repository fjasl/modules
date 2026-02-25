#pragma once

#include "LyricTypes.h"
#include <string>

namespace lyricer {

/**
 * @class LrcParser
 * @brief 歌词解析器，负责将原始的 LRC 文本解析为结构化的 LyricDocument 数据。
 * 支持标准 LRC（非逐字）以及包含逐字时间戳的增强型动态 LRC 格式。
 */
class LrcParser {
public:
  LyricDocument doc;

public:
  /**
   * @brief 解析传入的 LRC 文本内容
   * @param lrcContent 从 .lrc 文件读取的完整文本字符串
   * @return
   * 解析后的歌词文档结构（即使解析失败个别行，也会返回尽量完整的数据）
   */
  bool parse(const std::string &lrcContent);

private:
  // 内部私有辅助解析方法
  void parseLine(const std::string &line);
  void parseMetadata(const std::string &tag, const std::string &value);

  // 解析时间戳字符串（如 "01:23.45" 或 "1:23.45"）为秒数
  double parseTime(const std::string &timeStr);

  // 尝试解析增强型逐字歌词格式
  // 这里以网易云等平台常见的 `<mm:ss.xx>词语` 或 `[mm:ss.xx](时长,词语)`
  // 格式为例进行启发式解析
  bool tryParseWordByWord(const std::string &contentText, double lineStart,
                          LineLyric &outLine);
};

} // namespace lyricer
