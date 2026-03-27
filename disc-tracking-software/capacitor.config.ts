import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pro.flightiq',
  appName: 'flight-iq',
  webDir: 'public',
  server: {
    androidScheme: 'https'
  }
};

export default config;
