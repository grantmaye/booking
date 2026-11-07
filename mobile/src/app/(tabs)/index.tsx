import { router } from "expo-router";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  Copy,
  C,
  EmptyAction,
  Heading,
  Label,
  Page,
  s,
} from "../../components/ui";
import { useSession } from "../../lib/session";
import { dateKey, when } from "../../lib/api";
export default function Home() {
  const { user, catalog, workspace, portal, origin, staff, now } = useSession();
  const zone = catalog?.settings.timezone || "America/New_York";
  const all = workspace?.appointments || portal?.appointments || [];
  const upcoming = all
    .filter(
      (a) =>
        ["confirmed", "checked-in"].includes(a.status) &&
        Date.parse(a.end) > now,
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const today = all.filter(
    (a) => dateKey(new Date(a.start), zone) === dateKey(new Date(now), zone),
  );
  return (
    <Page
      title={staff ? "MAKE TODAY\nA GOOD ONE." : "YOUR CHAIR.\nYOUR TIME."}
      kicker={
        user
          ? `WELCOME BACK, ${user.name.split(" ")[0]}`
          : "LOOK GOOD. FEEL LIKE YOURSELF."
      }
      refresh
    >
      <View
        style={{
          backgroundColor: C.acid,
          padding: 24,
          borderWidth: 1,
          borderColor: C.ink,
          gap: 16,
        }}
      >
        <View style={s.row}>
          <Label>
            {staff ? "THE DAILY LINEUP" : "A LITTLE TIME, JUST FOR YOU"}
          </Label>
          <Text style={{ fontSize: 40, fontWeight: "900" }}>↗</Text>
        </View>
        <Text style={[s.title, { fontSize: 70, lineHeight: 70 }]}>
          {staff
            ? String(
                today.filter((a) => a.status !== "cancelled").length,
              ).padStart(2, "0")
            : "TAKE\nYOUR SEAT."}
        </Text>
        <Copy>
          {staff
            ? "Appointments on today’s schedule. Let’s make every visit count."
            : "Great service. Good people. Book your next visit in a few taps."}
        </Copy>
        <Button
          secondary
          title={staff ? "Open schedule →" : "Find my next visit →"}
          onPress={() => router.push(staff ? "/visits" : "/book")}
        />
      </View>
      {!origin && (
        <EmptyAction
          title="Connect your studio"
          body="Your app is ready. Connect it to your Chairside server to see services and availability."
          action="Set up connection →"
          onPress={() => router.push("/connection")}
        />
      )}
      {upcoming[0] && (
        <Card>
          <Label>{staff ? "UP NEXT" : "YOUR NEXT VISIT"}</Label>
          <Heading>
            {catalog?.services.find((s) => s.id === upcoming[0].service_id)
              ?.name || "Appointment"}
          </Heading>
          <Copy>{when(upcoming[0].start, zone)}</Copy>
          <Copy muted>
            {catalog?.staff.find((s) => s.id === upcoming[0].staff_id)?.name} ·{" "}
            {
              catalog?.locations.find((l) => l.id === upcoming[0].location_id)
                ?.name
            }
          </Copy>
          <Button
            secondary
            title="View appointment →"
            onPress={() =>
              router.push({
                pathname: "/appointment",
                params: { id: upcoming[0].id },
              })
            }
          />
        </Card>
      )}
      {staff ? (
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Label>CHECKED IN</Label>
            <Text style={s.title}>
              {today.filter((a) => a.status === "checked-in").length}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Label>COMPLETED</Label>
            <Text style={s.title}>
              {today.filter((a) => a.status === "completed").length}
            </Text>
          </View>
        </View>
      ) : (
        <Card>
          <Heading>
            {catalog?.settings.name || "GOOD PEOPLE. GREAT SERVICE."}
          </Heading>
          <Copy muted>
            {catalog?.locations
              .map((l) => `${l.name} · ${l.address}`)
              .join("\n\n") || "Your studio, always within reach."}
          </Copy>
          {portal && (
            <>
              <Label>LOYALTY POINTS</Label>
              <Text style={s.title}>{portal.profile.points}</Text>
            </>
          )}
        </Card>
      )}
    </Page>
  );
}
