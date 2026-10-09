use giveaway_entropy_core::{EntropyInput, HeaderInput, TOCCATA_BLOCK_VERSION};
use giveaway_entropy_host::groth16_receipt_from_proof_json;

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

fn fixture_input() -> EntropyInput {
    let parent = header(11, 99, [9; 32]);
    let candidate = header(21, 100, parent.hash());
    EntropyInput {
        giveaway_id: [0x42; 32],
        frozen_root: [
            0x18, 0x5c, 0xfb, 0xe5, 0x9d, 0xbb, 0x69, 0x2c, 0xce, 0xcd, 0xa5, 0xef, 0xa0, 0xc1,
            0x84, 0x8f, 0x5c, 0x4b, 0x86, 0x62, 0x79, 0xd6, 0x99, 0xa7, 0x0d, 0x80, 0x9a, 0x62,
            0xd1, 0x94, 0xb5, 0x2b,
        ],
        target_blue_score: 100,
        parent,
        candidate,
    }
}

fn main() {
    let output = std::env::args()
        .nth(1)
        .expect("usage: export_fixture <output.rcpt>");
    let receipt = groth16_receipt_from_proof_json(
        &fixture_input(),
        include_str!("../tests/fixtures/groth16_proof.json"),
    )
    .expect("proof JSON verifies");
    let bytes = borsh::to_vec(&receipt).expect("receipt serializes");
    std::fs::write(&output, bytes).expect("fixture is written");
    println!("wrote {output}");
}
