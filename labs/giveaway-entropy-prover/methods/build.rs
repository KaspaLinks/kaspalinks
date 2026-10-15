use std::collections::HashMap;

use risc0_build::{embed_methods_with_options, DockerOptionsBuilder, GuestOptionsBuilder};

/// The guest is always built inside RISC Zero's pinned builder container.
///
/// A host build embeds the builder's absolute paths, such as its Cargo registry
/// under the user's home directory, into the ELF. The image ID then depends on
/// whose machine compiled it, and the ID pinned in the covenant can be rebuilt
/// only on that one machine. Inside the container every path is fixed, so any
/// machine with Docker reproduces the same binary and the same image ID.
fn main() {
    let docker = DockerOptionsBuilder::default()
        // The workspace root, so the guest's path dependency on `core` is
        // inside the build context.
        .root_dir("..")
        .docker_container_tag("r0.1.88.0")
        .build()
        .expect("guest Docker options are valid");
    let guest = GuestOptionsBuilder::default()
        .use_docker(docker)
        .build()
        .expect("guest build options are valid");
    embed_methods_with_options(HashMap::from([("giveaway-entropy-guest", guest)]));
}
