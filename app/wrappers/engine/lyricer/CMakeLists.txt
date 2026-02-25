cmake_minimum_required(VERSION 3.10)
project(LyricerModule)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 编译核心歌词解析库
add_library(lyric_core SHARED
    LrcParser.cpp
    LyricQuery.cpp
)

target_include_directories(lyric_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# 编译测试程序
add_executable(lyric_test test.cpp)
target_link_libraries(lyric_test lyric_core)
