type TelegramWebApp = {
  close: () => void;
  expand: () => void;
  initData: string;
  ready: () => void;
};

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
