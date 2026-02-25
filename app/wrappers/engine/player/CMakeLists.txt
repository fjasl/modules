# 声明当前构建项目需要的 CMake 最低版本限制（3.10）。
# 确保运行构建的用户的 CMake 工具特性不至于过老，从而支持后面的语法。
cmake_minimum_required(VERSION 3.10)

# 定义当前项目的名称为 PlayerCoreModule。
# 这会隐式定义一些 CMake 全局变量，比如项目源代码的根目录和生成二进制文件所在的目录等。
project(PlayerCoreModule)

# ==========================================
# --- 编译器标准设置 ---
# ==========================================

# 设置默认的 C++ 语言标准为 C++17。
# 这样 CMake 在生成构建文件时，会自动在底层编译器（如 GCC 或 Clang）加上对应标准的编译参数（如 -std=c++17）。
set(CMAKE_CXX_STANDARD 17)

# 强制要求编译器必须完整支持所设定的 C++标准（即 C++17）。
# 这里设为 ON，如果系统编译器过老不支持 C++17，CMake 配置阶段就会直接报错退出，而不去尝试降级编译。
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ==========================================
# --- 第三方依赖包查找 ---
# ==========================================

# 引入 PkgConfig 工具模块。
# pkg-config 是 Linux 等类 Unix 系统下非常通用的寻找库文件的辅助工具。REQUIRED 意味着如果找不到 PkgConfig，直接报错。
find_package(PkgConfig REQUIRED)

# 使用 pkg-config 工具来查询系统中名为 "mpv" 的开发包。
# REQUIRED 意味着在系统上必须成功找到 libmpv（包括它需要的头文件和动态链接库等），这是我们播放器的核心依赖。
# 执行成功后，CMake 会帮我们定义类似 ${MPV_LIBRARIES} 和 ${MPV_LIBRARY_DIRS} 这类包含库路径信息的变量。
pkg_check_modules(MPV REQUIRED mpv)

# ==========================================
# --- 核心库构建 ---
# ==========================================

# 定义一个我们自己写的库，名字叫做 "player_core"。
# SHARED 关键字表明我们要把它编译链接成一个动态链接库（Shared Library），即类似 libplayer_core.so 的文件。
# 第三行的 PlayerCore.cpp 是需要被包含进这个动态库中一起编译的私有源代码文件（如果有多个可以在此换行继续写）。
add_library(player_core SHARED
    PlayerCore.cpp
)

# 告诉 "player_core" 目标，在编译它自己时应该去哪里找头文件（比如找 PlayerCore.h）。
# PUBLIC 关键字极其关键：这不仅代表自己内部编译找这些目录，还代表以后任何链接了 "player_core" 的程序自动都能继承这个头文件寻找路径。
# ${CMAKE_CURRENT_SOURCE_DIR} 也就是当前这个 CMakeLists.txt 所在的系统绝对路径。
target_include_directories(player_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# 告诉 "player_core" 目标，在链接底层依赖库时去哪些包含库文件的目录寻找。
# ${MPV_LIBRARY_DIRS} 是上面 pkg-config 帮我们获取的 libmpv 在系统中的真实存储路径（通常是 /usr/lib 之类的）。
# PUBLIC 的意义同上，会继承给依赖本库的目标。
target_link_directories(player_core PUBLIC ${MPV_LIBRARY_DIRS})

# 把实际的底层库文件主动“绑定”到 "player_core" 动态库上。
# ${MPV_LIBRARIES} 就是解析出的具体的库的名字（如 "mpv"）。
# PUBLIC 使得凡是链接了 player_core 的应用程序同时也会隐形绑定上对 libmpv 的依赖，不需要应用程序重复写一次。
target_link_libraries(player_core PUBLIC ${MPV_LIBRARIES})

# ==========================================
# --- 测试程序构建 ---
# ==========================================

# 定义一个名为 "player_test" 的可执行程序（Executable）。
# 组成它的源代码是子目录 test 下的 main.cpp。
add_executable(player_test main.cpp)

# 将我们写好的 "player_core" 库链接给刚刚定义的 "player_test" 测试程序。
# 得益于上方使用的 PUBLIC 属性，这简单的一句代码自动让 main.cpp 知道该去哪找 mpv 相关头文件并一起链接 mpv 底层库。
target_link_libraries(player_test player_core)
