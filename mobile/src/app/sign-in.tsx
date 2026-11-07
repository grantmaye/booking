import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Button, Chip, Copy, Field, Page, s, useTask } from "../components/ui";
import { useSession } from "../lib/session";
export default function SignIn() {
  const { login, api, origin } = useSession(),
    task = useTask();
  const [mode, setMode] = useState("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [name, setName] = useState("");
  async function submit() {
    if (!origin) throw Error("Connect to a studio first.");
    if (mode === "login") {
      await login(email, password, code);
      setPassword("");
      router.replace("/");
    } else {
      const result = await api<{ message: string }>(
        mode === "register" ? "/public/register" : "/public/recover",
        "POST",
        { name, email: email.trim(), password },
      );
      setPassword("");
      task.setMessage(result.message);
    }
  }
  return (
    <Page title="WELCOME\nTO YOUR CHAIR." back>
      <View style={s.wrap}>
        {[
          ["login", "Sign in"],
          ["register", "Create account"],
          ["recover", "Reset password"],
        ].map(([m, label]) => (
          <Chip
            key={m}
            label={label}
            selected={mode === m}
            onPress={() => setMode(m)}
          />
        ))}
      </View>
      <Copy muted>
        {mode === "login"
          ? "Customers and crew use the same sign-in. Your account determines what you can access."
          : mode === "register"
            ? "Create a customer account. Verify your email before signing in."
            : "We’ll send a recovery link when email delivery is configured."}
      </Copy>
      {mode === "register" && (
        <Field
          label="Full name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
        />
      )}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      {mode !== "recover" && (
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={
            mode === "register" ? "new-password" : "current-password"
          }
        />
      )}{" "}
      {mode === "login" && (
        <Field
          label="Authenticator code (if enabled)"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
        />
      )}
      {task.feedback}
      <Button
        title={
          mode === "login"
            ? "Let me in →"
            : mode === "register"
              ? "Create my account →"
              : "Send recovery link →"
        }
        disabled={task.busy || !email || (mode !== "recover" && !password)}
        onPress={() => void task.run(submit)}
      />
      <Button
        secondary
        title="Studio connection"
        onPress={() => router.push("/connection")}
      />
    </Page>
  );
}
