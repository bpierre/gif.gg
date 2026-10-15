use serde::Serialize;
use std::time::{Duration, Instant};

pub const MAX_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_BODY_BYTES: usize = MAX_BYTES + 64 * 1024;
pub const MAX_WIDTH: usize = 1920;
pub const MAX_HEIGHT: usize = 1920;
pub const MAX_FRAMES: usize = 500;
pub const MAX_PIXELS: usize = 100_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadError {
    Invalid,
    TooLarge,
    Dimensions,
    Frames,
    Pixels,
    Busy,
    Internal,
    Timeout,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct GifInfo {
    pub width: usize,
    pub height: usize,
    pub frames: usize,
}

struct Reader<'a> {
    data: &'a [u8],
    position: usize,
    deadline: Instant,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], UploadError> {
        let end = self
            .position
            .checked_add(count)
            .ok_or(UploadError::Invalid)?;
        let result = self
            .data
            .get(self.position..end)
            .ok_or(UploadError::Invalid)?;
        self.position = end;
        Ok(result)
    }

    fn byte(&mut self) -> Result<usize, UploadError> {
        Ok(self.take(1)?[0] as usize)
    }

    fn word(&mut self) -> Result<usize, UploadError> {
        Ok(self.byte()? | (self.byte()? << 8))
    }

    fn blocks(&mut self) -> Result<Vec<u8>, UploadError> {
        let mut result = Vec::new();
        loop {
            check_deadline(self.deadline)?;
            let count = self.byte()?;
            if count == 0 {
                return Ok(result);
            }
            result.extend_from_slice(self.take(count)?);
        }
    }

    fn palette(&mut self, flags: usize) -> Result<usize, UploadError> {
        if flags & 128 == 0 {
            return Ok(0);
        }
        let colors = 1 << ((flags & 7) + 1);
        self.take(colors * 3)?;
        Ok(colors)
    }
}

fn check_deadline(deadline: Instant) -> Result<(), UploadError> {
    if Instant::now() >= deadline {
        Err(UploadError::Timeout)
    } else {
        Ok(())
    }
}

// Validate dictionary lengths and palette indices without allocating decoded
// frames. Preserve the established acceptance rules and error ordering.
fn validate_lzw(
    data: &[u8],
    minimum: usize,
    pixels: usize,
    colors: usize,
    deadline: Instant,
) -> Result<(), UploadError> {
    if !(2..=8).contains(&minimum) {
        return Err(UploadError::Invalid);
    }
    let clear = 1 << minimum;
    let end = clear + 1;
    let mut lengths = [0usize; 4096];
    let mut maximums = [0usize; 4096];
    let mut firsts = [0usize; 4096];
    for i in 0..clear {
        lengths[i] = 1;
        maximums[i] = i;
        firsts[i] = i;
    }
    let mut size = minimum + 1;
    let mut next = end + 1;
    let mut previous: Option<usize> = None;
    let mut bit = 0;
    let mut output = 0;
    let mut initial = true;
    let mut codes = 0;
    while bit + size <= data.len() * 8 {
        if codes % 1024 == 0 {
            check_deadline(deadline)?;
        }
        codes += 1;
        let mut code = 0;
        for i in 0..size {
            code |= (((data[bit >> 3] >> (bit & 7)) & 1) as usize) << i;
            bit += 1;
        }
        if initial && code != clear {
            return Err(UploadError::Invalid);
        }
        initial = false;
        if code == clear {
            size = minimum + 1;
            next = end + 1;
            previous = None;
            continue;
        }
        if code == end {
            return if output == pixels && bit.div_ceil(8) == data.len() {
                Ok(())
            } else {
                Err(UploadError::Invalid)
            };
        }
        if code > next || (code == next && previous.is_none()) || code >= 4096 {
            return Err(UploadError::Invalid);
        }
        let (length, first, maximum) = if code == next {
            let p = previous.ok_or(UploadError::Invalid)?;
            (lengths[p] + 1, firsts[p], maximums[p])
        } else {
            (lengths[code], firsts[code], maximums[code])
        };
        if length == 0 || maximum >= colors {
            return Err(UploadError::Invalid);
        }
        output += length;
        if output > pixels {
            return Err(UploadError::Invalid);
        }
        if let Some(p) = previous {
            if next < 4096 {
                lengths[next] = lengths[p] + 1;
                firsts[next] = firsts[p];
                maximums[next] = maximums[p].max(first);
                next += 1;
                if next == (1 << size) && size < 12 {
                    size += 1;
                }
            }
        }
        previous = Some(code);
    }
    Err(UploadError::Invalid)
}

