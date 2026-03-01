#pragma once

#include "PlayerTypes.h"
#include <atomic>
#include <condition_variable>
#include <functional>
#include <mpv/client.h>
#include <mutex>
#include <string>
#include <thread>

namespace player {

/**
 * @class PlayerCore
 * @brief 基于 libmpv 的跨平台核心播放器控制模块。
 *
 * 本类负责封装 libmpv 的 C API，将其转换为易于使用的面向对象 C++ 接口。
 * 它采用无阻塞的异步事件驱动架构：
 * 1. 控制指令（play, pause, seek）是非阻塞投递的。
 * 2. `libmpv`
 * 发生的状态变更（时间推移、缓冲、错误等）将触发主动回调（Event-Driven
 * Wakeup）， 再由内部独立的 worker_thread 进行处理，完全不消耗主线程/UI
 * 线程的性能。
 * 3. 剥离了纯 UI 展现层面，只专注于维护 `PlayerState` 状态转移及
 * `PlayerProperties` 属性更新。
 */
class PlayerCore {

public:
  PlayerProperties m_properties;

public:
  PlayerCore();
  ~PlayerCore();

  // 禁用拷贝和赋值构造（保证底层 mpv 句柄及资源的独占性和生命周期安全）
  PlayerCore(const PlayerCore &) = delete;
  PlayerCore &operator=(const PlayerCore &) = delete;

  // ==========================================
  // --- 媒体控制接口 (非阻塞，异步执行) ---
  // ==========================================

  /**
   * @brief 加载并播放指定的媒体资源
   * @param url 可以是本地文件绝对路径，也可以是 HTTP/HTTPS网络流，或者 rtmp
   * 等协议地址
   */
  void load(const std::string &url);
  /**
   * @brief 播放/恢复
   */
  void play();

  /**
   * @brief 暂停
   */
  void pause();

  /**
   * @brief 在播放和暂停状态之间切换
   */
  // void togglePause();

  /**
   * @brief 停止当前播放（将触发 State::Stopped）
   */
  void stop();

  /**
   * @brief 跳转到指定时间
   * @param seconds 目标时间（秒）。可以是小数，以实现毫秒级跳转。
   * @param relative 是否为相对跳转：默认 false 表示绝对跳转(跳到第N秒)；true
   * 表示相对跳转(向前/向后快进N秒)
   */
  void seek(double seconds, bool relative = false);

  /**
   * @brief 设置播放音量
   * @param volume 范围推荐为 0.0 到 100.0 (支持超出 100 实现软件放大)
   */
  void setVolume(double volume);

  /**
   * @brief 设置是否静音
   */
  void setMute(bool mute);

  // ==========================================
  // --- 回调设置（用于通知外部 UI 或 JS 桥接层） ---
  // ==========================================

  /**
   * @brief 注册属性变化全局回调
   *
   * 无论是时间走动、音量改变、还是状态变更，只要内部 PlayerProperties
   * 快照发生任意改变， 均会触发此回调（高频信号）。通常在此处强制驱动 UI
   * 界面全体刷新。
   */
  void setOnPropertiesChangedCallback(
      std::function<void(const PlayerProperties &)> cb);

  /**
   * @brief 注册核心状态变化独立回调
   *
   * 只在宏观的 PlayerState 发生切换时（如 Playing -> Paused，或 Idle ->
   * Loading）触发。 适合用于处理如显示加载框、弹出错误提示等重量级 UI 逻辑。
   */
  void setOnStateChangedCallback(std::function<void(PlayerState)> cb);

  // ==========================================
  // --- 数据获取 ---
  // ==========================================

  /**
   * @brief 同步获取当前播放属性快照（拷贝）
   */
  PlayerProperties getProperties() const;

private:
  // ==========================================
  // --- 底层实例与并发机制 ---
  // ==========================================
  mpv_handle *m_mpv = nullptr; // libmpv 核心上下文句柄

  // 后台工作线程与通信通知锁
  // libmpv 会在 C 线程内发出信号，这里的 cv 将负责在不空耗 CPU
  // 的前提下唤醒我们的 C++ processEvents 处理流
  std::thread m_workerThread;
  std::mutex m_mutex;
  std::condition_variable m_cv;
  std::atomic<bool> m_running{false};
  std::atomic<bool> m_hasEvent{false};

  // 状态维护与数据保护

  // 使用可重入互斥锁 (recursive_mutex)，因为在 handlePropertyChange
  // 内部更新属性时 可能会调用同样需要获取这把锁的 updateState
  // 方法，如果使用普通 mutex 会引发死锁。 现在 m_propertiesMutex
  // 是可重入锁，但这只是一个提醒。
  // 此处简化，如果只读不加锁可能会有读不一致问题但不会崩溃。为严谨起见，我们暂且返回一份可能稍微不一致的快照。
  std::recursive_mutex m_propertiesMutex;

  // 已注册的外部回调函数持有区
  std::function<void(const PlayerProperties &)> m_onPropertiesChanged;
  std::function<void(PlayerState)> m_onStateChanged;

private:
  // ==========================================
  // --- 私有核心处理方法 ---
  // ==========================================
  void initializeMpv();
  static void
  wakeupCallback(void *userData); // libmpv 门铃回调函数（触发条件变量通知）
  void processEvents();           // 被包裹在后台线程中的死循环：负责拉取事件
  void handleMpvEvent(mpv_event *event); // 分发 MPV_EVENT_
  void handlePropertyChange(
      mpv_event_property *prop);          // 解析 MPV_EVENT_PROPERTY_CHANGE
  void updateState(PlayerState newState); // 线程安全地切换业务状态并向外投递
  void notifyPropertiesChanged();         // 向外广播属性快照
};

} // namespace player
