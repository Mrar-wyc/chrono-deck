import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zcode.chronodeck',
  appName: '授时局',
  webDir: 'dist',
  android: {
    allowMixedContent: false
  }
};

export default config;
