import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { BarlowCondensed_800ExtraBold } from "@expo-google-fonts/barlow-condensed/800ExtraBold";
import { Barlow_500Medium } from "@expo-google-fonts/barlow/500Medium";
import { Barlow_700Bold } from "@expo-google-fonts/barlow/700Bold";
import { ActivityIndicator, View } from "react-native";
import { SessionProvider } from "../lib/session";
import { C } from "../components/ui";
export default function Root() {
  const [loaded, error] = useFonts({
    BarlowCondensed_800ExtraBold,
    Barlow_500Medium,
    Barlow_700Bold,
  });
  if (!loaded && !error)
    return (
      <View
        style={{ flex: 1, backgroundColor: C.paper, justifyContent: "center" }}
      >
        <ActivityIndicator color={C.ink} />
      </View>
    );
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: C.paper },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" options={{ presentation: "modal" }} />
        <Stack.Screen name="connection" options={{ presentation: "modal" }} />
      </Stack>
    </SessionProvider>
  );
}
