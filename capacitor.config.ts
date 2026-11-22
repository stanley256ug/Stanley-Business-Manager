const config = {
  appId: 'com.stanleyprint.businessmanager',
  appName: 'STANLEY BUSINESS MANAGER',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      '*.firebaseapp.com',
      '*.googleapis.com',
      'accounts.google.com',
      'wa.me',
      'api.whatsapp.com',
    ],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0B1D3A',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#0B1D3A',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: true,
      spinnerColor: '#C89B3C',
    },
  },
};

export default config;
