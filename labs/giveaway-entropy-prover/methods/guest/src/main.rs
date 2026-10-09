#![no_main]
#![no_std]

use giveaway_entropy_core::EntropyInput;
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: EntropyInput = env::read();
    let journal = input
        .journal()
        .expect("invalid Kaspa first-crossing entropy input");
    env::commit_slice(&journal);
}
