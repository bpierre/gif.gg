fn main() {
    let out = std::env::var("OUT_DIR").unwrap();
    let object = format!("{out}/encoder.o");
    assert!(std::process::Command::new("clang")
        .args(["--target=wasm32-unknown-unknown", "-ffreestanding", "-O3",
            "-Iinclude", "-c", "encoder.c", "-o", &object])
        .status().expect("clang is required to rebuild the encoder").success());
    println!("cargo:rustc-link-arg={object}");
    println!("cargo:rustc-link-arg=--max-memory=268435456");
    for symbol in ["encoder_begin", "encoder_pixels", "encoder_frame",
        "encoder_end", "encoder_size", "encoder_dispose"] {
        println!("cargo:rustc-link-arg=--export={symbol}");
    }
    for path in ["encoder.c", "msf_gif.h", "include/string.h"] {
        println!("cargo:rerun-if-changed={path}");
    }
}
