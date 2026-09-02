import { fonts } from './fonts';

/** Native runtime font map, including every face used by the app. */
export const fontAssets = {
  [fonts.regular]: require('@/assets/fonts/SF-Pro-Rounded-Regular.otf'),
  [fonts.medium]: require('@/assets/fonts/SF-Pro-Rounded-Medium.otf'),
  [fonts.semibold]: require('@/assets/fonts/SF-Pro-Rounded-Semibold.otf'),
  [fonts.bold]: require('@/assets/fonts/SF-Pro-Rounded-Bold.otf'),
  [fonts.heavy]: require('@/assets/fonts/SF-Pro-Rounded-Heavy.otf'),
};
