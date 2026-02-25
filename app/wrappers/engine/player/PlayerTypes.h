#pragma once

#include <string>

namespace player {

/**
 * @brief 播放器状态枚举
 *
 * 描述播放器生命周期中的核心工作状态。此状态机限制了在特定状态下允许执行的操作。
 * 建议在前端 UI 层对不同状态做出对应的响应（例如：Loading/Buffering
 * 时显示转圈）。
 */
enum class PlayerState {
  Idle,      // 空闲状态：播放器准备就绪，但尚未加载任何媒体文件或流。
  Loading,   // 加载状态：正在解析媒体 URL 或读取本地文件头，准备建立连接。
  Buffering, // 缓冲状态：网络流加载中，或本地解码缓冲枯竭，正在努力填充解码数据。
  Playing,   // 播放状态：媒体正在正常平滑播放。
  Paused,    // 暂停状态：播放已主动挂起。
  Stopped,   // 停止状态：当前播放已结束，或被主动终止（EOF）。
  Error // 错误状态：在加载或播放过程中遇到了致命异常（如网络中断、格式不支持）。
};

/**
 * @brief 播放器全局属性聚合
 *
 * 一个包含播放器当前所有关键可读信息的快照结构体。
 * 该结构通常通过回调高频发送给前端
 * UI，用于实时更新进度条、音量图标、播放/暂停按钮等。
 */
struct PlayerProperties {
  PlayerState state = PlayerState::Idle;
  double timePos = 0.0;     // 当前播放时间 (秒)
  double duration = 0.0;    // 总时长 (秒)
  double volume = 100.0;    // 音量 (0-130 或更高，默认100)
  bool isPaused = false;    // 是否暂停
  bool isMuted = false;     // 是否静音
  bool isCoreIdle = true;   // 核心是否空闲 (常用于判断是否在 Buffering 或 EOF)
  std::string currentMedia; // 当前媒体路径/URL
};

} // namespace player
