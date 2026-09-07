// Rust supplies a general-purpose allocator; the encoder itself is unmodified C.
use std::alloc::{alloc, dealloc, realloc, Layout};
use std::ptr::null_mut;

fn layout(size: usize) -> Option<Layout> {
    Layout::from_size_align(size.max(1), 16).ok()
}

#[no_mangle]
pub unsafe extern "C" fn gif_alloc(size: usize) -> *mut u8 {
    layout(size).map_or(null_mut(), |layout| alloc(layout))
}

#[no_mangle]
pub unsafe extern "C" fn gif_free(ptr: *mut u8, size: usize) {
    if !ptr.is_null() {
        if let Some(layout) = layout(size) {
            dealloc(ptr, layout);
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gif_realloc(ptr: *mut u8, old: usize, new: usize) -> *mut u8 {
    if ptr.is_null() {
        return gif_alloc(new);
    }
    if layout(new).is_none() {
        return null_mut();
    }
    layout(old).map_or(null_mut(), |layout| realloc(ptr, layout, new.max(1)))
}
