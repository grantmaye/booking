import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Copy,
  Empty,
  Heading,
  Label,
  Page,
  useTask,
} from "../components/ui";
import { useSession } from "../lib/session";
import { when, money } from "../lib/api";
export default function Appointment() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    session = useSession(),
    task = useTask(),
    [confirm, setConfirm] = useState("");
  const { catalog, workspace, portal, staff, user, operator } = session;
  const a = (workspace?.appointments || portal?.appointments || []).find(
    (a) => a.id === id,
  );
  async function act() {
    if (!a) return;
    await session.api(
      staff ? "/appointments/" + a.id : "/portal/appointments/" + a.id,
      staff ? "PATCH" : "POST",
      staff ? { status: confirm } : { action: "cancel" },
    );
    setConfirm("");
    await session.refresh();
    task.setMessage("Appointment updated.");
  }
  if (!a)
    return (
      <Page title="YOUR VISIT." back>
        <Empty
          title="Visit unavailable"
          body="Sign in and refresh your visits to see appointments you can access."
        />
      </Page>
    );
  const active = ["confirmed", "checked-in"].includes(a.status),
    zone =
      catalog?.locations.find((l) => l.id === a.location_id)?.timezone ||
      catalog?.settings.timezone ||
      "America/New_York";
  return (
    <Page title="A LITTLE\nTIME FOR YOU." back refresh>
      <Card>
        <Label>{a.status.replace("-", " ")}</Label>
        <Heading>
          {catalog?.services.find((s) => s.id === a.service_id)?.name ||
            "Appointment"}
        </Heading>
        <Copy>{when(a.start, zone)}</Copy>
        <Copy muted>{zone}</Copy>
        <Copy>
          {catalog?.staff.find((s) => s.id === a.staff_id)?.name} ·{" "}
          {catalog?.locations.find((l) => l.id === a.location_id)?.name}
        </Copy>
        <Copy>Service total: {money(a.price, catalog?.settings.currency)}</Copy>
        {staff && (
          <>
            <Copy>
              Client:{" "}
              {workspace?.clients.find((c) => c.id === a.client_id)?.name}
            </Copy>
            <Button
              secondary
              title="Client details →"
              onPress={() =>
                router.push({
                  pathname: "/client",
                  params: { id: a.client_id },
                })
              }
            />
          </>
        )}
      </Card>
      {active && (
        <>
          <Button
            title="Reschedule visit →"
            disabled={task.busy}
            onPress={() =>
              router.push({
                pathname: "/reschedule",
                params: { appointment: a.id },
              })
            }
          />
          {staff && a.status === "confirmed" && (
            <Button
              secondary
              title="Check in client"
              onPress={() => setConfirm("checked-in")}
            />
          )}
          {operator && (
            <Button
              title="Checkout & receipt →"
              onPress={() =>
                router.push({ pathname: "/checkout", params: { id: a.id } })
              }
            />
          )}
          {staff && (
            <Button
              secondary
              title="Complete paid visit"
              onPress={() => setConfirm("completed")}
            />
          )}
          <Button
            secondary
            title="Cancel appointment"
            onPress={() => setConfirm("cancelled")}
          />
          {staff && (
            <Button
              secondary
              title="Mark as no-show"
              onPress={() => setConfirm("no-show")}
            />
          )}
        </>
      )}
      {confirm && (
        <Card>
          <Heading>Confirm {confirm.replace("-", " ")}?</Heading>
          <Copy>
            {confirm === "cancelled"
              ? `This releases the appointment time. Customers must give ${catalog?.settings.cancelHours} hours’ notice; payment restrictions still apply.`
              : confirm === "completed"
                ? "The server requires a paid order before completing this visit."
                : "This updates the shared studio schedule immediately."}
          </Copy>
          <Button
            title="Confirm change"
            danger={confirm === "cancelled"}
            disabled={task.busy}
            onPress={() => void task.run(act)}
          />
          <Button
            secondary
            title="Keep as is"
            disabled={task.busy}
            onPress={() => setConfirm("")}
          />
        </Card>
      )}
      {!staff && user && (
        <Button
          secondary
          title="Message studio →"
          onPress={() => router.push("/messages")}
        />
      )}{" "}
      {task.feedback}
    </Page>
  );
}
