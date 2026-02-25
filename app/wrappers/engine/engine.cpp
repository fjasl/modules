#include "engine.h"
#include <fstream>
#include <iostream>
#include <sstream>

namespace engine {

Engine::Engine() {
  // 1. 地址缝合：让 m_status 里的指针永远指向内部私有实例的成员地盘
  // 这种做法实现了“单一数据源”，避免了数据在不同结构体间的冗余拷贝
  m_status.engine_player_properties = &player_core_.m_properties;
  m_status.engine_lyric_document = &lrc_core_.doc;

  // 2. 注册核心监听：当底层播放器属性变化时，第一时间触发 Engine 的统筹计算
  player_core_.setOnPropertiesChangedCallback(
      [this](const player::PlayerProperties &props) {
        handle_internal_update(props);
      });
}

Engine::~Engine() {}

bool Engine::engine_load(const std::string &songUrl,
                         const std::string &lrcUrl) {
  // 1. 自动从文件路径读取歌词内容 (不占用锁)
  std::string lrcContent = "";
  if (!lrcUrl.empty()) {
    std::ifstream file(lrcUrl);
    if (file.is_open()) {
      std::stringstream buffer;
      buffer << file.rdbuf();
      lrcContent = buffer.str();
    }
  }

  // 如果没有歌词，或者文件读取为空，提供默认提示
  if (lrcContent.empty()) {
    lrcContent = "[00:00.00] 纯音乐，请欣赏";
  }

  {
    // 2. 仅在修改内部状态和解析歌词时占用锁
    std::lock_guard<std::mutex> lock(status_mutex_);

    // 原地解析歌词：数据直接灌进被锚定的 lrc_core_.doc 中
    lrc_core_.parse(lrcContent);

    // 重置同步状态
    m_status.line_index = -1;
    m_status.line_progress = 0.0;
    m_status.word_index = -1;
    m_status.word_progress = 0.0;
  }

  // 3. 启动音频加载 (锁外执行)
  // 因为 load 会触发 updateState -> notifyPropertiesChanged ->
  // handle_internal_update 如果在锁内调用，会陷入自死锁。
  player_core_.load(songUrl);

  return true;
}

void Engine::handle_internal_update(const player::PlayerProperties &props) {
  // 核心：进度始终高频同步到共享内存，不区分逻辑变化
  auto queryResult = lyricer::LyricQuery::query(lrc_core_.doc, props.timePos);

  bool significant_changed = false;
  {
    std::lock_guard<std::mutex> lock(status_mutex_);

    // 1. 同步到共享内存结构体 (高频，静默)
    shared_state_.playback_state = static_cast<int>(props.state);
    shared_state_.time_pos = props.timePos;
    shared_state_.duration = props.duration;
    shared_state_.volume = props.volume;
    shared_state_.is_paused = props.isPaused ? 1 : 0;
    shared_state_.is_muted = props.isMuted ? 1 : 0;

    shared_state_.line_index = queryResult.currentLineIndex;
    shared_state_.line_progress = queryResult.lineProgress;
    shared_state_.word_index = queryResult.currentWordIndex;
    shared_state_.word_progress = queryResult.wordProgress;

    // 2. 检测低频“逻辑事件”：状态切换或歌词跳行
    if (props.state != m_last_player_state ||
        queryResult.currentLineIndex != m_last_line_index) {
      // 仅更新 status 镜像，供低频回调使用
      m_status.line_index = queryResult.currentLineIndex;
      m_status.word_index = queryResult.currentWordIndex;
      m_status.line_progress = queryResult.lineProgress;
      m_status.word_progress = queryResult.wordProgress;

      significant_changed = true;
    }
  }

  // 3. 分流通知 (逻辑事件独立，进度状态综合)
  if (props.state != m_last_player_state && on_state_change_) {
    std::cout << "State changed to: " << static_cast<int>(props.state)
              << std::endl;
    on_state_change_(props.state);
  }
  if (queryResult.currentLineIndex != m_last_line_index && on_line_change_) {
    on_line_change_(queryResult.currentLineIndex);
  }

  // 默认高频状态更新 (包含进度)
  if (on_status_update_) {
    on_status_update_(m_status);
  }

  // 更新上一状态缓存
  m_last_player_state = props.state;
  m_last_line_index = queryResult.currentLineIndex;
}

void Engine::set_on_status_update(
    std::function<void(const EngineStatus &)> cb) {
  on_status_update_ = cb;
}

void Engine::set_on_state_change(std::function<void(player::PlayerState)> cb) {
  on_state_change_ = cb;
}

void Engine::set_on_line_change(std::function<void(int)> cb) {
  on_line_change_ = cb;
}

// --- 控制指令透传：外界只接触 Engine 壳，不需要知道 player_core_ 的存在 ---
void Engine::engine_play() { player_core_.play(); }
void Engine::engine_pause() { player_core_.pause(); }
void Engine::engine_stop() { player_core_.stop(); }
void Engine::engine_seek(double seconds, bool relative) {
  player_core_.seek(seconds, relative);
}
void Engine::engine_setVolume(double volume) { player_core_.setVolume(volume); }
void Engine::engine_setMute(bool mute) { player_core_.setMute(mute); }

} // namespace engine