pub fn validate_gif(data: &[u8]) -> Result<GifInfo, UploadError> {
    validate_before(data, Instant::now() + Duration::from_secs(10))
}

pub fn validate_before(data: &[u8], deadline: Instant) -> Result<GifInfo, UploadError> {
    if data.len() > MAX_BYTES {
        return Err(UploadError::TooLarge);
    }
    check_deadline(deadline)?;
    let mut reader = Reader {
        data,
        position: 0,
        deadline,
    };
    let signature = reader.take(6)?;
    if signature != b"GIF87a" && signature != b"GIF89a" {
        return Err(UploadError::Invalid);
    }
    let width = reader.word()?;
    let height = reader.word()?;
    if width == 0 || height == 0 {
        return Err(UploadError::Invalid);
    }
    if width > MAX_WIDTH || height > MAX_HEIGHT {
        return Err(UploadError::Dimensions);
    }
    let flags = reader.byte()?;
    let background = reader.byte()?;
    reader.byte()?; // Pixel aspect ratio.
    let global_colors = reader.palette(flags)?;
    if global_colors != 0 && background >= global_colors {
        return Err(UploadError::Invalid);
    }
    let mut frames = 0;
    let mut transparency = None;
    let mut pending_control = false;
    while reader.position < data.len() {
        check_deadline(deadline)?;
        let marker = reader.byte()?;
        if marker == 0x3b {
            return if frames != 0 && !pending_control && reader.position == data.len() {
                Ok(GifInfo {
                    width,
                    height,
                    frames,
                })
            } else {
                Err(UploadError::Invalid)
            };
        }
        if marker == 0x21 {
            match reader.byte()? {
                0xf9 => {
                    if pending_control || reader.byte()? != 4 {
                        return Err(UploadError::Invalid);
                    }
                    let control = reader.byte()?;
                    if control & 0xe0 != 0 || ((control >> 2) & 7) > 3 {
                        return Err(UploadError::Invalid);
                    }
                    reader.word()?; // Delay is intentionally unrestricted.
                    let index = reader.byte()?;
                    transparency = if control & 1 != 0 { Some(index) } else { None };
                    if reader.byte()? != 0 {
                        return Err(UploadError::Invalid);
                    }
                    pending_control = true;
                }
                0xff => {
                    if reader.byte()? != 11 {
                        return Err(UploadError::Invalid);
                    }
                    reader.take(11)?;
                    reader.blocks()?;
                }
                0xfe => {
                    reader.blocks()?;
                }
                _ => return Err(UploadError::Invalid),
            }
            continue;
        }
        if marker != 0x2c {
            return Err(UploadError::Invalid);
        }
        let left = reader.word()?;
        let top = reader.word()?;
        let frame_width = reader.word()?;
        let frame_height = reader.word()?;
        if frame_width == 0
            || frame_height == 0
            || left + frame_width > width
            || top + frame_height > height
        {
            return Err(UploadError::Invalid);
        }
        frames += 1;
        if frames > MAX_FRAMES {
            return Err(UploadError::Frames);
        }
        if width * height * frames > MAX_PIXELS {
            return Err(UploadError::Pixels);
        }
        let frame_flags = reader.byte()?;
        if frame_flags & 0x18 != 0 {
            return Err(UploadError::Invalid);
        }
        let local_colors = reader.palette(frame_flags)?;
        let colors = if local_colors != 0 {
            local_colors
        } else {
            global_colors
        };
        if colors == 0 || transparency.is_some_and(|index| index >= colors) {
            return Err(UploadError::Invalid);
        }
        let minimum = reader.byte()?;
        validate_lzw(
            &reader.blocks()?,
            minimum,
            frame_width * frame_height,
            colors,
            deadline,
        )?;
        transparency = None;
        pending_control = false;
    }
    Err(UploadError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadline_stops_validation() {
        assert_eq!(
            validate_before(b"GIF89a", Instant::now()),
            Err(UploadError::Timeout)
        );
        assert_eq!(
            validate_lzw(&[0x44, 1], 2, 1, 2, Instant::now()),
            Err(UploadError::Timeout)
        );
        let mut reader = Reader {
            data: &[1, 0, 0],
            position: 0,
            deadline: Instant::now(),
        };
        assert_eq!(reader.blocks(), Err(UploadError::Timeout));
    }
}
