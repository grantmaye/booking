import React, { useEffect, useState } from "react";
import { ScrollView, Share, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Chip,
  Copy,
  Empty,
  Field,
  Heading,
  Label,
  Notice,
  Page,
  s,
  useTask,
} from "../../components/ui";
import { useSession } from "../../lib/session";
import { dateKey, money, when } from "../../lib/api";
import { Appointment, Slot } from "../../lib/types";
export default function Book() {
  const session = useSession();
  const { appointment } = useLocalSearchParams<{ appointment?: string }>();
  if (!session.catalog)
    return (
      <Page title="YOUR NEXT GOOD DAY.">
        <Empty
          title="Connect your studio"
          body="Load your studio’s live services and availability from Account."
        />
        <Button
          title="Connect studio →"
          onPress={() => router.push("/connection")}
        />
      </Page>
    );
  return (
    <BookingForm
      key={`${session.origin}:${session.user?.id || "guest"}:${appointment || "new"}`}
    />
  );
}
function BookingForm() {
  const session = useSession(),
    { catalog, user, staff, workspace, portal } = session;
  const { appointment } = useLocalSearchParams<{ appointment?: string }>();
  const moving = (workspace?.appointments || portal?.appointments || []).find(
    (a) => a.id === appointment,
  );
  const [location, setLocation] = useState(
      moving?.location_id || catalog!.locations[0]?.id || "",
    ),
    [pickedProfessional, setProfessional] = useState(moving?.staff_id || ""),
    [services, setServices] = useState<string[]>(() =>
      moving
        ? JSON.parse(moving.service_ids || JSON.stringify([moving.service_id]))
        : catalog!.services[0]
          ? [catalog!.services[0].id]
          : [],
    ),
    [date, setDate] = useState(() =>
      dateKey(new Date(session.now + 86400000), catalog!.settings.timezone),
    ),
    [chosenSlot, chooseSlot] = useState({ key: "", start: "" });
  const [availability, setAvailability] = useState<{
    key: string;
    rows: Slot[];
    error: string;
  }>({ key: "", rows: [], error: "" });
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [client, setClient] = useState(""),
    [clientSearch, setClientSearch] = useState(""),
    [consent, setConsent] = useState(false),
    [review, setReview] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    start: string;
    manageToken?: string;
  } | null>(null);
  const task = useTask();
  const zone =
    catalog?.locations.find((l) => l.id === location)?.timezone ||
    catalog?.settings.timezone ||
    "America/New_York";
  const availableStaff =
    catalog?.staff
      .filter(
        (p) => p.locationId === location || p.locationIds?.includes(location),
      )
      .filter((p) => user?.role !== "staff" || p.id === user.staffId) || [];
  const professional = availableStaff.some((p) => p.id === pickedProfessional)
    ? pickedProfessional
    : availableStaff[0]?.id || "";
  const serviceKey = services.join(",");
  const query = new URLSearchParams({
    locationId: location,
    staffId: professional,
    serviceId: services[0] || "",
    serviceIds: serviceKey,
    date,
    ...(moving ? { appointmentId: moving.id } : {}),
  }).toString();
  const availabilityKey = session.origin + query;
  const validQuery =
    !!location &&
    !!professional &&
    !!services.length &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);
  const slots = availability.key === availabilityKey ? availability.rows : [];
  const slotsBusy = validQuery && availability.key !== availabilityKey;
  const slotError =
    availability.key === availabilityKey ? availability.error : "";
  const start = chosenSlot.key === availabilityKey ? chosenSlot.start : "";
  const setStart = (value: string) =>
    chooseSlot({ key: availabilityKey, start: value });
  const api = session.api;
  useEffect(() => {
    if (!validQuery) return;
    let active = true;
    api<Slot[]>("/public/availability?" + query)
      .then((rows) => {
        if (active) setAvailability({ key: availabilityKey, rows, error: "" });
      })
      .catch((e) => {
        if (active)
          setAvailability({ key: availabilityKey, rows: [], error: e.message });
      });
    return () => {
      active = false;
    };
  }, [availabilityKey, query, validQuery, api]);
  const amount = services.reduce((sum, id) => {
    const svc = catalog?.services.find((s) => s.id === id);
    return sum + (svc?.locationPrices?.[location] ?? svc?.price ?? 0);
  }, 0);
  const selection = () => ({
    locationId: location,
    staffId: professional,
    serviceId: services[0],
    serviceIds: services,
    start,
  });
  async function confirm() {
    if (!start || !slots.some((s) => s.start === start))
      throw Error("Choose an available time.");
    if (moving) {
      await session.api(
        staff
          ? "/appointments/" + moving.id
          : "/portal/appointments/" + moving.id,
        staff ? "PATCH" : "POST",
        { action: "reschedule", start },
      );
      setResult({ id: moving.id, start });
    } else if (staff) {
      if (!client) throw Error("Choose a client.");
      const rows = await session.api<Appointment[]>("/appointments", "POST", {
        ...selection(),
        clientId: client,
      });
      setResult(rows[0]);
    } else if (user) {
      const row = await session.api<Appointment>(
        "/portal/book",
        "POST",
        selection(),
      );
      setResult(row);
    } else {
      if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email))
        throw Error("Enter your name and a valid email.");
      setResult(
        await session.api("/public/book", "POST", {
          ...selection(),
          name: name.trim(),
          email: email.trim(),
          phone,
          marketingConsent: consent,
        }),
      );
    }
    // Keep the confirmation visible: a refresh must not reset this form.
  }
  if (!catalog)
    return (
      <Page title="YOUR NEXT\nGOOD DAY.">
        <Empty
          title="Connect first"
          body="Connect your studio from Account to load live services and availability."
        />
        <Button
          title="Connect studio →"
          onPress={() => router.push("/connection")}
        />
      </Page>
    );
  if (result)
    return (
      <Page title={moving ? "PLANS\nUPDATED." : "YOU’RE\nBOOKED."}>
        <Card>
          <Label>CONFIRMED</Label>
          <Heading>{when(result.start, zone)}</Heading>
          <Copy>
            {catalog.locations.find((l) => l.id === location)?.name} ·{" "}
            {catalog.staff.find((p) => p.id === professional)?.name}
          </Copy>
          <Copy muted>
            Times shown in {zone}. Cancellation window:{" "}
            {catalog.settings.cancelHours} hours.
          </Copy>
          {result.manageToken && (
            <>
              <Copy>
                Save your private confirmation link to manage this guest
                booking. Anyone with the link can access the appointment.
              </Copy>
              <Button
                title="Save / share confirmation"
                onPress={() =>
                  void task.run(async () => {
                    await Share.share({
                      message: `Your Chairside booking: ${session.origin}/manage#${result.manageToken}`,
                    });
                  })
                }
              />
            </>
          )}
          <Button
            title="View my visits →"
            onPress={() =>
              void task.run(async () => {
                await session.refresh();
                router.replace("/visits");
              })
            }
          />
          <Button
            secondary
            title="Book another visit"
            onPress={() => {
              setResult(null);
              setReview(false);
              chooseSlot({ key: "", start: "" });
              if (moving) router.replace("/book");
            }}
          />
          {task.feedback}
        </Card>
      </Page>
    );
  if (appointment && !moving)
    return (
      <Page title="CHANGE\nYOUR VISIT.">
        <Empty
          title="Appointment unavailable"
          body="Refresh your visits and select an active appointment to reschedule."
        />
        <Button
          title="Back to visits"
          onPress={() => router.replace("/visits")}
        />
      </Page>
    );
  return (
    <Page
      title={moving ? "MAKE\nA LITTLE ROOM." : "TAKE\nYOUR SEAT."}
      back={!!moving}
      kicker={review ? "02 / REVIEW & CONFIRM" : "01 / BUILD YOUR VISIT"}
    >
      {!review ? (
        <>
          {!moving && (
            <>
              <Heading>Choose your studio</Heading>
              <View style={s.wrap}>
                {catalog.locations.map((l) => (
                  <Chip
                    key={l.id}
                    label={l.name}
                    selected={location === l.id}
                    onPress={() => setLocation(l.id)}
                  />
                ))}
              </View>
              <Heading>Your professional</Heading>
              <View style={s.wrap}>
                {availableStaff.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    selected={professional === p.id}
                    onPress={() => setProfessional(p.id)}
                  />
                ))}
              </View>
              <Heading>Make it yours</Heading>
              {catalog.services.map((svc) => (
                <Card key={svc.id}>
                  <View style={s.row}>
                    <View style={{ flex: 1 }}>
                      <Heading>{svc.name}</Heading>
                      <Copy muted>
                        {svc.duration} min ·{" "}
                        {money(
                          svc.locationPrices?.[location] ?? svc.price,
                          catalog.settings.currency,
                        )}
                      </Copy>
                    </View>
                    <Chip
                      label={services.includes(svc.id) ? "Selected ✓" : "Add +"}
                      selected={services.includes(svc.id)}
                      onPress={() =>
                        setServices((old) =>
                          old.includes(svc.id)
                            ? old.filter((id) => id !== svc.id)
                            : [...old, svc.id],
                        )
                      }
                    />
                  </View>
                </Card>
              ))}
            </>
          )}
          <Heading>Find your time</Heading>
          <Copy muted>All times in {zone}</Copy>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {Array.from({ length: 14 }, (_, i) =>
              dateKey(new Date(session.now + i * 86400000), zone),
            ).map((day) => (
              <Chip
                key={day}
                label={day.slice(5)}
                selected={date === day}
                onPress={() => setDate(day)}
              />
            ))}
          </ScrollView>
          <Field
            label="Date (YYYY-MM-DD)"
            value={date}
            onChangeText={setDate}
            autoCapitalize="none"
          />
          {slotsBusy ? (
            <Copy>Finding available times…</Copy>
          ) : (
            <View style={s.wrap}>
              {slots.map((slot) => (
                <Chip
                  key={slot.start}
                  label={new Intl.DateTimeFormat("en-US", {
                    timeZone: zone,
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(slot.start))}
                  selected={start === slot.start}
                  onPress={() => setStart(slot.start)}
                />
              ))}
            </View>
          )}
          <Notice message={slotError} error />
          {!slotsBusy && !slots.length && !slotError && (
            <Empty
              title="No times just yet"
              body="Try another date or professional, or join the waitlist below."
            />
          )}
          {!moving && !staff && (
            <Button
              secondary
              title="Join the waitlist"
              onPress={() =>
                router.push({
                  pathname: "/waitlist",
                  params: {
                    location,
                    professional,
                    service: services[0] || "",
                    date,
                  },
                })
              }
            />
          )}
          {!moving && staff && (
            <>
              <Heading>Who’s visiting?</Heading>
              <Field
                label="Find client"
                value={clientSearch}
                onChangeText={setClientSearch}
                placeholder="Search name or email"
              />
              <View style={s.wrap}>
                {workspace?.clients
                  .filter((c) =>
                    `${c.name} ${c.email}`
                      .toLowerCase()
                      .includes(clientSearch.toLowerCase()),
                  )
                  .slice(0, 25)
                  .map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      selected={client === c.id}
                      onPress={() => setClient(c.id)}
                    />
                  ))}
              </View>
              <Button
                secondary
                title="Add a new client"
                onPress={() => router.push("/client")}
              />
            </>
          )}
          {!user && (
            <>
              <Heading>Your details</Heading>
              <Field
                label="Full name"
                value={name}
                onChangeText={setName}
                autoComplete="name"
              />
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
              <Field
                label="Phone (optional)"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              <Chip
                label={
                  consent
                    ? "Studio offers: opted in ✓"
                    : "Studio offers: opt in"
                }
                selected={consent}
                onPress={() => setConsent(!consent)}
              />
            </>
          )}
          <Button
            title={`Review visit · ${money(amount, catalog.settings.currency)} →`}
            disabled={
              !start ||
              !services.length ||
              task.busy ||
              (staff && !moving && !client)
            }
            onPress={() => setReview(true)}
          />
        </>
      ) : (
        <Card>
          <Heading>
            {services
              .map((id) => catalog.services.find((s) => s.id === id)?.name)
              .join(" + ")}
          </Heading>
          <Copy>{when(start, zone)}</Copy>
          <Copy>
            {catalog.staff.find((s) => s.id === professional)?.name} ·{" "}
            {catalog.locations.find((l) => l.id === location)?.name}
          </Copy>
          <Text style={s.title}>
            {money(amount, catalog.settings.currency)}
          </Text>
          <Copy muted>
            Service price before applicable taxes. Pay at your visit. Cancel at
            least {catalog.settings.cancelHours} hours ahead; paid visits may
            require studio assistance.
          </Copy>
          <Button
            title={moving ? "Confirm new time →" : "Confirm appointment →"}
            disabled={task.busy}
            onPress={() => void task.run(confirm)}
          />
          <Button
            secondary
            title="Edit my visit"
            disabled={task.busy}
            onPress={() => setReview(false)}
          />
        </Card>
      )}
      {task.feedback}
    </Page>
  );
}
