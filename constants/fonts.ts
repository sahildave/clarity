/** SF Pro Rounded — the app-wide typeface, loaded at runtime in the root
 * layout. Use these families instead of `fontWeight`: each entry is a single
 * face, and pairing a face with a mismatched fontWeight makes iOS synthesize
 * or fall back to the system font. */
export const fonts = {
  regular: 'SFProRounded-Regular',
  medium: 'SFProRounded-Medium',
  semibold: 'SFProRounded-Semibold',
  bold: 'SFProRounded-Bold',
  heavy: 'SFProRounded-Heavy',
} as const;
