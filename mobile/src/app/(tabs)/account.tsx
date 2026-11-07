import { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import {
  Button,
  Card,
  Chip,
  Copy,
  Field,
  Heading,
  Label,
  Page,
  SignInRequired,
  s,
  useTask,
} from "../../components/ui";
import { useSession } from "../../lib/session";
export default function Account() {
  const { user, portal } = useSession();
  return (
    <AccountForm key={`${user?.id || "guest"}:${portal?.profile.id || ""}`} />
  );
}
function AccountForm() {
  const session = useSession(),
    { user, portal, workspace, staff } = session,
    task = useTask();
  const [name, setName] = useState(portal?.profile.name || ""),
    [phone, setPhone] = useState(portal?.profile.phone || ""),
    [consent, setConsent] = useState(portal?.profile.marketingConsent || false),
    [professional, setProfessional] = useState("");
  return (
    <Page title={staff ? "BEHIND\nTHE CHAIR." : "YOUR\nCORNER."} refresh>
      {user ? (
        <>
          <Card>
            <Label>{user.role}</Label>
            <Heading>{user.name}</Heading>
            <Copy>{user.email}</Copy>
          </Card>
          {portal && (
            <>
              <Heading>Your details</Heading>
              <Field label="Name" value={name} onChangeText={setName} />
              <Field
                label="Phone"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              <Chip
                label={
                  consent ? "Marketing emails: on" : "Marketing emails: off"
                }
                selected={consent}
                onPress={() => setConsent(!consent)}
              />
              <Button
                title="Save profile"
                disabled={task.busy}
                onPress={() =>
                  void task.run(async () => {
                    await session.api("/portal/profile", "PATCH", {
                      name,
                      phone,
                      marketingConsent: consent,
                    });
                    await session.refresh();
                    task.setMessage("Profile updated.");
                  })
                }
              />
              <Card>
                <Label>YOUR REWARDS</Label>
                <Heading>{portal.profile.points} loyalty points</Heading>
                {portal.memberships.length ? (
                  portal.memberships.map((m) => (
                    <Copy key={m.id}>
                      {m.status} membership · {m.credits} credits remaining
                    </Copy>
                  ))
                ) : (
                  <Copy muted>
                    No active memberships yet. Ask your studio about their
                    plans.
                  </Copy>
                )}
              </Card>
              <Button
                secondary
                title="Message your studio →"
                onPress={() => router.push("/messages")}
              />
              <Button
                secondary
                title="Receipts & payments →"
                onPress={() => router.push("/receipts")}
              />
            </>
          )}
          {staff && (
            <Card>
              <Heading>Your shift</Heading>
              <Copy muted>Record when your working day starts and ends.</Copy>
              {user.role !== "staff" && (
                <View style={s.wrap}>
                  {workspace?.staff.map((p) => (
                    <Chip
                      key={p.id}
                      label={p.name}
                      selected={professional === p.id}
                      onPress={() => setProfessional(p.id)}
                    />
                  ))}
                </View>
              )}
              {["in", "out"].map((action) => (
                <Button
                  key={action}
                  secondary={action === "out"}
                  title={`Clock ${action}`}
                  disabled={
                    task.busy || (user.role !== "staff" && !professional)
                  }
                  onPress={() =>
                    void task.run(async () => {
                      await session.api("/timesheets/clock", "POST", {
                        staffId: professional,
                        action,
                      });
                      await session.refresh();
                      task.setMessage(`Clocked ${action}.`);
                    })
                  }
                />
              ))}
            </Card>
          )}
          <Button
            secondary
            title="Sign out"
            disabled={task.busy}
            onPress={() =>
              void task.run(async () => {
                await session.logout();
                router.replace("/");
              })
            }
          />
        </>
      ) : (
        <SignInRequired />
      )}
      {task.feedback}
      <Card>
        <Label>STUDIO CONNECTION</Label>
        <Copy muted>{session.origin || "No studio connected yet"}</Copy>
        <Button
          secondary
          title="Change studio connection"
          onPress={() => router.push("/connection")}
        />
      </Card>
    </Page>
  );
}
