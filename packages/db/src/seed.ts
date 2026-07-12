import "dotenv/config";

import { AuditActorType, ActionType, Network } from "./generated/prisma/enums.ts";
import { createPrismaClient } from "./client.ts";

const prisma = createPrismaClient();
const DEMO_RECIPIENT_ADDRESS =
  "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz";

async function main() {
  const action = await prisma.action.upsert({
    create: {
      amountSompi: 1_000_000_000n,
      description: "Demo Action for local database setup.",
      message: "Thanks for supporting Kaspa Actions.",
      network: Network.TESTNET,
      publicId: "demo-action",
      recipientAddress: DEMO_RECIPIENT_ADDRESS,
      title: "Demo Kaspa Action",
      type: ActionType.KASPA_TIP,
      version: "v1",
    },
    update: {
      description: "Demo Action for local database setup.",
      message: "Thanks for supporting Kaspa Actions.",
      network: Network.TESTNET,
      recipientAddress: DEMO_RECIPIENT_ADDRESS,
      title: "Demo Kaspa Action",
    },
    where: {
      publicId: "demo-action",
    },
  });

  await prisma.auditLog.create({
    data: {
      actionId: action.id,
      actorType: AuditActorType.SYSTEM,
      event: "seed.demo_action_upserted",
      metadata: {
        publicId: action.publicId,
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
