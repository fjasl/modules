#include "LrcParser.h"
#include <cassert>
#include <iostream>

using namespace lyricer;

void printDoc(const LyricDocument &doc) {
  std::cout << "--- Parsed Document ---" << std::endl;
  std::cout << "Title: " << doc.title << std::endl;
  std::cout << "Artist: " << doc.artist << std::endl;

  for (const auto &line : doc.lines) {
    std::cout << "[" << line.start << "s -> " << (line.start + line.duration)
              << "s] ";
    if (line.isWordByWord) {
      std::cout << "(WordByWord) Text: " << line.text << "\n  Words: ";
      for (const auto &w : line.words) {
        std::cout << "{" << w.text << "@" << w.start << "s} ";
      }
      std::cout << std::endl;
    } else {
      std::cout << "(Standard) Text: " << line.text << std::endl;
    }
  }
  std::cout << "-----------------------\n" << std::endl;
}

void testStandardLrc() {
  std::string lrc = "[ti:Test Song]\n"
                    "[ar:Tester]\n"
                    "[00:01.50]Hello World\n"
                    "[00:05.00]This is a standard line\n"
                    "[00:10.00][00:20.00]Multi-time tag line\n";

  LyricDocument doc = LrcParser::parse(lrc);
  printDoc(doc);

  assert(doc.title == "Test Song");
  assert(doc.lines.size() == 4); // The last line creates two entries
  assert(doc.lines[0].text == "Hello World");
  assert(!doc.lines[0].isWordByWord);
}

void testWordByWordLrc() {
  std::string lrc = "[ti:Dynamic Song]\n"
                    "[00:01.00]<00:01.00>我<00:01.50><00:01.50>爱<00:02.00><00:"
                    "02.00>编<00:02.50><00:02.50>程<00:03.00>\n"
                    "[00:05.00]<00:05.10>C<00:05.50><00:05.50>+<00:06.00><00:"
                    "06.00>+<00:06.90>\n";

  LyricDocument doc = LrcParser::parse(lrc);
  printDoc(doc);

  assert(doc.lines.size() == 2);

  auto &line1 = doc.lines[0];
  assert(line1.isWordByWord);
  assert(line1.text == "我爱编程");
  assert(line1.words.size() == 4);
  assert(line1.words[0].text == "我");
  assert(line1.words[0].start == 1.0);
  assert(line1.words[0].duration == 0.5); // 1.5 - 1.0
  assert(line1.words[1].text == "爱");
  assert(line1.words[1].start == 1.5);
  assert(line1.words[1].duration == 0.5); // 2.0 - 1.5
}

#include "LyricQuery.h"

// ... existing tests ...

void testLyricQuery() {
  std::string lrc = "[ti:Query Song]\n"
                    "[00:01.00]<00:01.00>我<00:01.50><00:01.50>编<00:02.00>\n"
                    "[00:05.00]普通的整行歌词\n";
  LyricDocument doc = LrcParser::parse(lrc);

  // 测试 1: 时间 0s (还没开始唱)
  LyricQueryState state0 = LyricQuery::query(doc, 0.0);
  assert(!state0.hasValidLine);
  assert(state0.currentLineIndex == -1);

  // 测试 2: 时间 1.25s (唱到“我”字的中途，进度应该是 50%)
  LyricQueryState state1 = LyricQuery::query(doc, 1.25);
  assert(state1.hasValidLine);
  assert(state1.currentLineIndex == 0);
  assert(state1.currentWordIndex == 0); // "我"
  assert(state1.wordProgress == 0.5);   // (1.25 - 1.0) / (1.5 - 1.0) = 0.5

  // 测试 3: 时间 6s (唱到第二行普通歌词)
  LyricQueryState state2 = LyricQuery::query(doc, 6.0);
  assert(state2.hasValidLine);
  assert(state2.currentLineIndex == 1);
  assert(state2.currentWordIndex == -1); // 不是逐字歌词
}

int main() {
  std::cout << "Running Lyricer Tests...\n" << std::endl;

  testStandardLrc();
  testWordByWordLrc();
  testLyricQuery();

  std::cout << "All tests passed successfully!" << std::endl;
  return 0;
}
