import { Link } from 'expo-router';
import Head from 'expo-router/head';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/ui';
import { marketing, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ClarityMark } from './clarity-mark';

export type LegalSection = {
  heading: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
};

type Props = {
  title: string;
  metaDescription: string;
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
};

/**
 * Long-form text page for the marketing site (privacy policy, support). Shares
 * the landing page's wordmark, canvas, and type ramp so the two read as one site.
 */
export function LegalPage({ title, metaDescription, updated, intro, sections }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const desktop = width >= marketing.breakpoints.desktop;
  const pageWidth = Math.min(
    Math.max(width - marketing.inset.gutter * 2, 0),
    marketing.width.sectionBody,
  );

  return (
    <>
      <Head>
        <title>{`${title} | Clarity`}</title>
        <meta name="description" content={metaDescription} />
      </Head>
      <ScrollView
        style={[styles.page, { backgroundColor: colors.marketingCanvas }]}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}>
        <View style={{ width: pageWidth, gap: desktop ? marketing.gap.section : marketing.gap.sectionMobile }}>
          <Link href="/" asChild>
            <Pressable accessibilityRole="link" style={styles.wordmark}>
              <ClarityMark size={marketing.size.navMark} />
              <ThemedText variant="marketingWordmark" tone="marketingPrimary">
                clarity
              </ThemedText>
            </Pressable>
          </Link>

          <View style={styles.header}>
            <ThemedText
              variant={desktop ? 'marketingSection' : 'marketingSectionMobile'}
              tone="marketingPrimary">
              {title}
            </ThemedText>
            <ThemedText variant="marketingMeta" tone="marketingSecondary">
              Last updated {updated}
            </ThemedText>
            <ThemedText
              variant={desktop ? 'marketingBody' : 'marketingBodyMobile'}
              tone="marketingSecondary">
              {intro}
            </ThemedText>
          </View>

          {sections.map((section) => (
            <View key={section.heading} style={styles.section}>
              <ThemedText
                variant={desktop ? 'marketingFeature' : 'marketingFeatureMobile'}
                tone="marketingPrimary">
                {section.heading}
              </ThemedText>
              {section.paragraphs.map((paragraph) => (
                <ThemedText
                  key={paragraph}
                  variant={desktop ? 'marketingBody' : 'marketingBodyMobile'}
                  tone="marketingSecondary">
                  {paragraph}
                </ThemedText>
              ))}
              {section.bullets?.map((bullet) => (
                <View key={bullet} style={styles.bullet}>
                  <ThemedText
                    variant={desktop ? 'marketingBody' : 'marketingBodyMobile'}
                    tone="marketingSecondary">
                    {'•'}
                  </ThemedText>
                  <ThemedText
                    variant={desktop ? 'marketingBody' : 'marketingBodyMobile'}
                    tone="marketingSecondary"
                    style={styles.bulletText}>
                    {bullet}
                  </ThemedText>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  pageContent: {
    alignItems: 'center',
    paddingBottom: marketing.inset.section,
    paddingTop: spacing.xl,
  },
  wordmark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: marketing.gap.navWordmark,
    height: marketing.height.nav,
  },
  header: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  bullet: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bulletText: {
    flex: 1,
  },
});
