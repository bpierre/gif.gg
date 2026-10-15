// Framed input keeps arbitrary malformed GIF bytes out of JSON and lets the
// differential test run its corpus through one validator process.
use std::io::{self, Read, Write};

fn main() -> io::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("--limits") {
        use gifgg_server::validation::*;
        println!(
            "{}",
            serde_json::json!({ "bytes": MAX_BYTES, "width": MAX_WIDTH, "height": MAX_HEIGHT, "frames": MAX_FRAMES, "pixels": MAX_PIXELS, "bodyBytes": MAX_BODY_BYTES })
        );
        return Ok(());
    }
    let mut input = io::stdin().lock();
    let mut output = io::BufWriter::new(io::stdout().lock());
    loop {
        let mut length = [0; 4];
        match input.read_exact(&mut length) {
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            result => result?,
        }
        let mut bytes = vec![0; u32::from_le_bytes(length) as usize];
        input.read_exact(&mut bytes)?;
        let result = match gifgg_server::validation::validate_gif(&bytes) {
            Ok(info) => serde_json::to_value(info).unwrap(),
            Err(error) => serde_json::json!({ "error": error }),
        };
        writeln!(output, "{result}")?;
    }
    Ok(())
}
