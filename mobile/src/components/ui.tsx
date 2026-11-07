import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useSession } from "../lib/session";
export const C = {
  ink: "#171916",
  paper: "#F2F1E9",
  white: "#FFFEF8",
  acid: "#DBFF00",
  muted: "#62665B",
  line: "#D2D3C9",
  red: "#A42219",
};
export const s = StyleSheet.create({
  text: {
    fontFamily: "Barlow_500Medium",
    fontSize: 16,
    lineHeight: 23,
    color: C.ink,
  },
  title: {
    fontFamily: "BarlowCondensed_800ExtraBold",
    fontSize: 54,
    lineHeight: 52,
    color: C.ink,
    textTransform: "uppercase",
  },
  h2: {
    fontFamily: "BarlowCondensed_800ExtraBold",
    fontSize: 30,
    lineHeight: 32,
    color: C.ink,
    textTransform: "uppercase",
  },
  eyebrow: {
    fontFamily: "Barlow_700Bold",
    fontSize: 11,
    letterSpacing: 2,
    color: C.muted,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.ink,
    padding: 20,
    gap: 12,
  },
  muted: { color: C.muted },
});
export function Copy({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return <Text style={[s.text, muted && s.muted]}>{children}</Text>;
}
export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.eyebrow}>{children}</Text>;
}
export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.h2}>
      {children}
    </Text>
  );
}
export function Card({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <View style={[s.card, dark && { backgroundColor: C.ink }]}>{children}</View>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: secondary ? C.white : danger ? C.red : C.acid,
        borderWidth: 1,
        borderColor: C.ink,
        minHeight: 52,
        paddingHorizontal: 18,
        paddingVertical: 14,
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          fontFamily: "Barlow_700Bold",
          fontSize: 15,
          color: danger && !secondary ? C.white : C.ink,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: selected ? C.ink : C.line,
        backgroundColor: selected ? C.ink : C.white,
        paddingHorizontal: 15,
        paddingVertical: 13,
        minHeight: 48,
      }}
    >
      <Text
        style={[s.text, { color: selected ? C.acid : C.ink, fontSize: 14 }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 7 }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={C.muted}
        {...props}
        style={[
          {
            minHeight: 52,
            borderWidth: 1,
            borderColor: C.line,
            backgroundColor: C.white,
            padding: 14,
            fontFamily: "Barlow_500Medium",
            fontSize: 16,
            color: C.ink,
          },
          props.multiline && { minHeight: 100, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Notice({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: 15,
        backgroundColor: error ? "#FBE9E5" : C.acid,
        borderLeftWidth: 4,
        borderLeftColor: error ? C.red : C.ink,
      }}
    >
      <Text style={[s.text, { color: error ? C.red : C.ink }]}>{message}</Text>
    </View>
  );
}
export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <Heading>{title}</Heading>
      <Copy muted>{body}</Copy>
    </Card>
  );
}
export function Page({
  title,
  kicker = "CHAIRSIDE / MOBILE",
  children,
  refresh = false,
  back = false,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  refresh?: boolean;
  back?: boolean;
}) {
  const session = useSession();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: C.paper }}
      edges={["top", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 22,
            gap: 22,
            paddingBottom: 40,
            width: "100%",
            maxWidth: 740,
            alignSelf: "center",
          }}
          refreshControl={
            refresh ? (
              <RefreshControl
                refreshing={session.loading}
                onRefresh={() => void session.refresh()}
                tintColor={C.ink}
              />
            ) : undefined
          }
        >
          <View style={s.row}>
            <Text
              style={{
                fontFamily: "BarlowCondensed_800ExtraBold",
                fontSize: 25,
                letterSpacing: 1,
              }}
            >
              CHAIRSIDE<Text style={{ color: C.muted }}>®</Text>
            </Text>
            <View style={{ backgroundColor: C.acid, padding: 8 }}>
              <Label>{session.staff ? "STUDIO CREW" : "GOOD DAYS AHEAD"}</Label>
            </View>
          </View>
          {back && (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/")
              }
            >
              <Copy>← Back</Copy>
            </Pressable>
          )}
          <View style={{ gap: 10 }}>
            <Label>{kicker}</Label>
            <Text accessibilityRole="header" style={s.title}>
              {title.replace(/\\n/g, "\n")}
            </Text>
          </View>
          {session.error && refresh ? (
            <Notice message={session.error} error />
          ) : null}
          {children}
          <Text style={[s.eyebrow, { marginTop: 18 }]}>
            GOOD BUSINESS. BETTER DAYS.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function useTask() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    message,
    setMessage,
    run,
    feedback: (
      <>
        {busy && <ActivityIndicator color={C.ink} />}
        <Notice message={error} error />
        <Notice message={message} />
      </>
    ),
  };
}
export function SignInRequired({ staff = false }: { staff?: boolean }) {
  return (
    <EmptyAction
      title={staff ? "Your studio, in hand." : "Your next good day."}
      body={
        staff
          ? "Sign in with your staff account to access your schedule and clients."
          : "Sign in to see your visits, rewards and studio messages."
      }
      action="Sign in →"
      onPress={() => router.push("/sign-in")}
    />
  );
}
export function EmptyAction({
  title,
  body,
  action,
  onPress,
}: {
  title: string;
  body: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <Card>
      <Heading>{title}</Heading>
      <Copy muted>{body}</Copy>
      <Button title={action} onPress={onPress} />
    </Card>
  );
}
