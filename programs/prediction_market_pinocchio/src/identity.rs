use crate::error::{check, Error, Result};

pub const LAZY_SETTLEMENT_WINDOW_SECONDS: i64 = 3_600;
const MATCH_MAGIC: &[u8; 4] = b"SOLZ";
const QUESTION_MAGIC: &[u8; 4] = b"QUES";
const VERSION: u8 = 1;

pub struct MatchConfig {
    pub duration_minutes: u16,
    pub kickoff: i64,
}

/// Layout: magic(4) | version(1) | game_mode(1) | duration_minutes(2) |
/// kickoff_unix_seconds(8) | unique_nonce(16), all big-endian.
pub fn decode_match(value: &[u8; 32]) -> Result<MatchConfig> {
    let duration_minutes = u16::from_be_bytes([value[6], value[7]]);
    let kickoff_u64 = u64::from_be_bytes(value[8..16].try_into().map_err(|_| Error::InvalidData)?);
    check(
        &value[..4] == MATCH_MAGIC
            && value[4] == VERSION
            && value[5] != 0
            && duration_minutes != 0
            && kickoff_u64 <= i64::MAX as u64
            && value[16..].iter().any(|byte| *byte != 0),
        Error::InvalidData,
    )?;
    Ok(MatchConfig { duration_minutes, kickoff: kickoff_u64 as i64 })
}

/// Layout: magic(4) | version(1) | kind(1) | subject(26).
pub fn question_kind(value: &[u8; 32]) -> Result<u8> {
    check(
        &value[..4] == QUESTION_MAGIC
            && value[4] == VERSION
            && value[5] != 0
            && value[6..].iter().any(|byte| *byte != 0),
        Error::InvalidData,
    )?;
    Ok(value[5])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_ids_decode_and_reject_missing_identity_fields() {
        let mut match_id = [0; 32];
        match_id[..4].copy_from_slice(b"SOLZ");
        match_id[4] = 1;
        match_id[5] = 2;
        match_id[6..8].copy_from_slice(&20_u16.to_be_bytes());
        match_id[8..16].copy_from_slice(&1_800_000_000_u64.to_be_bytes());
        match_id[31] = 7;
        let decoded = decode_match(&match_id).unwrap();
        assert_eq!(decoded.duration_minutes, 20);
        assert_eq!(decoded.kickoff, 1_800_000_000);

        let mut question_id = [0; 32];
        question_id[..4].copy_from_slice(b"QUES");
        question_id[4] = 1;
        question_id[5] = 1;
        question_id[31] = 9;
        assert_eq!(question_kind(&question_id).unwrap(), 1);
        question_id[5] = 0;
        assert!(question_kind(&question_id).is_err());
    }
}
