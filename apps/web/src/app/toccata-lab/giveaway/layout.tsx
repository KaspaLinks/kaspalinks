import Script from "next/script";

export default function GiveawayLabLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js?63" strategy="beforeInteractive" />
      {children}
    </>
  );
}
