use giveaway_entropy_core::{EntropyInput, HeaderInput, ValidationError, TOCCATA_BLOCK_VERSION};
use giveaway_entropy_host::{
    groth16_receipt_from_proof_json, image_id, prove, prove_groth16, ProverError,
};

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

#[test]
fn image_id_is_pinned() {
    assert_eq!(
        hex(&image_id()),
        "a402f88f9b89afd2eb5e5f6cdc96f67af2ff4d4da70e1e6a4767a99c26b692b1"
    );
}

#[test]
fn invalid_input_never_reaches_the_prover() {
    let mut input = valid_input();
    input.candidate.parents_by_level[0][0] = [7; 32];
    assert!(matches!(
        prove(&input),
        Err(ProverError::InvalidInput(
            ValidationError::WrongSelectedParent
        ))
    ));
}

#[test]
fn produces_and_verifies_a_real_receipt() {
    let input = valid_input();
    let info = prove(&input).expect("proof must be generated and verified");
    assert_eq!(info.receipt.journal.bytes, input.journal().unwrap());
}

#[test]
#[ignore = "requires Docker for RISC Zero Groth16 compression"]
fn produces_and_verifies_a_groth16_receipt() {
    let input = valid_input();
    let info = prove_groth16(&input).expect("Groth16 proof must be generated and verified");
    assert!(info.receipt.inner.groth16().is_ok());
    assert_eq!(info.receipt.journal.bytes, input.journal().unwrap());
}

#[test]
fn verifies_the_pinned_groth16_fixture() {
    let receipt = groth16_receipt_from_proof_json(
        &valid_input(),
        include_str!("fixtures/groth16_proof.json"),
    )
    .expect("fixture must attest the exact guest claim");
    assert_eq!(receipt.seal.len(), 256);
}

#[test]
fn pinned_proof_cannot_be_rebound_to_another_frozen_root() {
    let mut input = valid_input();
    input.frozen_root[0] ^= 1;
    assert!(matches!(
        groth16_receipt_from_proof_json(&input, include_str!("fixtures/groth16_proof.json"),),
        Err(ProverError::Verification(_))
    ));
}

fn hex(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").unwrap();
    }
    out
}
