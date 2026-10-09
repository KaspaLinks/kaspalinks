use giveaway_entropy_host::reconstruct_giveaway_fixture;

fn main() {
    let fixture = reconstruct_giveaway_fixture(
        include_str!("../../../claimable-script/fixtures/giveaway_v6_mainnet_pair.json"),
        include_str!("../../../claimable-script/fixtures/giveaway_v6_participants.json"),
    )
    .expect("shared Giveaway V6 fixture reconstructs");
    let validated = fixture.entropy.validate().expect("entropy input is valid");

    println!("frozen_root={}", hex(&fixture.frozen.frozen_root));
    println!("entry_count={}", fixture.frozen.entry_count);
    println!("target_blue_score={}", fixture.entropy.target_blue_score);
    println!("parent_hash={}", hex(&validated.parent_hash));
    println!("candidate_hash={}", hex(&validated.candidate_hash));
    println!(
        "candidate_seq_commit={}",
        hex(&validated.candidate_seq_commit)
    );
    println!("winner_global_index={}", fixture.winner.global_index);
    println!("winner_shard={}", fixture.winner.shard_index);
    println!("winner_local_index={}", fixture.winner.local_index);
    println!("winner_spk={}", hex(&fixture.winner.script_public_key));
    for (index, root) in fixture.frozen.shard_entries_roots.iter().enumerate() {
        println!("shard_{index}_entries_root={}", hex(root));
    }
    for (index, root) in fixture.frozen.shard_address_roots.iter().enumerate() {
        println!("shard_{index}_address_root={}", hex(root));
    }
}

fn hex(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").unwrap();
    }
    out
}
