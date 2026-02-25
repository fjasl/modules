#include "LrcParser.h"
#include <algorithm>
#include <iostream>
#include <regex>
#include <sstream>

namespace lyricer {

bool LrcParser::parse(const std::string &lrcContent) {

  this->doc.title.clear();
  this->doc.artist.clear();
  this->doc.album.clear();
  this->doc.by.clear();
  this->doc.offset = 0.0;
  this->doc.lines.clear();

  std::istringstream stream(lrcContent);
  std::string line;

  // 按行读取 LRC 文本
  while (std::getline(stream, line)) {
    // 去除行末可能存在的回车符 \r
    if (!line.empty() && line.back() == '\r') {
      line.pop_back();
    }

    // 忽略空行
    if (line.empty()) {
      continue;
    }

    parseLine(line);
  }

  // 后处理：计算每行歌词的持续时间 (duration)
  // 按照时间对歌词行进行排序，以防 LRC 文件中时间戳乱序
  std::sort(
      this->doc.lines.begin(), this->doc.lines.end(),
      [](const LineLyric &a, const LineLyric &b) { return a.start < b.start; });

  // 严格根据下一行开始时间计算当前行持续时间
  for (size_t i = 0; i < this->doc.lines.size(); ++i) {
    if (i < this->doc.lines.size() - 1) {
      double diff = this->doc.lines[i + 1].start - this->doc.lines[i].start;
      this->doc.lines[i].duration = std::max(0.0, diff);
    } else {
      // 最后一句默认给一个较长的持续时间，比如 10 秒
      this->doc.lines[i].duration = 10.0;
    }
  }

  return true;
}

void LrcParser::parseLine(const std::string &line) {
  // 尝试匹配元数据标签行，例如：[ti:Song Title]
  static const std::regex metaRegex(R"(\[([a-z]+):([^\]]+)\])");
  std::smatch metaMatch;

  // 先尝试整行匹配是否纯元数据
  if (std::regex_match(line, metaMatch, metaRegex)) {
    parseMetadata(metaMatch[1].str(), metaMatch[2].str());
    return;
  }

  // 尝试提取时间标签和后续正文
  // 增强正则：支持变长数字、小时、分钟、秒以及多个冒号，例如: [01:23:45.67] 或
  // [02:34]
  static const std::regex timeTagRegex(R"(\[((?:\d+:)*\d+(?:\.\d+)?)\])");

  std::vector<double> startTimes;
  std::string textContent = line;

  auto wordsBegin =
      std::sregex_iterator(line.begin(), line.end(), timeTagRegex);
  auto wordsEnd = std::sregex_iterator();

  for (std::sregex_iterator i = wordsBegin; i != wordsEnd; ++i) {
    std::smatch match = *i;
    startTimes.push_back(parseTime(match[1].str()));
  }

  // 将时间标签从原始内容中剔除，剩下的就是我们需要处理的整行文本
  if (!startTimes.empty()) {
    textContent = std::regex_replace(line, timeTagRegex, "");

    // 去除可能的首位空格
    textContent.erase(0, textContent.find_first_not_of(" \t"));
    textContent.erase(textContent.find_last_not_of(" \t") + 1);

    for (double start : startTimes) {
      LineLyric lineLyric;
      lineLyric.start = start;
      lineLyric.text =
          textContent; // 这个 text 可能还包含了带时间格式的乱七八糟标签

      // 尝试对剩余文本进行增强型逐字解析
      // 如果解析失败，说明它是普通歌词
      if (!tryParseWordByWord(textContent, start, lineLyric)) {
        lineLyric.isWordByWord = false;
        // 如果没有逐字时间，确保 clean 这行纯文本以供显示
        // (有些格式可能会把 <00:01> 直接当成纯文本传入
        // tryParseWordByWord，需要在此处退化清除)
        static const std::regex wordTagRegex(R"(<[^>]+>)");
        lineLyric.text = std::regex_replace(textContent, wordTagRegex, "");
      }

      this->doc.lines.push_back(lineLyric);
    }
  }
}

void LrcParser::parseMetadata(const std::string &tag,
                              const std::string &value) {
  if (tag == "ti")
    this->doc.title = value;
  else if (tag == "ar")
    this->doc.artist = value;
  else if (tag == "al")
    this->doc.album = value;
  else if (tag == "by")
    this->doc.by = value;
  else if (tag == "offset") {
    try {
      this->doc.offset = std::stod(value) / 1000.0; // offset 是毫秒，转为秒
    } catch (...) {
      // parse offset error, ignore
    }
  }
}

double LrcParser::parseTime(const std::string &timeStr) {
  // 通用格式解析：支持 hh:mm:ss.ms 或 mm:ss.ms 或 ss.ms 甚至更多层级
  double totalSeconds = 0.0;
  std::vector<std::string> parts;
  std::stringstream ss(timeStr);
  std::string segment;

  while (std::getline(ss, segment, ':')) {
    parts.push_back(segment);
  }

  // 从右往左解析：秒、分、时...
  double unitMultiplier = 1.0;
  for (int i = static_cast<int>(parts.size()) - 1; i >= 0; --i) {
    try {
      double value = std::stod(parts[i]);
      totalSeconds += value * unitMultiplier;
      unitMultiplier *= 60.0;
    } catch (...) {
      // 遇到无法解析的部分，忽略
    }
  }

  return totalSeconds;
}

// 解析典型的逐字歌词语法：<mm:ss.xx>词语<mm:ss.xx>
// 用户的目标特定格式：<start>word<end>，例如 <00:01.00>我<00:01.50>
bool LrcParser::tryParseWordByWord(const std::string &contentText,
                                   double lineStart, LineLyric &outLine) {
  // 更新逐字解析正则，同样支持灵活的时间戳格式
  static const std::regex wordRegex(
      R"(<((?:\d+:)*\d+(?:\.\d+)?)>([^<]+)<((?:\d+:)*\d+(?:\.\d+)?)>)");

  auto begin =
      std::sregex_iterator(contentText.begin(), contentText.end(), wordRegex);
  auto end = std::sregex_iterator();

  if (begin == end) {
    // 在这行文本里没有找到任何带 <> 标签的逐字标识
    return false;
  }

  outLine.isWordByWord = true;
  outLine.words.clear();

  // 用于重构这行干净文本（不含时间标签的代码）
  std::string pureText = "";

  for (std::sregex_iterator i = begin; i != end; ++i) {
    std::smatch match = *i;

    WordLyric word;
    word.start = parseTime(match[1].str());
    word.text = match[2].str();

    // 根据结束标签立刻算出当前字的精确停留时间
    double endTime = parseTime(match[3].str());
    word.duration = endTime - word.start;

    // 将歌词拼接到行的纯文本上
    pureText += word.text;

    outLine.words.push_back(word);
  }

  outLine.text = pureText;

  return true;
}

} // namespace lyricer
