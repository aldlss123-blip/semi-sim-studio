fn main() {
    let dst = cmake::Config::new("../cpp_core")
        .profile("Release")
        .build();

    println!("cargo:rustc-link-search=native={}/lib", dst.display());
    println!("cargo:rustc-link-lib=static=semi_core");

    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=c++");
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-lib=stdc++");

    println!("cargo:rerun-if-changed=../cpp_core/src/ffi_api.cpp");
    println!("cargo:rerun-if-changed=../cpp_core/include/semi_core/sdf_grid.hpp");
    println!("cargo:rerun-if-changed=../cpp_core/include/semi_core/marching_cubes.hpp");
    println!("cargo:rerun-if-changed=../cpp_core/CMakeLists.txt");

    tauri_build::build()
}
