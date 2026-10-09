use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const MAX_SHARDS: usize = 4;
const MAX_TREE_DEPTH: usize = 16;

#[derive(Debug, PartialEq, Eq)]
pub enum ParticipantTreeError {
    DuplicateCommitment,
    EmptyParticipantSet,
    FrozenRootMismatch,
    InvalidScript,
    InvalidShardCount,
    InvalidTreeDepth,
    ShardCapacityExceeded,
    WrongShard,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ParticipantCaptureError {
    Field(&'static str),
    Json,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedParticipants {
    pub giveaway_id: String,
    pub tree_depth: usize,
    #[serde(default)]
    pub generator_salt: Option<u64>,
    pub shards: Vec<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrozenParticipantSet {
    pub shard_counts: Vec<u64>,
    pub shard_entries_roots: Vec<[u8; 32]>,
    pub shard_address_roots: Vec<[u8; 32]>,
    pub frozen_root: [u8; 32],
    pub entry_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WinnerProof {
    pub global_index: usize,
    pub shard_index: usize,
    pub local_index: usize,
    pub script_public_key: Vec<u8>,
    pub siblings: Vec<[u8; 32]>,
}

pub fn decode_participant_capture(
    json: &str,
) -> Result<([u8; 32], usize, Vec<Vec<Vec<u8>>>), ParticipantCaptureError> {
    let capture: CapturedParticipants =
        serde_json::from_str(json).map_err(|_| ParticipantCaptureError::Json)?;
    let giveaway_id = decode_fixed_hash(&capture.giveaway_id, "giveawayId")?;
    let shards = capture
        .shards
        .iter()
        .map(|shard| {
            shard
                .iter()
                .map(|script| decode_hex(script, "shards"))
                .collect()
        })
        .collect::<Result<Vec<Vec<Vec<u8>>>, ParticipantCaptureError>>()?;
    Ok((giveaway_id, capture.tree_depth, shards))
}

pub fn build_frozen_participant_set(
    shards: &[Vec<Vec<u8>>],
    tree_depth: usize,
) -> Result<FrozenParticipantSet, ParticipantTreeError> {
    if shards.is_empty() || shards.len() > MAX_SHARDS {
        return Err(ParticipantTreeError::InvalidShardCount);
    }
    if tree_depth == 0 || tree_depth > MAX_TREE_DEPTH {
        return Err(ParticipantTreeError::InvalidTreeDepth);
    }
    let capacity = 1usize << tree_depth;
    let mut seen = BTreeSet::new();
    let mut counts = Vec::with_capacity(shards.len());
    let mut entries_roots = Vec::with_capacity(shards.len());
    let mut address_roots = Vec::with_capacity(shards.len());

    for (shard_index, scripts) in shards.iter().enumerate() {
        if scripts.len() > capacity {
            return Err(ParticipantTreeError::ShardCapacityExceeded);
        }
        let mut commitments = Vec::with_capacity(scripts.len());
        for script in scripts {
            if script.is_empty() || script.len() > 128 {
                return Err(ParticipantTreeError::InvalidScript);
            }
            let commitment = sha256(script);
            if commitment[0] as usize % shards.len() != shard_index {
                return Err(ParticipantTreeError::WrongShard);
            }
            if !seen.insert(commitment) {
                return Err(ParticipantTreeError::DuplicateCommitment);
            }
            commitments.push(commitment);
        }
        counts.push(scripts.len() as u64);
        entries_roots.push(entry_tree(&commitments, tree_depth).0);
        address_roots.push(address_root(&commitments));
    }

    let mut frozen_root = sha256(&[]);
    for shard_index in 0..shards.len() {
        let mut preimage = Vec::with_capacity(112);
        preimage.extend_from_slice(&frozen_root);
        preimage.extend_from_slice(&(shard_index as u64).to_le_bytes());
        preimage.extend_from_slice(&counts[shard_index].to_le_bytes());
        preimage.extend_from_slice(&entries_roots[shard_index]);
        preimage.extend_from_slice(&address_roots[shard_index]);
        frozen_root = sha256(&preimage);
    }

    Ok(FrozenParticipantSet {
        entry_count: counts.iter().sum(),
        shard_counts: counts,
        shard_entries_roots: entries_roots,
        shard_address_roots: address_roots,
        frozen_root,
    })
}

pub fn select_winner(
    shards: &[Vec<Vec<u8>>],
    tree_depth: usize,
    giveaway_id: [u8; 32],
    frozen_root: [u8; 32],
    candidate_hash: [u8; 32],
    candidate_seq_commit: [u8; 32],
) -> Result<WinnerProof, ParticipantTreeError> {
    let frozen = build_frozen_participant_set(shards, tree_depth)?;
    if frozen.entry_count == 0 {
        return Err(ParticipantTreeError::EmptyParticipantSet);
    }
    if frozen.frozen_root != frozen_root {
        return Err(ParticipantTreeError::FrozenRootMismatch);
    }
    let mut preimage = Vec::with_capacity(129);
    preimage.push(0x61);
    preimage.extend_from_slice(&giveaway_id);
    preimage.extend_from_slice(&frozen_root);
    preimage.extend_from_slice(&candidate_hash);
    preimage.extend_from_slice(&candidate_seq_commit);
    let digest = sha256(&preimage);
    let global_index =
        u32::from_le_bytes(digest[..4].try_into().unwrap()) as usize % frozen.entry_count as usize;

    let mut remaining = global_index;
    for (shard_index, scripts) in shards.iter().enumerate() {
        if remaining < scripts.len() {
            let commitments: Vec<_> = scripts.iter().map(|script| sha256(script)).collect();
            let siblings = entry_tree(&commitments, tree_depth).1[remaining].clone();
            return Ok(WinnerProof {
                global_index,
                shard_index,
                local_index: remaining,
                script_public_key: scripts[remaining].clone(),
                siblings,
            });
        }
        remaining -= scripts.len();
    }
    unreachable!("winner index is bounded by the frozen entry count")
}

fn entry_tree(commitments: &[[u8; 32]], tree_depth: usize) -> ([u8; 32], Vec<Vec<[u8; 32]>>) {
    let capacity = 1usize << tree_depth;
    let empty_leaf = leaf(0x00, [0; 32]);
    let mut level: Vec<_> = commitments
        .iter()
        .map(|commitment| leaf(0x01, *commitment))
        .chain(std::iter::repeat(empty_leaf))
        .take(capacity)
        .collect();
    let mut proofs = vec![Vec::with_capacity(tree_depth); commitments.len()];
    let mut positions: Vec<_> = (0..commitments.len()).collect();

    for _ in 0..tree_depth {
        for (proof, position) in proofs.iter_mut().zip(&positions) {
            proof.push(level[*position ^ 1]);
        }
        for position in &mut positions {
            *position /= 2;
        }
        level = level
            .chunks_exact(2)
            .map(|pair| node(0x02, pair[0], pair[1]))
            .collect();
    }
    (level[0], proofs)
}

fn address_root(commitments: &[[u8; 32]]) -> [u8; 32] {
    let mut empty = Vec::with_capacity(257);
    empty.push(leaf(0x10, [0; 32]));
    for level in 0..256 {
        empty.push(node(0x12, empty[level], empty[level]));
    }
    if commitments.is_empty() {
        return empty[256];
    }

    let mut nodes: BTreeMap<[u8; 32], [u8; 32]> = commitments
        .iter()
        .map(|commitment| (*commitment, leaf(0x11, *commitment)))
        .collect();
    for level in 0..256 {
        let mut parents = BTreeMap::new();
        let mut visited = BTreeSet::new();
        for (position, hash) in &nodes {
            if !visited.insert(*position) {
                continue;
            }
            let mut sibling_position = *position;
            sibling_position[0] ^= 1;
            visited.insert(sibling_position);
            let sibling = nodes
                .get(&sibling_position)
                .copied()
                .unwrap_or(empty[level]);
            let parent_hash = if position[0] & 1 == 0 {
                node(0x12, *hash, sibling)
            } else {
                node(0x12, sibling, *hash)
            };
            parents.insert(shift_right(*position), parent_hash);
        }
        nodes = parents;
    }
    nodes.values().next().copied().unwrap_or(empty[256])
}

fn shift_right(mut value: [u8; 32]) -> [u8; 32] {
    let mut carry = 0u8;
    for byte in value.iter_mut().rev() {
        let next_carry = *byte & 1;
        *byte = (*byte >> 1) | (carry << 7);
        carry = next_carry;
    }
    value
}

fn leaf(domain: u8, value: [u8; 32]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(33);
    preimage.push(domain);
    preimage.extend_from_slice(&value);
    sha256(&preimage)
}

fn node(domain: u8, left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(65);
    preimage.push(domain);
    preimage.extend_from_slice(&left);
    preimage.extend_from_slice(&right);
    sha256(&preimage)
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn decode_fixed_hash(
    value: &str,
    field: &'static str,
) -> Result<[u8; 32], ParticipantCaptureError> {
    decode_hex(value, field)?
        .try_into()
        .map_err(|_| ParticipantCaptureError::Field(field))
}

fn decode_hex(value: &str, field: &'static str) -> Result<Vec<u8>, ParticipantCaptureError> {
    if value.len() % 2 != 0 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ParticipantCaptureError::Field(field));
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text =
                core::str::from_utf8(pair).map_err(|_| ParticipantCaptureError::Field(field))?;
            u8::from_str_radix(text, 16).map_err(|_| ParticipantCaptureError::Field(field))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script_for_shard(shard: usize, start: u16) -> Vec<u8> {
        for marker in start..u16::MAX {
            let script = vec![0, 0, 1, marker as u8];
            if sha256(&script)[0] as usize % 4 == shard {
                return script;
            }
        }
        unreachable!()
    }

    #[test]
    fn builds_and_proves_a_nontrivial_winner() {
        let shards: Vec<Vec<Vec<u8>>> = (0..4)
            .map(|shard| {
                vec![
                    script_for_shard(shard, 0),
                    script_for_shard(shard, 64),
                    script_for_shard(shard, 128),
                ]
            })
            .collect();
        let frozen = build_frozen_participant_set(&shards, 4).unwrap();
        assert_eq!(frozen.entry_count, 12);
        let winner =
            select_winner(&shards, 4, [0x42; 32], frozen.frozen_root, [3; 32], [4; 32]).unwrap();
        assert!(winner.global_index < 12);
        assert_eq!(winner.siblings.len(), 4);
        let commitment = sha256(&winner.script_public_key);
        let mut root = leaf(0x01, commitment);
        let mut path = winner.local_index;
        for sibling in winner.siblings {
            root = if path & 1 == 0 {
                node(0x02, root, sibling)
            } else {
                node(0x02, sibling, root)
            };
            path /= 2;
        }
        assert_eq!(root, frozen.shard_entries_roots[winner.shard_index]);
    }

    #[test]
    fn rejects_duplicate_or_wrong_shard_entries() {
        let first = script_for_shard(0, 0);
        assert_eq!(
            build_frozen_participant_set(&[vec![first.clone()], vec![first]], 4),
            Err(ParticipantTreeError::WrongShard)
        );
        let duplicate = script_for_shard(0, 0);
        assert_eq!(
            build_frozen_participant_set(&[vec![duplicate.clone(), duplicate]], 4),
            Err(ParticipantTreeError::DuplicateCommitment)
        );
    }

    #[test]
    fn distinguishes_empty_sets_from_a_wrong_frozen_root() {
        let empty = vec![Vec::new(), Vec::new(), Vec::new(), Vec::new()];
        let frozen = build_frozen_participant_set(&empty, 4).unwrap();
        assert_eq!(
            select_winner(&empty, 4, [1; 32], frozen.frozen_root, [2; 32], [3; 32]),
            Err(ParticipantTreeError::EmptyParticipantSet)
        );

        let shards: Vec<Vec<Vec<u8>>> = (0..4)
            .map(|shard| vec![script_for_shard(shard, shard as u16 * 32)])
            .collect();
        assert_eq!(
            select_winner(&shards, 4, [1; 32], [9; 32], [2; 32], [3; 32]),
            Err(ParticipantTreeError::FrozenRootMismatch)
        );
    }

    #[test]
    fn decodes_the_shared_participant_fixture() {
        let (giveaway_id, depth, shards) = decode_participant_capture(include_str!(
            "../../../claimable-script/fixtures/giveaway_v6_participants.json"
        ))
        .unwrap();
        assert_eq!(giveaway_id, [0x42; 32]);
        assert_eq!(depth, 4);
        assert_eq!(
            shards.iter().map(Vec::len).collect::<Vec<_>>(),
            [3, 3, 3, 3]
        );
        for script in shards.iter().flatten() {
            assert_eq!(script.len(), 36);
            assert_eq!(&script[..3], &[0x00, 0x00, 0x20]);
            assert_eq!(script[35], 0xac);
            let mut compressed_key = [0u8; 33];
            compressed_key[0] = 0x02;
            compressed_key[1..].copy_from_slice(&script[3..35]);
            assert!(k256::PublicKey::from_sec1_bytes(&compressed_key).is_ok());
        }
        assert_eq!(
            build_frozen_participant_set(&shards, depth)
                .unwrap()
                .entry_count,
            12
        );
    }
}
