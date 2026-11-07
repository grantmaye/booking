import { useState } from "react";
import { router } from "expo-router";
import {
  Button,
  Card,
  Copy,
  Field,
  Heading,
  Page,
  useTask,
} from "../components/ui";
import { useSession } from "../lib/session";
export default function Connection() {
  const session = useSession(),
    [address, setAddress] = useState(session.origin),
    task = useTask();
  return (
    <Page title="FIND YOUR\nSTUDIO." back>
      <Copy>
        Enter the server address provided by your studio. Changing studios signs
        you out and clears the previous studio’s records from this app.
      </Copy>
      <Field
        label="Studio server address"
        placeholder="https://booking.yourstudio.com"
        autoCapitalize="none"
        keyboardType="url"
        value={address}
        onChangeText={setAddress}
      />
      {task.feedback}
      <Button
        title="Connect studio →"
        disabled={task.busy || !address}
        onPress={() =>
          void task.run(async () => {
            await session.connect(address);
            router.replace("/");
          })
        }
      />
      {__DEV__ && (
        <Card>
          <Heading>Local development</Heading>
          <Copy>iPhone simulator: http://127.0.0.1:3002</Copy>
          <Copy>Android emulator: http://10.0.2.2:3002</Copy>
          <Copy>
            A physical phone needs your computer’s LAN address and the local
            mobile demo server on the same Wi-Fi network. This does not publish
            your app.
          </Copy>
        </Card>
      )}
    </Page>
  );
}
