import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.enertrans.sigf',
  appName: 'Enertrans SIGF',
  webDir: 'dist',
  server: {
    url: 'https://enertrans-sigf.vercel.app',
    cleartext: false,
  },
};

export default config;
