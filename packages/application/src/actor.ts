export type ActorChannel = "system" | "telegram" | "web";

export type ActorContext = Readonly<{
  channel: ActorChannel;
  creatorId: string;
}>;

export function actorContext(creatorId: string, channel: ActorChannel): ActorContext {
  const normalized = creatorId.trim();
  if (!normalized) {
    throw new Error("ActorContext requires an authenticated creatorId.");
  }
  return Object.freeze({ channel, creatorId: normalized });
}
