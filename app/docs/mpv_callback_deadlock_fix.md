# C++ 音频核心 (PlayerCore) MPV 事件循环死锁分析及修复报告

## 1. 问题现象
在基于 libmpv 的 C++ 封装中，无论是通过 N-API 还是其他方式进行跨语言通信，在遇到某些特定场景（比如**播放正常结束** `(reason 0)`、**进入/退出空闲状态**等）时，音频核心的事件拉取线程 (`m_workerThread`) 会突然不可思议地“卡死”，不再抛出任何的后续事件（例如 `MPV_EVENT_END_FILE`），导致上层应用层面（如 Node.js 或前端界面）的播放状态与底层发生了永久不同步。

## 2. 问题根源分析: 互斥锁 `std::mutex` 的自锁 (Deadlock)
在排查 `PlayerCore.cpp` 时发现，问题出在**非递归锁 (Non-recursive Mutex)** 的错误应用导致了自己锁死了自己。

`std::mutex` 在 C++ 标准库中的行为是**不可重入**的。如果同一个线程在已经获取了该锁的情况下再次试图获取同一把锁，根据 POSIX/C++ 规范，**会导致该线程被永久挂起，产生死锁**。

### 触发死锁的代码执行流 (Call Stack)
当 libmpv 发出一个底层属性变化事件（如 `pause` 或 `core-idle`）时，`PlayerCore` 的内部处理链条如下：

1. **进入事件处理函数 (首次加锁)**
   ```cpp
   void PlayerCore::handlePropertyChange(mpv_event_property *prop) {
       // 【1】 第一次成功申请了锁 m_propertiesMutex
       std::lock_guard<std::mutex> lock(m_propertiesMutex);
       // ... 解析属性...
   ```

2. **触发状态变更逻辑**
   在处理诸如 `pause` 或 `core-idle` 变化时，代码判断需要改变整体的 `PlayerState`，于是调用 `updateState`：
   ```cpp
   if (m_properties.isCoreIdle && m_properties.state == PlayerState::Playing) {
       updateState(PlayerState::Buffering); // <-- 在持有锁的情况下进入此函数
   ```

3. **进入更新状态函数 (引发死锁/自锁)**
   ```cpp
   void PlayerCore::updateState(PlayerState newState) {
       bool changed = false;
       {
           // 【2】 同一个线程试图第二次申请同一把锁 m_propertiesMutex！
           // 因为 m_propertiesMutex 是普通的 std::mutex (非可重入锁)，
           // 这里的试图获取操作将使当前线程陷入无尽的漫长等待，形成死锁。
           std::lock_guard<std::mutex> lock(m_propertiesMutex);
           // ...
   ```
这一套操作由于发生在专门拉取底层 mpv 消息的 `m_workerThread` 工作线程之中，一旦该线程死锁被挂起，所有的后续 mpv 通知（比如紧绷着即将送达的 `MPV_EVENT_END_FILE`）将永远烂在队列里，彻底宕机。

## 3. 修复方案
理解了病源所在，修复方案非常明朗稳妥：使用 C++ 提供给这个场景的专门工具——**可重入锁**。将普通互斥锁平替更新为 **递归互斥锁 (Recursive Mutex)**。

### 代码修改点：
- 在 `PlayerCore.h` 的成员声明中：
  ```cpp
  // 修改前：
  // std::mutex m_propertiesMutex;
  // 修改后：
  std::recursive_mutex m_propertiesMutex;
  ```

- 在所有的代码调用点 (`PlayerCore.cpp`)中：
  ```cpp
  // 修改前：
  // std::lock_guard<std::mutex> lock(m_propertiesMutex);
  // 修改后：
  std::lock_guard<std::recursive_mutex> lock(m_propertiesMutex);
  ```

### 为什么 `std::recursive_mutex` 是正确的做法？
`std::recursive_mutex` 在底层维护了一个计数器和一个所有者线程 ID。
当 `PlayerCore::handlePropertyChange` 第一次锁住它时，所有者被标记为当前线程，计数变为 1。当深层嵌套调用 `PlayerCore::updateState` 再次试图锁住它时，它发现**“哟，当前来要锁的人就是已经握着锁的主人嘛”**，便大开绿灯，把内部计数器加至 2，继续执行并安全返回，这完美化解了自造的死锁痛点，保证了业务逻辑在单一线程内的复杂流转依然能够拥有严格且正确的线程隔离。
