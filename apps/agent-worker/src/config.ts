export function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function agentWorkerEnabled(value = process.env.AGENT_WORKER_ENABLED): boolean {
  return value === "true";
}
