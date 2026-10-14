use std::io::{self, Read};

use giveaway_entropy_host::job::{prove_job, ProofJobInput};

const MAX_INPUT_BYTES: u64 = 1_000_000;

fn main() {
    if run().is_err() {
        eprintln!("Giveaway proof job failed validation or proving.");
        std::process::exit(1);
    }
}

fn run() -> Result<(), ()> {
    let mut input = Vec::new();
    io::stdin()
        .take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut input)
        .map_err(|_| ())?;
    if input.len() as u64 > MAX_INPUT_BYTES {
        return Err(());
    }
    let job: ProofJobInput = serde_json::from_slice(&input).map_err(|_| ())?;
    let response = prove_job(&job).map_err(|_| ())?;
    serde_json::to_writer(io::stdout().lock(), &response).map_err(|_| ())?;
    Ok(())
}
