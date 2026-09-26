import { Redirect } from 'expo-router'
import { View } from 'react-native'
import { colors } from '@/constants/theme'
import { useSession } from '@/features/session'

export default function Index() {
  const { ready, address } = useSession()
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />
  return <Redirect href={address ? '/(tabs)' : '/welcome'} />
}
