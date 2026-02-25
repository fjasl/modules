#include "EngineWrapper.h"

namespace wrappers {

Napi::Object EngineWrapper::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(
      env, "Engine",
      {
          InstanceMethod("load", &EngineWrapper::Load),
          InstanceMethod("play", &EngineWrapper::Play),
          InstanceMethod("pause", &EngineWrapper::Pause),
          InstanceMethod("stop", &EngineWrapper::Stop),
          InstanceMethod("seek", &EngineWrapper::Seek),
          InstanceMethod("setVolume", &EngineWrapper::SetVolume),
          InstanceMethod("setMute", &EngineWrapper::SetMute),
          InstanceMethod("getSharedStatusBuffer",
                         &EngineWrapper::GetSharedStatusBuffer),
          InstanceMethod("setOnStatusUpdate",
                         &EngineWrapper::SetOnStatusUpdate),
          InstanceMethod("setOnStateChange", &EngineWrapper::SetOnStateChange),
          InstanceMethod("setOnLineChange", &EngineWrapper::SetOnLineChange),
      });

  Napi::FunctionReference *constructor = new Napi::FunctionReference();
  *constructor = Napi::Persistent(func);
  env.SetInstanceData(constructor);

  exports.Set("Engine", func);
  return exports;
}

EngineWrapper::EngineWrapper(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<EngineWrapper>(info) {
  _engine = new engine::Engine();
}

EngineWrapper::~EngineWrapper() { delete _engine; }

Napi::Value EngineWrapper::Load(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected at least songUrl")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string songUrl = info[0].As<Napi::String>();
  std::string lrcUrl = "";
  if (info.Length() >= 2 && !info[1].IsUndefined() && !info[1].IsNull()) {
    lrcUrl = info[1].As<Napi::String>();
  }

  if (!_engine->engine_load(songUrl, lrcUrl)) {
    return env.Null();
  }

  // 构建返回给 JS 的完整歌词对象
  const auto &doc = _engine->get_lyric_doc();
  Napi::Object result = Napi::Object::New(env);

  // 元数据
  result.Set("title", doc.title);
  result.Set("artist", doc.artist);
  result.Set("album", doc.album);
  result.Set("by", doc.by);
  result.Set("offset", doc.offset);

  // 歌词行
  Napi::Array lines = Napi::Array::New(env, doc.lines.size());
  for (size_t i = 0; i < doc.lines.size(); ++i) {
    const auto &line = doc.lines[i];
    Napi::Object lineObj = Napi::Object::New(env);
    lineObj.Set("text", line.text);
    lineObj.Set("start", line.start);
    lineObj.Set("duration", line.duration);

    if (line.isWordByWord) {
      Napi::Array words = Napi::Array::New(env, line.words.size());
      for (size_t j = 0; j < line.words.size(); ++j) {
        const auto &word = line.words[j];
        Napi::Object wordObj = Napi::Object::New(env);
        wordObj.Set("text", word.text);
        wordObj.Set("start", word.start);
        wordObj.Set("duration", word.duration);
        words.Set(j, wordObj);
      }
      lineObj.Set("words", words);
    }
    lines.Set(i, lineObj);
  }
  result.Set("lines", lines);

  return result;
}

Napi::Value EngineWrapper::Play(const Napi::CallbackInfo &info) {
  _engine->engine_play();
  return info.Env().Undefined();
}

Napi::Value EngineWrapper::Pause(const Napi::CallbackInfo &info) {
  _engine->engine_pause();
  return info.Env().Undefined();
}

Napi::Value EngineWrapper::Stop(const Napi::CallbackInfo &info) {
  _engine->engine_stop();
  return info.Env().Undefined();
}

Napi::Value EngineWrapper::Seek(const Napi::CallbackInfo &info) {
  if (info.Length() > 0) {
    double seconds = info[0].As<Napi::Number>();
    bool relative = false;
    if (info.Length() > 1) {
      relative = info[1].As<Napi::Boolean>();
    }
    _engine->engine_seek(seconds, relative);
  }
  return info.Env().Undefined();
}

Napi::Value EngineWrapper::SetVolume(const Napi::CallbackInfo &info) {
  if (info.Length() > 0) {
    double vol = info[0].As<Napi::Number>();
    _engine->engine_setVolume(vol);
  }
  return info.Env().Undefined();
}

Napi::Value EngineWrapper::SetMute(const Napi::CallbackInfo &info) {
  if (info.Length() > 0) {
    bool mute = info[0].As<Napi::Boolean>();
    _engine->engine_setMute(mute);
  }
  return info.Env().Undefined();
}

Napi::Value
EngineWrapper::GetSharedStatusBuffer(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  engine::SharedEngineState *ptr = _engine->get_shared_state_ptr();

  // 创建一个映射到 C++ 内存地址的 Napi::Buffer (不进行拷贝)
  // 必须提供一个 Finalizer，即使它是空的，否则 Napi 会执行拷贝
  return Napi::Buffer<uint8_t>::New(env, reinterpret_cast<uint8_t *>(ptr),
                                    sizeof(engine::SharedEngineState),
                                    [](Napi::Env /*env*/, uint8_t * /*data*/) {
                                      // 内存由 C++ Engine
                                      // 实例管理，此处无需手动释放
                                    });
}

Napi::Value EngineWrapper::SetOnStatusUpdate(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected a function")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  _tsfnStatusUpdate = Napi::ThreadSafeFunction::New(
      env, info[0].As<Napi::Function>(), "StatusUpdateCallback", 0, 1);

  _engine->set_on_status_update(
      [this](const engine::EngineStatus & /*status*/) {
        if (!_tsfnStatusUpdate)
          return;
        auto callback = [](Napi::Env env, Napi::Function jsCallback,
                           void * /*data*/) { jsCallback.Call({}); };
        _tsfnStatusUpdate.NonBlockingCall((void *)nullptr, callback);
      });

  return env.Undefined();
}

Napi::Value EngineWrapper::SetOnStateChange(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected a function")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  _tsfnStateChange = Napi::ThreadSafeFunction::New(
      env, info[0].As<Napi::Function>(), "StateChangeCallback", 0, 1);

  _engine->set_on_state_change([this](player::PlayerState /*state*/) {
    if (!_tsfnStateChange)
      return;
    auto callback = [](Napi::Env env, Napi::Function jsCallback,
                       void * /*data*/) { jsCallback.Call({}); };
    _tsfnStateChange.NonBlockingCall((void *)nullptr, callback);
  });

  return env.Undefined();
}

Napi::Value EngineWrapper::SetOnLineChange(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected a function")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  _tsfnLineChange = Napi::ThreadSafeFunction::New(
      env, info[0].As<Napi::Function>(), "LineChangeCallback", 0, 1);

  _engine->set_on_line_change([this](int /*lineIndex*/) {
    if (!_tsfnLineChange)
      return;
    auto callback = [](Napi::Env env, Napi::Function jsCallback,
                       void * /*data*/) { jsCallback.Call({}); };
    _tsfnLineChange.NonBlockingCall((void *)nullptr, callback);
  });

  return env.Undefined();
}

} // namespace wrappers
