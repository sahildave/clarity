import { LegalPage, type LegalSection } from '@/components/marketing/legal-page';

const SECTIONS: readonly LegalSection[] = [
  {
    heading: 'Contact',
    paragraphs: [
      'Email schroedernathan2011@icloud.com. Include your device model, iOS version, and what you were doing when the problem happened.',
    ],
  },
  {
    heading: 'Clarity did not hear me',
    paragraphs: ['Check these in order.'],
    bullets: [
      'Open Settings > Clarity on your device and confirm Microphone and Speech Recognition are on.',
      'Speak within arm’s length of the device and away from background noise.',
      'Speech recognition needs a network connection the first time a language is used.',
    ],
  },
  {
    heading: 'My score looks wrong',
    paragraphs: [
      'Your reading is scored against the accent you picked during onboarding. If you picked one you do not speak, change it in Settings > Your accent. Sessions under a few seconds are not scored but still count toward your streak.',
    ],
  },
  {
    heading: 'Clarity Pro and purchases',
    paragraphs: [
      'Clarity Pro is an auto-renewing subscription billed through your Apple ID. To restore a purchase on a new device, open the paywall and tap Restore purchase. To change or cancel a plan, tap the crown in the app header, or use your App Store account settings.',
    ],
  },
  {
    heading: 'Delete my account',
    paragraphs: [
      'Open Settings > Account > Delete account. This removes your account and all stored data and cannot be undone. See the Privacy Policy at clarityspeech.app/privacy for what is stored.',
    ],
  },
];

export default function SupportPage() {
  return (
    <LegalPage
      title="Support"
      metaDescription="Get help with Clarity: microphone problems, scores, subscriptions, and account deletion."
      updated="August 27, 2026"
      intro="Answers to the common questions, and how to reach the developer."
      sections={SECTIONS}
    />
  );
}
