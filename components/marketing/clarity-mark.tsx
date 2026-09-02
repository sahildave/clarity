import Svg, { Circle, Ellipse } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/** Clarity's seven-dot brand mark, traced from the source app-icon artwork. */
export function ClarityMark({ size }: { size: number }) {
  const { colors } = useTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 873 812" accessibilityRole="image">
      {/* These coordinates are the original logo geometry, not layout values. */}
      <Ellipse cx="436.5" cy="81.5" rx="138.5" ry="81.5" fill={colors.marketingInk} />
      <Ellipse cx="436.5" cy="730.5" rx="138.5" ry="81.5" fill={colors.marketingInk} />
      <Ellipse
        cx="728.883"
        cy="264.534"
        rx="138.5"
        ry="81.5"
        transform="rotate(56.9213 728.883 264.534)"
        fill={colors.marketingInk}
      />
      <Ellipse
        cx="143.883"
        cy="569.534"
        rx="138.5"
        ry="81.5"
        transform="rotate(56.9213 143.883 569.534)"
        fill={colors.marketingInk}
      />
      <Ellipse
        cx="143.883"
        cy="264.534"
        rx="138.5"
        ry="81.5"
        transform="rotate(-56.9213 143.883 264.534)"
        fill={colors.marketingInk}
      />
      <Ellipse
        cx="728.883"
        cy="569.534"
        rx="138.5"
        ry="81.5"
        transform="rotate(-56.9213 728.883 569.534)"
        fill={colors.marketingInk}
      />
      <Circle cx="437.5" cy="408.5" r="138.5" fill={colors.marketingInk} />
    </Svg>
  );
}
