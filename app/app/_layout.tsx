import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'
import { colors } from '@/constants/theme'
import { ZeroConfigProvider } from '@/features/config'
import { SessionProvider } from '@/features/session'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ZeroConfigProvider>
        <SessionProvider>
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="welcome" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="how-it-works" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
          <StatusBar style="light" />
        </SessionProvider>
      </ZeroConfigProvider>
    </QueryClientProvider>
  )
}
