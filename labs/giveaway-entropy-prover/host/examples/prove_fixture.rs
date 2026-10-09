use giveaway_entropy_host::{prove_groth16, reconstruct_giveaway_fixture};
use sha2::{Digest, Sha256};
use std::{fs::OpenOptions, io::Write};

fn main() {
    let output = std::env::args()
        .nth(1)
        .expect("usage: prove_fixture <output.rcpt>");
    let fixture = reconstruct_giveaway_fixture(
        include_str!("../../../claimable-script/fixtures/giveaway_v6_mainnet_pair.json"),
        include_str!("../../../claimable-script/fixtures/giveaway_v6_participants.json"),
    )
    .expect("shared Giveaway V6 fixture reconstructs");
    let info = prove_groth16(&fixture.entropy).expect("Groth16 proof generates and verifies");
    let receipt = info
        .receipt
        .inner
        .groth16()
        .expect("prover returned a Groth16 receipt");
    let bytes = borsh::to_vec(receipt).expect("receipt serializes");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output)
        .expect("output path must not already exist");
    file.write_all(&bytes).expect("receipt writes");

    println!("output={output}");
    println!("receipt_sha256={}", hex(&Sha256::digest(&bytes)));
    println!("frozen_root={}", hex(&fixture.frozen.frozen_root));
    println!("entry_count={}", fixture.frozen.entry_count);
    println!("winner_global_index={}", fixture.winner.global_index);
    println!("winner_shard={}", fixture.winner.shard_index);
    println!("winner_local_index={}", fixture.winner.local_index);
}

fn hex(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").unwrap();
    }
    out
}
