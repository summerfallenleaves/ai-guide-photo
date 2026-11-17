import { Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
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
    // 界面固定竖屏:清单里已经锁了,这里再锁一道,避免系统的"自动旋转"把界面转走
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
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
        <Stack.Screen name="probe" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="wb-test" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="history" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
