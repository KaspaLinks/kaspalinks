use giveaway_entropy_host::{
    entropy_input_from_capture,
    participants::{build_frozen_participant_set, select_winner},
    CapturedEntropyPair,
};
use sha2::{Digest, Sha256};
use std::{fs::OpenOptions, io::Write};

const GIVEAWAY_ID: [u8; 32] = [0x42; 32];
const SHARD_COUNT: usize = 4;
const PARTICIPANTS_PER_SHARD: usize = 3;
const TREE_DEPTH: usize = 4;

fn main() {
    let capture: CapturedEntropyPair = serde_json::from_str(include_str!(
        "../../../claimable-script/fixtures/giveaway_v6_mainnet_pair.json"
    ))
    .expect("Mainnet header capture parses");

    for salt in 0..u64::MAX {
        let shards = generate_shards(salt);
        let frozen = build_frozen_participant_set(&shards, TREE_DEPTH)
            .expect("generated participants match their shards");
        let entropy = entropy_input_from_capture(&capture, GIVEAWAY_ID, frozen.frozen_root)
            .expect("captured headers verify");
        let validated = entropy.validate().expect("entropy input validates");
        let winner = select_winner(
            &shards,
            TREE_DEPTH,
            GIVEAWAY_ID,
            frozen.frozen_root,
            validated.candidate_hash,
            validated.candidate_seq_commit,
        )
        .expect("winner reconstructs");
        if winner.shard_index == 0 || winner.local_index == 0 {
            continue;
        }

        let output = serde_json::json!({
            "giveawayId": hex(&GIVEAWAY_ID),
            "treeDepth": TREE_DEPTH,
            "generatorSalt": salt,
            "shards": shards
                .iter()
                .map(|shard| shard.iter().map(|script| hex(script)).collect::<Vec<_>>())
                .collect::<Vec<_>>(),
        });
        let json = format!("{}\n", serde_json::to_string_pretty(&output).unwrap());
        if let Some(path) = std::env::args().nth(1) {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .expect("output path must not already exist");
            file.write_all(json.as_bytes()).expect("fixture writes");
            println!("{path}");
        } else {
            print!("{json}");
        }
        eprintln!(
            "salt={salt} winner={} shard={} local={}",
            winner.global_index, winner.shard_index, winner.local_index
        );
        return;
    }
    unreachable!("a nontrivial deterministic winner must exist")
}

fn generate_shards(salt: u64) -> Vec<Vec<Vec<u8>>> {
    let mut shards = vec![Vec::new(); SHARD_COUNT];
    for marker in 0u64.. {
        let mut material = Vec::from(b"kaspa-links-v6-public-participant".as_slice());
        material.extend_from_slice(&salt.to_le_bytes());
        material.extend_from_slice(&marker.to_le_bytes());
        let public_material: [u8; 32] = Sha256::digest(&material).into();
        let mut compressed_key = [0u8; 33];
        compressed_key[0] = 0x02;
        compressed_key[1..].copy_from_slice(&public_material);
        if k256::PublicKey::from_sec1_bytes(&compressed_key).is_err() {
            continue;
        }
        let mut script = vec![0x00, 0x00, 0x20];
        script.extend_from_slice(&public_material);
        script.push(0xac);
        let commitment: [u8; 32] = Sha256::digest(&script).into();
        let shard = commitment[0] as usize % SHARD_COUNT;
        if shards[shard].len() < PARTICIPANTS_PER_SHARD {
            shards[shard].push(script);
        }
        if shards
            .iter()
            .all(|entries| entries.len() == PARTICIPANTS_PER_SHARD)
        {
            return shards;
        }
    }
    unreachable!()
}

fn hex(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").unwrap();
    }
    out
}
