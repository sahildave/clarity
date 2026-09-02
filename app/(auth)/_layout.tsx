import { Stack } from 'expo-router/stack';

/** The signed-out corridor. One screen today; a stack so a later step (a
 * missing-requirements form, say) can push without restructuring. */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
