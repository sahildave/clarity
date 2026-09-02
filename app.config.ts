import { ConfigContext, ExpoConfig } from 'expo/config';

// app.json stays the base layer. This file overrides only what varies per app
// variant, so `development`, `preview`, and `production` builds install side by
// side. The variant comes from APP_VARIANT, stored in the EAS environments and
// pulled locally into .env.local by `eas env:pull`.
// `com.schroedernathan.clarity` is permanently unregistrable on this Apple team
// (reserved by a deleted ASC record / foreign team) — hence the `app` suffix.
const BUNDLE_ID = 'com.schroedernathan.clarityapp';

function getBundleId() {
  switch (process.env.APP_VARIANT) {
    case 'production':
      return BUNDLE_ID;
    case 'preview':
      return `${BUNDLE_ID}.preview`;
    default:
      return `${BUNDLE_ID}.dev`;
  }
}

function getName(base: string) {
  switch (process.env.APP_VARIANT) {
    case 'production':
      return base;
    case 'preview':
      return `${base} (Preview)`;
    default:
      return `${base} (Dev)`;
  }
}

function getScheme(base: string) {
  switch (process.env.APP_VARIANT) {
    case 'production':
      return base;
    case 'preview':
      return `${base}.preview`;
    default:
      return `${base}.dev`;
  }
}

// Icon Composer bundles, not flat images. Production returns undefined so the
// app.json icon flows through untouched.
function getIosIcon() {
  switch (process.env.APP_VARIANT) {
    case 'production':
      return undefined;
    case 'preview':
      return './assets/app.preview.icon';
    default:
      return './assets/app.dev.icon';
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosIcon = getIosIcon();
  const baseScheme = typeof config.scheme === 'string' ? config.scheme : 'clarity';
  const easProjectId = (config.extra?.eas as { projectId?: unknown } | undefined)?.projectId;
  const updatesUrl =
    typeof easProjectId === 'string' ? `https://u.expo.dev/${easProjectId}` : config.updates?.url;
  const marketingWeb = process.env.EXPO_MARKETING_WEB === '1';
  const automationBuild = process.env.EXPO_PUBLIC_AUTOMATION === '1';
  const plugins = (config.plugins ?? []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name === 'expo-router' && marketingWeb
      ? (['expo-router', { root: 'web' }] as [string, { root: string }])
      : plugin;
  });

  return {
    ...config,
    slug: config.slug ?? 'clarity',
    name: getName(config.name ?? 'Clarity'),
    scheme: getScheme(baseScheme),
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      ...config.updates,
      // The simulator profile is a deterministic QA fixture. Letting it pull
      // the shared preview channel could replace its development Clerk config
      // and speech mocks with an unrelated preview bundle on the next launch.
      enabled: automationBuild ? false : config.updates?.enabled,
      // Keep the Updates scope tied to extra.eas.projectId. This project was
      // renamed/relinked once; a copied URL silently pointed release builds at
      // the retired project while EAS Build targeted the current one.
      url: updatesUrl,
    },
    experiments: {
      ...config.experiments,
      typedRoutes: marketingWeb ? false : config.experiments?.typedRoutes,
    },
    extra: {
      ...config.extra,
      // Clerk's native Google hook reads these from `expoConfig.extra` first and
      // `process.env` second, because EXPO_PUBLIC_ reads inside node_modules are
      // not inlined in production bundles. Mirroring them here is what makes a
      // release build find them. The URL scheme is read by the
      // @clerk/expo-google-signin config plugin at prebuild.
      EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
      EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID,
      EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME,
    },
    ios: {
      ...config.ios,
      bundleIdentifier: getBundleId(),
      icon: iosIcon ?? config.ios?.icon,
    },
    android: {
      ...config.android,
      package: getBundleId(),
    },
    plugins: [
      ...plugins,
      ['expo-dev-client', { addGeneratedScheme: process.env.APP_VARIANT === 'development' }],
    ],
  };
};
