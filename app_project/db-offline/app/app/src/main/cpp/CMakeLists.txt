# ============================================================================
#  CMakeLists.txt — 惠康中医离线 APP 原生安全库
#  P0-NDK（2026-08-17）：构建 libsecurityguard.so（签名校验下沉到 native）
#  产物名：securityguard → libsecurityguard.so，打入 APK lib/<abi>/
# ============================================================================
cmake_minimum_required(VERSION 3.18.1)
project(securityguard LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS_RELEASE "-O2")

add_library(securityguard SHARED
    securityguard.cpp
)

# 隐藏符号，仅暴露 JNI 入口，缩小可逆向面
target_compile_options(securityguard PRIVATE -fvisibility=hidden -fvisibility-inlines-hidden)