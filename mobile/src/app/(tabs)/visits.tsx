import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Card,
  Chip,
  Copy,
  Empty,
  Field,
  Heading,
  Label,
  Page,
  SignInRequired,
  s,
} from "../../components/ui";
import { useSession } from "../../lib/session";
import { dateKey, when } from "../../lib/api";
export default function Visits() {
  const { user, staff, catalog, workspace, portal, now } = useSession();
  const zone = catalog?.settings.timezone || "America/New_York";
  const [date, setDate] = useState(dateKey(new Date(now), zone)),
    [filter, setFilter] = useState("upcoming"),
    [professional, setProfessional] = useState("all");
  const all = workspace?.appointments || portal?.appointments || [];
  const rows = all
    .filter((a) =>
      staff
        ? dateKey(
            new Date(a.start),
            catalog?.locations.find((l) => l.id === a.location_id)?.timezone ||
              zone,
          ) === date &&
          (professional === "all" || a.staff_id === professional)
        : filter === "history"
          ? Date.parse(a.end) < now ||
            ["cancelled", "completed", "no-show"].includes(a.status)
          : Date.parse(a.end) >= now &&
            ["confirmed", "checked-in"].includes(a.status),
    )
    .sort((a, b) =>
      filter === "history" && !staff
        ? b.start.localeCompare(a.start)
        : a.start.localeCompare(b.start),
    );
  return (
    <Page
      title={staff ? "THE\nDAILY LINEUP." : "GOOD DAYS,\nON THE BOOKS."}
      refresh
    >
      {!user ? (
        <SignInRequired />
      ) : (
        <>
          {staff ? (
            <>
              <Field
                label="Schedule date (YYYY-MM-DD)"
                value={date}
                onChangeText={setDate}
              />
              <Copy muted>
                Each visit is grouped by its studio’s local date.
              </Copy>
              <View style={s.wrap}>
                <Chip
                  label="Everyone"
                  selected={professional === "all"}
                  onPress={() => setProfessional("all")}
                />
                {workspace?.staff.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    selected={professional === p.id}
                    onPress={() => setProfessional(p.id)}
                  />
                ))}
              </View>
            </>
          ) : (
            <View style={s.wrap}>
              {["upcoming", "history"].map((f) => (
                <Chip
                  key={f}
                  label={f.toUpperCase()}
                  selected={filter === f}
                  onPress={() => setFilter(f)}
                />
              ))}
            </View>
          )}
          <Button title="Book a visit +" onPress={() => router.push("/book")} />
          {!rows.length && (
            <Empty
              title="Room for a good day"
              body={
                staff
                  ? "No appointments match this date and professional."
                  : "Your appointments will appear here after you book while signed in."
              }
            />
          )}
          {rows.map((a) => (
            <Card key={a.id}>
              <Label>{a.status.replace("-", " ")}</Label>
              <Heading>
                {staff
                  ? workspace?.clients.find((c) => c.id === a.client_id)
                      ?.name || "Client"
                  : catalog?.services.find((s) => s.id === a.service_id)
                      ?.name || "Visit"}
              </Heading>
              <Copy>
                {when(
                  a.start,
                  catalog?.locations.find((l) => l.id === a.location_id)
                    ?.timezone || zone,
                )}
              </Copy>
              <Copy muted>
                {catalog?.staff.find((s) => s.id === a.staff_id)?.name} ·{" "}
                {catalog?.locations.find((l) => l.id === a.location_id)?.name}
              </Copy>
              <Button
                secondary
                title="View visit →"
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
