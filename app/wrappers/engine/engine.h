#pragma once

#include "engine_types.h"
#include "lyricer/LrcParser.h"
#include "lyricer/LyricQuery.h"
#include "player/PlayerCore.h"
#include <functional>
#include <mutex>

namespace engine {

class Engine {
public:
  Engine();
  ~Engine();

  // 外部交互接口：外界只知道 engine_XXX，不知道底层是谁实现的
  bool engine_load(const std::string &songUrl, const std::string &lrcUrl);
  void engine_play();
  void engine_pause();
  void engine_stop();
  void engine_seek(double seconds, bool relative = false);
  void engine_setVolume(double volume);
  void engine_setMute(bool mute);

  // 通知外界：状态变了
  void set_on_status_update(std::function<void(const EngineStatus &)> cb);
  void set_on_state_change(std::function<void(player::PlayerState)> cb);
  void set_on_line_change(std::function<void(int)> cb);

private:
  // 底层模块实例：保持私有，被 Engine 保护起来
  player::PlayerCore player_core_;
  lyricer::LrcParser lrc_core_;

  // 核心：虽然这些是私有的，但 EngineStatus 里的指针可以指向它们
  EngineStatus m_status;

  std::mutex status_mutex_;
  std::function<void(const EngineStatus &)> on_status_update_;
  std::function<void(player::PlayerState)> on_state_change_;
  std::function<void(int)> on_line_change_;

  void handle_internal_update(const player::PlayerProperties &props);

public:
  // 获取共享内存指针供 Node.js 映射
  SharedEngineState *get_shared_state_ptr() { return &shared_state_; }

  // 获取完整的歌词文档（用于 N-API 一次性传输）
  const lyricer::LyricDocument &get_lyric_doc() { return lrc_core_.doc; }

private:
  player::PlayerState m_last_player_state = player::PlayerState::Stopped;
  int m_last_line_index = -1;

  SharedEngineState shared_state_; // 二进制共享状态
};

} // namespace engine
