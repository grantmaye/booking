import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Button, Copy, Field, Page, useTask } from "../components/ui";
import { useSession } from "../lib/session";
export default function Waitlist() {
  const p = useLocalSearchParams<{
      location: string;
      professional: string;
      service: string;
      date: string;
    }>(),
    session = useSession(),
    task = useTask();
  const [name, setName] = useState(session.user?.name || ""),
    [email, setEmail] = useState(session.user?.email || ""),
    [date, setDate] = useState(p.date || "");
  return (
    <Page title="NEXT\nIN LINE." back>
      <Copy>
        Join the waitlist for your chosen studio, service and professional. When
        email delivery is configured, the studio can send an offer if a time
        opens.
      </Copy>
      <Field label="Name" value={name} onChangeText={setName} />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Field
        label="Preferred date (YYYY-MM-DD)"
        value={date}
        onChangeText={setDate}
      />
      {task.feedback}
      <Button
        title="Join waitlist →"
        disabled={task.busy || !!task.message}
        onPress={() =>
          void task.run(async () => {
            await session.api("/public/waitlist", "POST", {
              name,
              email,
              date,
              locationId: p.location,
              staffId: p.professional,
              serviceId: p.service,
            });
            task.setMessage("You’re on the list.");
          })
        }
      />
    </Page>
  );
}
