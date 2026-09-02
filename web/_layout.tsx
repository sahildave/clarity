import { useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import { Platform, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { fontAssets, spacing } from '@/constants/theme';

// `web/` is the marketing site's router root, selected by EXPO_MARKETING_WEB=1
// (the `web` and `export:web` scripts). That flag switches the root for *every*
// platform the dev server bundles for, not just web — so a native client that
// attaches to the marketing dev server loads the landing page instead of the
// app. Say so instead of silently rendering a website in the app.
const NATIVE_ON_MARKETING_ROOT = Platform.OS !== 'web';

function WrongRootNotice() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}>
      <ThemedText variant="title">Marketing dev server</ThemedText>
      <ThemedText variant="body" tone="secondary">
        This bundle came from the site server (EXPO_MARKETING_WEB=1), which serves the
        `web` router root to every platform. Attach the app to the server started by
        `expo start` instead.
      </ThemedText>
    </View>
  );
}

export default function WebRootLayout() {
  const [fontsReady, fontError] = useFonts(fontAssets);

  if (!fontsReady && !fontError) return null;

  return (
    <View style={{ flex: 1 }}>{NATIVE_ON_MARKETING_ROOT ? <WrongRootNotice /> : <Slot />}</View>
  );
}
