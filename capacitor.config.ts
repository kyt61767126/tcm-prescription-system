import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tcm.prescription',
  appName: '中医处方系统',
  server: {
    url: 'https://tcm-prescription-system.pages.dev',
    // 仅允许 HTTPS，禁止明文 HTTP 流量，防止中间人攻击
    cleartext: false,
  },
  plugins: {
    Preferences: {
      enabled: true,
    },
    SQLite: {
      enabled: true,
      sqliteEnabled: true,
      iosDatabaseLocation: 'Library/Database',
      androidIsEncryptionEnabled: true,
    },
    Network: {
      enabled: true,
    },
  },
};

export default config;
