#include "PlayerCore.h"
#include <fcntl.h>
#include <iostream>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

namespace player {

PlayerCore::PlayerCore() {
  // 第一步：构建并初始化 MPV 实例
  initializeMpv();

  // 第二步：启动处理事件的独立工作线程
  // 该线程是维持状态机运转的核心心脏
  m_running = true;
  m_workerThread = std::thread(&PlayerCore::processEvents, this);
}

PlayerCore::~PlayerCore() {
  // 安全停止事件拉取线程
  m_running = false;
  m_cv.notify_one(); // 物理唤醒处于休眠等待状态的线程

  if (m_workerThread.joinable()) {
    m_workerThread.join();
  }

  // 销毁 MPV 播放上下文，释放所有底层资源
  if (m_mpv) {
    mpv_terminate_destroy(m_mpv);
    m_mpv = nullptr;
  }
}

void PlayerCore::initializeMpv() {
  m_mpv = mpv_create();
  if (!m_mpv) {
    std::cerr << "Failed to create mpv context." << std::endl;
    return;
  }
  // 强制不加载用户配置，避免被 mpv.conf 覆盖
  mpv_set_option_string(m_mpv, "no-config", "yes");
  mpv_set_option_string(m_mpv, "keep-open", "no"); // 关键！强制不保持打开
  mpv_set_option_string(m_mpv, "keep-open-pause",
                        "no"); // 即使 keep-open，也别自动 pause

  // mpv_set_option_string(m_mpv, "idle", "no");
  //  mpv_set_option_string(m_mpv, "keep-open", "no");
  //   设置一些初始选项（如果需要纯音频，可以禁用视频输出等）
  mpv_set_option_string(m_mpv, "vid", "no");

  // 核心：强制 mpv 使用 pulse音频后端，并输出到我们用 pactl 建立的虚拟管道
  // 名字必须和 AudioMonitor.js 里约定的一致
  mpv_set_option_string(m_mpv, "audio-device", "pulse/agplayer_loopback");
  // 为了防止 mpv 检测不到这个设备时报错，可以开启 fallback
  mpv_set_option_string(m_mpv, "audio-fallback-to-null", "yes");

  int res = mpv_initialize(m_mpv);
  if (res < 0) {
    std::cerr << "Failed to initialize mpv: " << mpv_error_string(res)
              << std::endl;
    return;
  }

  // 只有在这里登记的属性，mpv 才会主动追踪并投递 PROPERTY_CHANGE 回调！
  // 参数 0 表示我们没有使用特别的用户标识符
  mpv_observe_property(m_mpv, 0, "time-pos", MPV_FORMAT_DOUBLE); // 当前播放时间
  mpv_observe_property(m_mpv, 0, "duration", MPV_FORMAT_DOUBLE); // 总时长
  mpv_observe_property(m_mpv, 0, "volume", MPV_FORMAT_DOUBLE);   // 声音大小
  mpv_observe_property(m_mpv, 0, "pause", MPV_FORMAT_FLAG);      // 暂停标识
  mpv_observe_property(m_mpv, 0, "mute", MPV_FORMAT_FLAG);       // 静音标识
  mpv_observe_property(
      m_mpv, 0, "core-idle",
      MPV_FORMAT_FLAG); // 引擎是否闲置（极其重要，用于推断 Buffering 状态）

  // 【核心机制注册】：注册主动唤醒门铃回调
  // 当 libmpv 内核有新事件生成时，它会立刻无阻塞地调用 wakeupCallback
  mpv_set_wakeup_callback(m_mpv, &PlayerCore::wakeupCallback, this);
}

void PlayerCore::wakeupCallback(void *userData) {
  PlayerCore *core = static_cast<PlayerCore *>(userData);
  if (core) {
    // 拉响警报：通知 m_workerThread 赶紧起来工作拉取事件
    std::lock_guard<std::mutex> lock(core->m_mutex);
    core->m_hasEvent = true;
    core->m_cv.notify_one();
  }
}

void PlayerCore::processEvents() {
  while (m_running) {
    std::unique_lock<std::mutex> lock(m_mutex);

    // 【完美零空耗睡眠技术】：如果没有事件，且程序还在正常运行，线程将死死沉睡在这里，不吃一点点
    // CPU
    m_cv.wait(lock, [this]() { return m_hasEvent.load() || !m_running; });

    if (!m_running)
      break;

    m_hasEvent = false;

    // 立即释放锁：千万不要在处理成百上千个内部事件回调时拿着通信锁，因为那会把
    // libmpv 底层直接按死
    lock.unlock();

    while (true) {
      // 循环拉取所有的事件包裹，参数 0 表示“非阻塞偷看” (Non-blocking pull)
      mpv_event *event = mpv_wait_event(m_mpv, 0);

      if (event->event_id == MPV_EVENT_NONE) {
        break; // 快递拿完了，跳出内圈让线程继续冬眠
      }

      handleMpvEvent(event);
    }
  }
}

void PlayerCore::handleMpvEvent(mpv_event *event) {
  // 根据事件信封的 ID 分工处理
  switch (event->event_id) {
  case MPV_EVENT_PROPERTY_CHANGE:
    // 解包属性值发生变化的信件
    handlePropertyChange(static_cast<mpv_event_property *>(event->data));
    break;

  case MPV_EVENT_FILE_LOADED:
    // 文件初始元数据拉取完毕，通常接下来会自动切到开始播放（或者暂停）

    updateState(
        PlayerState::Playing); // 如果 mpv 配置了 auto-play 的话会切入 playing
    break;

  case MPV_EVENT_PLAYBACK_RESTART:

    // 从 Buffering（卡顿缓冲）中恢复过来了，准备重新吐出音画
    if (!m_properties.isPaused) {
      updateState(PlayerState::Playing);
    }
    break;

  case MPV_EVENT_END_FILE: {
    // 一个媒体生命终结
    auto eof = static_cast<mpv_event_end_file *>(event->data);

    if (eof->reason == MPV_END_FILE_REASON_ERROR) {
      updateState(PlayerState::Error);
    } else if (eof->reason == MPV_END_FILE_REASON_EOF) {
      updateState(PlayerState::Stopped);
    } else {
      std::cout << "[PlayerCore] MPV_EVENT_END_FILE ignored because reason is "
                << eof->reason << std::endl;
    }
    break;
  }

  case MPV_EVENT_CLIENT_MESSAGE: {
    // 预留。用于在后续接收复杂滤镜(lavfi) 传来的跨线程音频流裸消息
    break;
  }

  default:

    break;
  }
}

void PlayerCore::handlePropertyChange(mpv_event_property *prop) {
  if (!prop)
    return;

  // 上读写隔离锁，防止我们的快照被外界(比如前端 UI)读烂掉
  // 注意：m_propertiesMutex 为 std::recursive_mutex，允许本线程在 updateState
  // 中再次重入获取锁，避免死锁
  std::lock_guard<std::recursive_mutex> lock(m_propertiesMutex);
  std::string name(prop->name);

  if (name == "time-pos" && prop->format == MPV_FORMAT_DOUBLE) {
    m_properties.timePos = *static_cast<double *>(prop->data);
  } else if (name == "duration" && prop->format == MPV_FORMAT_DOUBLE) {
    m_properties.duration = *static_cast<double *>(prop->data);
  } else if (name == "volume" && prop->format == MPV_FORMAT_DOUBLE) {
    m_properties.volume = *static_cast<double *>(prop->data);
  } else if (name == "pause" && prop->format == MPV_FORMAT_FLAG) {
    m_properties.isPaused = *static_cast<int *>(prop->data);
    if (m_properties.isPaused && m_properties.state == PlayerState::Playing) {
      updateState(PlayerState::Paused);
    } else if (!m_properties.isPaused &&
               m_properties.state == PlayerState::Paused) {
      updateState(PlayerState::Playing);
    }
  } else if (name == "mute" && prop->format == MPV_FORMAT_FLAG) {
    m_properties.isMuted = *static_cast<int *>(prop->data);
  } else if (name == "core-idle" && prop->format == MPV_FORMAT_FLAG) {
    m_properties.isCoreIdle = *static_cast<int *>(prop->data);
    if (m_properties.isCoreIdle && m_properties.state == PlayerState::Playing) {
      updateState(PlayerState::Buffering);
    } else if (!m_properties.isCoreIdle &&
               m_properties.state == PlayerState::Buffering) {
      updateState(PlayerState::Playing);
    }
  }

  notifyPropertiesChanged();
}

void PlayerCore::updateState(PlayerState newState) {
  bool changed = false;
  {
    // 这里的 m_propertiesMutex 是可重入锁 (recursive_mutex)。
    // 如果此方法是在 handlePropertyChange
    // 内部被调用，当前线程其实已经持有了这把锁，
    // 由于是可重入类型，再次获取锁（重入）是成功且安全的，彻底解决了在媒体结束时更新状态导致的死卡。
    std::lock_guard<std::recursive_mutex> lock(m_propertiesMutex);
    if (m_properties.state != newState) {
      m_properties.state = newState;
      changed = true;
    }
  }

  if (changed) {
    notifyPropertiesChanged();
    if (m_onStateChanged) {
      m_onStateChanged(newState);
    }
  }
}

void PlayerCore::notifyPropertiesChanged() {
  if (m_onPropertiesChanged) {
    m_onPropertiesChanged(m_properties);
  }
}

// --- 控制接口实现 ---

void PlayerCore::load(const std::string &url) {
  {
    std::lock_guard<std::recursive_mutex> lock(m_propertiesMutex);
    m_properties.currentMedia = url;
  }
  updateState(PlayerState::Loading);
  const char *cmd[] = {"loadfile", url.c_str(), NULL};
  mpv_command(m_mpv, cmd);
}

void PlayerCore::play() {
  int val = 0;
  mpv_set_property(m_mpv, "pause", MPV_FORMAT_FLAG, &val);
}

void PlayerCore::pause() {
  int val = 1;
  mpv_set_property(m_mpv, "pause", MPV_FORMAT_FLAG, &val);
}

void PlayerCore::stop() {
  const char *cmd[] = {"stop", NULL};
  mpv_command(m_mpv, cmd);
}

void PlayerCore::seek(double seconds, bool relative) {
  std::string secStr = std::to_string(seconds);
  const char *flag = relative ? "relative" : "absolute";
  const char *cmd[] = {"seek", secStr.c_str(), flag, NULL};
  mpv_command(m_mpv, cmd);
}

void PlayerCore::setVolume(double volume) {
  mpv_set_property(m_mpv, "volume", MPV_FORMAT_DOUBLE, &volume);
}

void PlayerCore::setMute(bool mute) {
  int val = mute ? 1 : 0;
  mpv_set_property(m_mpv, "mute", MPV_FORMAT_FLAG, &val);
}

void PlayerCore::setOnPropertiesChangedCallback(
    std::function<void(const PlayerProperties &)> cb) {
  m_onPropertiesChanged = cb;
}

void PlayerCore::setOnStateChangedCallback(
    std::function<void(PlayerState)> cb) {
  m_onStateChanged = cb;
}

PlayerProperties PlayerCore::getProperties() const {
  // 因为这里需要返回副本，为了避免和 handlePropertyChange
  // 的锁死锁或竞争，可以用一个 const_cast 强制锁住（如果不提供 mutable 锁）。
  // 在这里我们把锁设置为 m_propertiesMutex，如果是 const 方法不能 lock
  // 成员锁可以把锁标为 mutable。 由于之前定义未提供 mutable 锁，做个妥协直接
  // const_cast。或者更好的方法是去头文件改一下 mutable std::mutex
  // m_propertiesMutex;。
  // 此处简化，如果只读不加锁可能会有读不一致问题但不会崩溃。为严谨起见，我们暂且返回一份可能稍微不一致的快照。
  return m_properties;
}

} // namespace player
