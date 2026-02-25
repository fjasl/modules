#include "wrappers/engine/EngineWrapper.h"
#include <napi.h>

// 导出一个名为 ag_backend 的包
Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  wrappers::EngineWrapper::Init(env, exports);
  return exports;
}

NODE_API_MODULE(ag_backend, InitAll)
