import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Chip,
  Copy,
  Empty,
  Field,
  Heading,
  Page,
  useTask,
} from "../components/ui";
import { useSession } from "../lib/session";
import { when } from "../lib/api";
export default function Client() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useSession();
  return <ClientForm key={`${user?.id}:${id || "new"}`} />;
}
function ClientForm() {
  const { id } = useLocalSearchParams<{ id?: string }>(),
    session = useSession(),
    task = useTask(),
    client = session.workspace?.clients.find((c) => c.id === id);
  const [name, setName] = useState(client?.name || ""),
    [email, setEmail] = useState(client?.email || ""),
    [phone, setPhone] = useState(client?.phone || ""),
    [notes, setNotes] = useState(client?.notes || ""),
    [consent, setConsent] = useState(client?.marketingConsent || false);
  if (!session.staff || (id && !client) || (!id && !session.operator))
    return (
      <Page title="CLIENT\nDETAILS." back>
        <Empty
          title="Not available"
          body="This client is not in your permitted records."
        />
      </Page>
    );
  return (
    <Page title={id ? "GOOD TO\nKNOW YOU." : "WELCOME\nSOMEONE NEW."} back>
      <Field
        label="Full name"
        value={name}
        onChangeText={setName}
        editable={session.operator}
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        editable={session.operator}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Field
        label="Phone"
        value={phone}
        onChangeText={setPhone}
        editable={session.operator}
        keyboardType="phone-pad"
      />
      <Field
        label="Studio notes"
        value={notes}
        onChangeText={setNotes}
        editable={session.operator}
        multiline
      />
      {session.operator && (
        <>
          <Chip
            label={consent ? "Marketing consent: yes" : "Marketing consent: no"}
            selected={consent}
            onPress={() => setConsent(!consent)}
          />
          <Copy muted>
            Only enable marketing when the client has explicitly agreed.
          </Copy>
          <Button
            title="Save client"
            disabled={task.busy}
            onPress={() =>
              void task.run(async () => {
                await session.api(
                  "/records/clients" + (id ? "/" + id : ""),
                  id ? "PATCH" : "POST",
                  {
                    name,
                    email,
                    phone,
                    notes,
                    marketingConsent: consent,
                    points: client?.points || 0,
                  },
                );
                await session.refresh();
                task.setMessage("Client saved.");
                if (!id) router.replace("/clients");
              })
            }
          />
          {id && (
            <Button
              secondary
              title="Conversation →"
              onPress={() =>
                router.push({ pathname: "/messages", params: { clientId: id } })
              }
            />
          )}
        </>
      )}
      {task.feedback}
      {id && (
        <>
          <Heading>Visit history</Heading>
          {session.workspace?.appointments
            .filter((a) => a.client_id === id)
            .sort((a, b) => b.start.localeCompare(a.start))
            .map((a) => (
              <Card key={a.id}>
                <Copy>
                  {when(
                    a.start,
                    session.catalog?.settings.timezone || "America/New_York",
                  )}{" "}
                  · {a.status}
                </Copy>
                <Button
                  secondary
                  title="Open visit"
                  onPress={() =>
                    router.push({
                      pathname: "/appointment",
                      params: { id: a.id },
                    })
                  }
                />
              </Card>
            ))}
        </>
      )}
    </Page>
  );
}
