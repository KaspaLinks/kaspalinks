type TelegramBackButton = {
  hide: () => void;
  offClick: (callback: () => void) => void;
  onClick: (callback: () => void) => void;
  show: () => void;
};

type TelegramWebApp = {
  BackButton?: TelegramBackButton;
  platform?: string;
  isVersionAtLeast?: (version: string) => boolean;
  initDataUnsafe?: { start_param?: string };
  shareMessage?: (id: string, callback?: (success: boolean) => void) => void;
  openTelegramLink?: (url: string) => void;
  close: () => void;
  expand: () => void;
  initData: string;
  ready: () => void;
};

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
