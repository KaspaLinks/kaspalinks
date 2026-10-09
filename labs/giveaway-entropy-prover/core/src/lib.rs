#![no_std]

extern crate alloc;

use alloc::vec::Vec;
use blake2b_simd::Params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const TOCCATA_BLOCK_VERSION: u16 = 2;
pub const MAX_PARENT_LEVELS: usize = u8::MAX as usize;
pub const MAX_PARENTS_PER_LEVEL: usize = 64;
pub const MAX_TOTAL_PARENTS: usize = 4096;
pub const MAX_BLUE_WORK_BYTES: usize = 24;
pub const JOURNAL_DOMAIN: u8 = 0x60;
pub const JOURNAL_LENGTH: usize = 217;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeaderInput {
    pub version: u16,
    pub parents_by_level: Vec<Vec<[u8; 32]>>,
    pub hash_merkle_root: [u8; 32],
    pub accepted_id_merkle_root: [u8; 32],
    pub utxo_commitment: [u8; 32],
    pub timestamp: u64,
    pub bits: u32,
    pub nonce: u64,
    pub daa_score: u64,
    /// Big-endian canonical Uint192 bytes without leading zeroes. Zero is empty.
    pub blue_work: Vec<u8>,
    pub blue_score: u64,
    pub pruning_point: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntropyInput {
    pub giveaway_id: [u8; 32],
    pub frozen_root: [u8; 32],
    pub target_blue_score: u64,
    pub parent: HeaderInput,
    pub candidate: HeaderInput,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValidationError {
    ZeroGiveawayId,
    ZeroFrozenRoot,
    ZeroTarget,
    PreToccataHeader,
    MissingParentLevels,
    TooManyParentLevels,
    TooManyParents,
    InvalidBlueWork,
    TargetNotCrossed,
    WrongSelectedParent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidatedEntropy {
    pub parent_hash: [u8; 32],
    pub candidate_hash: [u8; 32],
    pub parent_seq_commit: [u8; 32],
    pub candidate_seq_commit: [u8; 32],
}

impl HeaderInput {
    pub fn hash(&self) -> [u8; 32] {
        let mut state = Params::new().hash_length(32).key(b"BlockHash").to_state();

        state.update(&self.version.to_le_bytes());
        update_len(&mut state, self.parents_by_level.len());
        for level in &self.parents_by_level {
            update_len(&mut state, level.len());
            for parent in level {
                state.update(parent);
            }
        }
        state.update(&self.hash_merkle_root);
        state.update(&self.accepted_id_merkle_root);
        state.update(&self.utxo_commitment);
        state.update(&self.timestamp.to_le_bytes());
        state.update(&self.bits.to_le_bytes());
        state.update(&self.nonce.to_le_bytes());
        state.update(&self.daa_score.to_le_bytes());
        state.update(&self.blue_score.to_le_bytes());
        update_len(&mut state, self.blue_work.len());
        state.update(&self.blue_work);
        state.update(&self.pruning_point);

        let digest = state.finalize();
        let mut hash = [0u8; 32];
        hash.copy_from_slice(digest.as_bytes());
        hash
    }

    fn validate_shape(&self) -> Result<(), ValidationError> {
        if self.version != TOCCATA_BLOCK_VERSION {
            return Err(ValidationError::PreToccataHeader);
        }
        if self.parents_by_level.is_empty() {
            return Err(ValidationError::MissingParentLevels);
        }
        if self.parents_by_level.len() > MAX_PARENT_LEVELS {
            return Err(ValidationError::TooManyParentLevels);
        }
        let mut total = 0usize;
        for level in &self.parents_by_level {
            if level.len() > MAX_PARENTS_PER_LEVEL {
                return Err(ValidationError::TooManyParents);
            }
            total = total
                .checked_add(level.len())
                .ok_or(ValidationError::TooManyParents)?;
            if total > MAX_TOTAL_PARENTS {
                return Err(ValidationError::TooManyParents);
            }
        }
        if self.blue_work.len() > MAX_BLUE_WORK_BYTES
            || self.blue_work.first().is_some_and(|byte| *byte == 0)
        {
            return Err(ValidationError::InvalidBlueWork);
        }
        Ok(())
    }
}

impl EntropyInput {
    pub fn validate(&self) -> Result<ValidatedEntropy, ValidationError> {
        if self.giveaway_id == [0u8; 32] {
            return Err(ValidationError::ZeroGiveawayId);
        }
        if self.frozen_root == [0u8; 32] {
            return Err(ValidationError::ZeroFrozenRoot);
        }
        if self.target_blue_score == 0 {
            return Err(ValidationError::ZeroTarget);
        }
        self.parent.validate_shape()?;
        self.candidate.validate_shape()?;
        if self.candidate.parents_by_level[0].is_empty() {
            return Err(ValidationError::MissingParentLevels);
        }
        if !(self.parent.blue_score < self.target_blue_score
            && self.target_blue_score <= self.candidate.blue_score)
        {
            return Err(ValidationError::TargetNotCrossed);
        }

        let parent_hash = self.parent.hash();
        if self.candidate.parents_by_level[0][0] != parent_hash {
            return Err(ValidationError::WrongSelectedParent);
        }
        let candidate_hash = self.candidate.hash();

        Ok(ValidatedEntropy {
            parent_hash,
            candidate_hash,
            parent_seq_commit: self.parent.accepted_id_merkle_root,
            candidate_seq_commit: self.candidate.accepted_id_merkle_root,
        })
    }

    pub fn journal(&self) -> Result<[u8; JOURNAL_LENGTH], ValidationError> {
        let validated = self.validate()?;
        let mut journal = [0u8; JOURNAL_LENGTH];
        let mut cursor = 0usize;

        put(&mut journal, &mut cursor, &[JOURNAL_DOMAIN]);
        put(&mut journal, &mut cursor, &self.giveaway_id);
        put(&mut journal, &mut cursor, &self.frozen_root);
        put(
            &mut journal,
            &mut cursor,
            &self.target_blue_score.to_le_bytes(),
        );
        put(&mut journal, &mut cursor, &validated.parent_hash);
        put(
            &mut journal,
            &mut cursor,
            &self.parent.blue_score.to_le_bytes(),
        );
        put(&mut journal, &mut cursor, &validated.parent_seq_commit);
        put(&mut journal, &mut cursor, &validated.candidate_hash);
        put(
            &mut journal,
            &mut cursor,
            &self.candidate.blue_score.to_le_bytes(),
        );
        put(&mut journal, &mut cursor, &validated.candidate_seq_commit);
        debug_assert_eq!(cursor, JOURNAL_LENGTH);
        Ok(journal)
    }

    pub fn journal_hash(&self) -> Result<[u8; 32], ValidationError> {
        let digest = Sha256::digest(self.journal()?);
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&digest);
        Ok(hash)
    }
}

fn update_len(state: &mut blake2b_simd::State, len: usize) {
    state.update(&(len as u64).to_le_bytes());
}

fn put<const N: usize>(buffer: &mut [u8; N], cursor: &mut usize, bytes: &[u8]) {
    let end = *cursor + bytes.len();
    buffer[*cursor..end].copy_from_slice(bytes);
    *cursor = end;
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use alloc::vec;

    fn header(seed: u8, score: u64, direct_parent: [u8; 32]) -> HeaderInput {
        HeaderInput {
            version: TOCCATA_BLOCK_VERSION,
            parents_by_level: vec![vec![direct_parent], vec![[seed.wrapping_add(1); 32]]],
            hash_merkle_root: [seed.wrapping_add(2); 32],
            accepted_id_merkle_root: [seed.wrapping_add(3); 32],
            utxo_commitment: [seed.wrapping_add(4); 32],
            timestamp: 1_700_000_000_000 + seed as u64,
            bits: 0x1e7fffff,
            nonce: 42 + seed as u64,
            daa_score: 10_000 + seed as u64,
            blue_work: vec![seed.max(1), seed.wrapping_add(5)],
            blue_score: score,
            pruning_point: [seed.wrapping_add(6); 32],
        }
    }

    fn valid_input() -> EntropyInput {
        let parent = header(11, 99, [9; 32]);
        let parent_hash = parent.hash();
        let candidate = header(21, 100, parent_hash);
        EntropyInput {
            giveaway_id: [1; 32],
            frozen_root: [2; 32],
            target_blue_score: 100,
            parent,
            candidate,
        }
    }

    #[test]
    fn validates_the_first_crossing_selected_parent() {
        let input = valid_input();
        let validated = input.validate().unwrap();
        assert_eq!(validated.parent_hash, input.parent.hash());
        assert_eq!(validated.candidate_hash, input.candidate.hash());
    }

    #[test]
    fn rejects_a_forged_selected_parent() {
        let mut input = valid_input();
        input.candidate.parents_by_level[0][0][0] ^= 1;
        assert_eq!(input.validate(), Err(ValidationError::WrongSelectedParent));
    }

    #[test]
    fn rejects_a_non_first_crossing_pair() {
        let mut input = valid_input();
        input.parent.blue_score = input.target_blue_score;
        assert_eq!(input.validate(), Err(ValidationError::TargetNotCrossed));
    }

    #[test]
    fn rejects_noncanonical_blue_work() {
        let mut input = valid_input();
        input.parent.blue_work = vec![0, 1];
        assert_eq!(input.validate(), Err(ValidationError::InvalidBlueWork));
    }

    #[test]
    fn journal_matches_the_contract_layout() {
        let input = valid_input();
        let journal = input.journal().unwrap();
        let validated = input.validate().unwrap();
        assert_eq!(journal.len(), JOURNAL_LENGTH);
        assert_eq!(journal[0], JOURNAL_DOMAIN);
        assert_eq!(&journal[1..33], &input.giveaway_id);
        assert_eq!(&journal[33..65], &input.frozen_root);
        assert_eq!(&journal[65..73], &input.target_blue_score.to_le_bytes());
        assert_eq!(&journal[73..105], &validated.parent_hash);
        assert_eq!(&journal[105..113], &input.parent.blue_score.to_le_bytes());
        assert_eq!(&journal[113..145], &input.parent.accepted_id_merkle_root);
        assert_eq!(&journal[145..177], &validated.candidate_hash);
        assert_eq!(
            &journal[177..185],
            &input.candidate.blue_score.to_le_bytes()
        );
        assert_eq!(&journal[185..217], &input.candidate.accepted_id_merkle_root);
    }

    #[test]
    fn header_hash_has_a_stable_kaspa_vector() {
        let input = valid_input();
        // Generated with rusty-kaspa Header::new_finalized at
        // a41a333b08848f41bf737b72592e463a6011b8ac.
        assert_eq!(
            hex(&input.parent.hash()),
            "2b316085eafb97634ff4d58d2eb40c0cff639653edf956ba575b093d977e80fa"
        );
        assert_eq!(
            hex(&input.candidate.hash()),
            "7c4ea80d46089fa84dcdbb59de9d51227fcf88c46f00b23ba4c4dd7bfd216a2f"
        );
    }

    fn hex(bytes: &[u8]) -> std::string::String {
        use core::fmt::Write;
        let mut out = std::string::String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            write!(&mut out, "{byte:02x}").unwrap();
        }
        out
    }
}
