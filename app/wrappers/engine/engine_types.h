#pragma once

#include "lyricer/LyricTypes.h"
#include "player/PlayerTypes.h"
#include <string>

namespace engine {

struct EngineStatus {
  // 单一数据源：指向模块内部实体
  const player::PlayerProperties *engine_player_properties = nullptr;
  const lyricer::LyricDocument *engine_lyric_document = nullptr;

  // Engine 层面的计算结果
  int line_index = -1;
  double line_progress = 0.0;

  int word_index = -1;        // 用户要求的字段
  double word_progress = 0.0; // 用户要求的字段
};

/**
 * @struct SharedEngineState
 * @brief 内存对齐的结构体，用于 Node.js 与 C++ 之间的“零拷贝”数据共享。
 * 此结构体通过 Napi::Buffer 直接映射到 JS 侧，JS 可以通过 DataView 或
 * TypedArray 极高频率地读取而无需经过 N-API 转换。
 */
#pragma pack(push, 1)
struct SharedEngineState {
  // 播放器状态 (4 bytes, 对应 player::PlayerState)
  int playback_state;
  double time_pos;
  double duration;
  double volume;
  char is_paused;
  char is_muted;

  // 歌词同步状态
  int line_index;
  double line_progress;
  int word_index;
  double word_progress;
};
#pragma pack(pop)

} // namespace engine