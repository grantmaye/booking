import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSession } from "../../lib/session";
import { C } from "../../components/ui";
export default function Layout() {
  const { staff } = useSession();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.acid,
        tabBarInactiveTintColor: "#C7C9BC",
        tabBarStyle: { backgroundColor: C.ink, borderTopWidth: 0 },
        tabBarLabelStyle: { fontFamily: "Barlow_700Bold", fontSize: 11 },
        tabBarHideOnKeyboard: true,
      }}
    >
      {(
        [
          ["index", "Home", "⌂"],
          ["book", "Book", "＋"],
          ["visits", staff ? "Schedule" : "Visits", "▦"],
          ["clients", "Clients", "◎"],
          ["account", "Account", "≡"],
        ] as const
      ).map(([name, title, icon]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            href: name === "clients" && !staff ? null : undefined,
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: 25 }}>{icon}</Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
