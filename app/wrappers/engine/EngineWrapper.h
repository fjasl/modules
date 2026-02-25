#pragma once

#include "engine.h"
#include <napi.h>

namespace wrappers {

class EngineWrapper : public Napi::ObjectWrap<EngineWrapper> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  EngineWrapper(const Napi::CallbackInfo &info);
  ~EngineWrapper();

private:
  // 控制接口
  Napi::Value Load(const Napi::CallbackInfo &info);
  Napi::Value Play(const Napi::CallbackInfo &info);
  Napi::Value Pause(const Napi::CallbackInfo &info);
  Napi::Value Stop(const Napi::CallbackInfo &info);
  Napi::Value Seek(const Napi::CallbackInfo &info);
  Napi::Value SetVolume(const Napi::CallbackInfo &info);
  Napi::Value SetMute(const Napi::CallbackInfo &info);

  // 【核心】：获取共享内存 Buffer
  Napi::Value GetSharedStatusBuffer(const Napi::CallbackInfo &info);

  // 状态订阅 (分频处理)
  Napi::Value SetOnStatusUpdate(const Napi::CallbackInfo &info); // 综合高频
  Napi::Value
  SetOnStateChange(const Napi::CallbackInfo &info); // 状态切换 (低频)
  Napi::Value
  SetOnLineChange(const Napi::CallbackInfo &info); // 换行切换 (低频)

  engine::Engine *_engine;
  Napi::ThreadSafeFunction _tsfnStatusUpdate;
  Napi::ThreadSafeFunction _tsfnStateChange;
  Napi::ThreadSafeFunction _tsfnLineChange;
};

} // namespace wrappers
