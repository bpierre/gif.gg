use crate::validation::UploadError;

pub const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";

pub fn generate_id(
    mut random_index: impl FnMut() -> usize,
    mut exists: impl FnMut(&str) -> Result<bool, UploadError>,
) -> Result<String, UploadError> {
    loop {
        let mut candidate = String::with_capacity(7);
        for _ in 0..7 {
            let character = ALPHABET.get(random_index()).ok_or(UploadError::Internal)?;
            candidate.push(*character as char);
        }
        if !exists(&candidate)? {
            return Ok(candidate);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_seven_characters_and_the_last_alphabet_entry() {
        assert_eq!(generate_id(|| 61, |_| Ok(false)).unwrap(), "0000000");
    }

    #[test]
    fn retains_legacy_alphabet_order() {
        let mut draws = [0, 25, 26, 51, 52, 60, 61].into_iter();
        assert_eq!(
            generate_id(|| draws.next().unwrap(), |_| Ok(false)).unwrap(),
            "azAZ190"
        );
    }

    #[test]
    fn retries_collisions() {
        let mut draw = 0;
        let mut checked = Vec::new();
        let id = generate_id(
            || {
                let index = draw / 7;
                draw += 1;
                index
            },
            |candidate| {
                checked.push(candidate.to_owned());
                Ok(candidate == "aaaaaaa")
            },
        )
        .unwrap();
        assert_eq!(id, "bbbbbbb");
        assert_eq!(checked, ["aaaaaaa", "bbbbbbb"]);
    }

    #[test]
    fn rejects_out_of_range_random_indices() {
        for index in [62, usize::MAX] {
            assert_eq!(
                generate_id(|| index, |_| Ok(false)),
                Err(UploadError::Internal)
            );
        }
    }
}
