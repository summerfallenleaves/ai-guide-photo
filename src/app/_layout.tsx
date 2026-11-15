import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { loadApiKey } from '@/lib/secure-key';
import { loadSettings } from '@/lib/settings';
import { palette } from '@/lib/theme';

export default function RootLayout() {
  useEffect(() => {
    void loadSettings();
    void loadApiKey();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.bg },
          animation: 'fade',
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="review" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
