import { useState } from "react";
import { router } from "expo-router";
import {
  Button,
  Card,
  Copy,
  Empty,
  Field,
  Heading,
  Page,
  SignInRequired,
} from "../../components/ui";
import { useSession } from "../../lib/session";
export default function Clients() {
  const { staff, workspace, operator } = useSession(),
    [search, setSearch] = useState("");
  const clients =
    workspace?.clients.filter((c) =>
      `${c.name} ${c.email} ${c.phone || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  return (
    <Page title="GOOD\nCOMPANY." refresh>
      {!staff ? (
        <SignInRequired staff />
      ) : (
        <>
          <Field
            label="Find a client"
            placeholder="Name, email or phone"
            value={search}
            onChangeText={setSearch}
          />
          {operator && (
            <Button
              title="Add client +"
              onPress={() => router.push("/client")}
            />
          )}
          <Copy muted>{clients.length} clients in your permitted records</Copy>
          {!clients.length && (
            <Empty
              title="No matching clients"
              body="Try another search. Professionals see only clients linked to their appointments."
            />
          )}
          {clients.map((c) => (
            <Card key={c.id}>
              <Heading>{c.name}</Heading>
              <Copy muted>{c.email}</Copy>
              <Button
                secondary
                title="Client details →"
                onPress={() =>
                  router.push({ pathname: "/client", params: { id: c.id } })
                }
              />
            </Card>
          ))}
        </>
      )}
    </Page>
  );
}
