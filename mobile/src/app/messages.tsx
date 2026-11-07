import { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Copy,
  Empty,
  Field,
  Heading,
  Page,
  Notice,
  useTask,
} from "../components/ui";
import { useSession } from "../lib/session";
import { Message } from "../lib/types";
export default function Messages() {
  const { clientId } = useLocalSearchParams<{ clientId?: string }>(),
    session = useSession(),
    task = useTask();
  const [messages, setMessages] = useState<Message[]>([]),
    [body, setBody] = useState("");
  const [loadError, setLoadError] = useState("");
  const allowed =
    session.user?.role === "customer" || (session.operator && !!clientId);
  const load = async () => {
    if (allowed)
      setMessages(
        await session.api<Message[]>(
          "/messages" +
            (clientId ? "?clientId=" + encodeURIComponent(clientId) : ""),
        ),
      );
  };
  const api = session.api;
  useFocusEffect(
    useCallback(() => {
      if (!allowed) return;
      let active = true;
      api<Message[]>(
        "/messages" +
          (clientId ? "?clientId=" + encodeURIComponent(clientId) : ""),
      )
        .then((rows) => {
          if (active) {
            setMessages(rows);
            setLoadError("");
          }
        })
        .catch((e) => {
          if (active) setLoadError(e.message);
        });
      return () => {
        active = false;
      };
    }, [api, allowed, clientId]),
  );
  return (
    <Page title="LET’S\nTALK." back>
      <Notice message={loadError} error />
      {!allowed ? (
        <Empty
          title="Sign in first"
          body="Customer and front-desk accounts can use studio conversations."
        />
      ) : (
        <>
          <Copy muted>
            Messages are shared with the studio. Refresh to see new replies.
          </Copy>
          <Button
            secondary
            title="Refresh conversation"
            disabled={task.busy}
            onPress={() => void task.run(load)}
          />
          {!messages.length && (
            <Empty
              title="Start a conversation"
              body="Questions about your visit? Leave your studio a message."
            />
          )}
          {messages.map((m) => (
            <Card key={m.id}>
              <Heading>
                {m.sender === "studio" ? "Your studio" : "Customer"}
              </Heading>
              <Copy>{m.body}</Copy>
              <Copy muted>{new Date(m.created).toLocaleString()}</Copy>
            </Card>
          ))}
          <Field
            label="Your message"
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={5000}
          />
          <Button
            title="Send message →"
            disabled={task.busy || !body.trim()}
            onPress={() =>
              void task.run(async () => {
                await session.api("/messages", "POST", { body, clientId });
                setBody("");
                await load();
              })
            }
          />
        </>
      )}
      {task.feedback}
    </Page>
  );
}
