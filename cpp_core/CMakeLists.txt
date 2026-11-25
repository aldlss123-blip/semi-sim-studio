cmake_minimum_required(VERSION 3.20)
project(semi_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(semi_core STATIC src/ffi_api.cpp)
target_include_directories(semi_core PUBLIC include)

install(TARGETS semi_core ARCHIVE DESTINATION lib)
