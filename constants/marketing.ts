/** Exact layout metrics from the desktop and mobile Paper artboards. */
export const marketing = {
  breakpoints: {
    mobile: 390,
    tablet: 768,
    desktop: 1024,
    wide: 1440,
  },
  width: {
    page: 1200,
    tablet: 720,
    mobile: 350,
    heroCopy: 1040,
    heroTitle: 1000,
    heroBody: 650,
    heroArtwork: 1083,
    sectionTitle: 820,
    sectionBody: 720,
    // SF Pro Rounded is a touch narrower than Paper's system-font preview.
    // This width preserves the artboard's intended three-line wrap.
    mobileHeroBody: 300,
    mobileSectionBody: 340,
    /** Readable measure for the mobile type scale, used once the column
     * outgrows the 350pt phone artboard. Roughly 70 characters at 16pt. */
    compactMeasure: 520,
    // Five cards plus their gaps land inside the 1200pt page on desktop.
    screenshot: 216,
    screenshotMobile: 232,
  },
  height: {
    nav: 88,
    navMobile: 64,
    navCta: 40,
    heroCta: 52,
    heroCtaMobile: 54,
    secondaryCtaMobile: 40,
    featureDesktop: 120,
    featureMobile: 104,
    mobileMenuItem: 40,
  },
  size: {
    navMark: 30,
    navMarkMobile: 26,
    appIcon: 76,
    appIconMark: 58,
    appIconMobile: 64,
    appIconMarkMobile: 48,
    mobileMenu: 44,
    featureIcon: 24,
    actionIcon: 15,
    actionIconMobile: 16,
    metaIcon: 14,
    kickerDot: 8,
  },
  inset: {
    gutter: 20,
    heroTop: 112,
    heroBottom: 80,
    heroTopMobile: 72,
    section: 120,
    sectionMobile: 96,
    navCtaHorizontal: 16,
    heroCtaHorizontal: 22,
  },
  gap: {
    navLinks: 36,
    navWordmark: 8,
    navWordmarkMobile: 10,
    navCta: 10,
    hero: 32,
    heroMobile: 28,
    heroCopy: 24,
    heroCopyMobile: 20,
    heroActions: 24,
    heroActionsMobile: 16,
    heroButton: 12,
    kicker: 8,
    section: 96,
    sectionMobile: 64,
    sectionHeading: 20,
    featureColumns: 32,
    featureRows: 64,
    featureRowsMobile: 48,
    featureIcon: 20,
    featureIconMobile: 16,
    featureCopy: 8,
    screenshots: 20,
    screenshotsMobile: 16,
  },
  radius: {
    appIcon: 24,
  },
  screenshot: {
    /** The 1260 x 2736 App Store frame the shots were exported at. */
    aspect: 1260 / 2736,
  },
  borderWidth: 1,
  iconStrokeWidth: 1.5,
  opacity: {
    disabled: 0.42,
    pressed: 0.68,
  },
  artwork: {
    /** The phone's box in the cutout, read off a percentage grid laid over the
     * file: its body spans 57.3% to 79.2% across and starts 5.5% down. Every
     * value below places the crop from this box, so the phone never lands
     * under a window edge or under the bottom fade. */
    phoneCenterX: 0.6885,
    phoneWidth: 0.219,
    phoneTop: 0.055,
    /** Share of the window width the phone fills, at the mobile and desktop
     * breakpoints, interpolated in between. */
    fillNarrow: 0.62,
    fillWide: 0.293,
    /** Clear space above the phone, as a share of the window width. */
    topInset: 0.06,
    /** The cutout's own ratio, 957 / 617, used when the asset has not measured
     * itself yet. */
    fileAspect: 957 / 617,
    /** Share of the window's height the bottom fade covers, so the cutout's
     * severed wrist stays hidden at every breakpoint. 190 / 698 in the mockup. */
    fadeRatio: 0.272,
    fade:
      'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.18) 28%, rgba(255,255,255,0.72) 70%, #FFFFFF 100%)',
  },
  links: {
    earlyTester: 'https://testflight.apple.com/join/CMRNm4w4',
  },
  layer: {
    menu: 10,
  },
} as const;
