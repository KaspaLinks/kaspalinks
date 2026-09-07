import { headers } from "next/headers";

export default async function GiveawayLabLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      {/* The bridge must be ready before the client reads Telegram authentication.
          Browsers hide nonce attributes; suppress only that known DOM difference. */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script
        src="https://telegram.org/js/telegram-web-app.js?63"
        nonce={nonce}
        suppressHydrationWarning
      />
      {children}
    </>
  );
}
