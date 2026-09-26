import { Feather } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'
import { colors } from '@/constants/theme'
import { useSession } from '@/features/session'

export default function TabsLayout() {
  const { address, ready } = useSession()
  if (ready && !address) return <Redirect href="/welcome" />
  const icon = (name: React.ComponentProps<typeof Feather>['name']) =>
    function TabIcon({ color }: { color: string }) {
      return <Feather name={name} size={22} color={color} />
    }
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.lime,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="stake" options={{ title: 'Stake', tabBarIcon: icon('layers') }} />
      <Tabs.Screen name="plan" options={{ title: 'eSIM', tabBarIcon: icon('smartphone') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('user') }} />
    </Tabs>
  )
}
