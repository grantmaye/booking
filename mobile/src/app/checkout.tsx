import { useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  Button,
  Card,
  Copy,
  Empty,
  Field,
  Heading,
  Label,
  Page,
  useTask,
} from "../components/ui";
import { useSession } from "../lib/session";
import { money } from "../lib/api";
import { openPayment } from "../lib/payments";
import { Order } from "../lib/types";
type Receipt = Order & {
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  stripe_session?: string;
  tenders?: { method: string; amount: number }[];
};
export default function Checkout() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    session = useSession(),
    task = useTask(),
    [tip, setTip] = useState("0"),
    [order, setOrder] = useState<Receipt | null>(null),
    [cash, setCash] = useState(false),
    key = useRef(randomUUID());
  const a = session.workspace?.appointments.find((a) => a.id === id),
    currency = session.catalog?.settings.currency || "USD";
  async function refresh() {
    if (order)
      setOrder(
        await session.api<Receipt>("/commerce/orders/" + order.id + "/receipt"),
      );
    await session.refresh();
  }
  async function prepare() {
    const existing = await session.api<{ order: Receipt | null }>(
      "/mobile/appointments/" + id + "/order",
    );
    const found = existing.order;
    if (found) {
      setOrder(found);
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(tip))
      throw Error("Enter a valid tip amount with up to two decimal places.");
    setOrder(
      await session.api<Receipt>(
        "/commerce/orders",
        "POST",
        { appointmentId: id, tip: Math.round(Number(tip) * 100) },
        key.current,
      ),
    );
  }
  return (
    <Page title="WRAP UP\nA GOOD VISIT." back>
      {!session.operator || !a ? (
        <Empty
          title="Checkout unavailable"
          body="Sign in with an owner, manager or receptionist account and select a visit."
        />
      ) : (
        <>
          {!order ? (
            <Card>
              <Heading>Review checkout</Heading>
              <Copy>
                {
                  session.workspace?.clients.find((c) => c.id === a.client_id)
                    ?.name
                }
              </Copy>
              <Copy>Service: {money(a.price, currency)}</Copy>
              <Field
                label="Tip amount"
                value={tip}
                onChangeText={setTip}
                keyboardType="decimal-pad"
              />
              <Copy muted>
                Review the final total, including any taxes and credits, before
                collecting payment.
              </Copy>
              <Button
                title="Prepare order →"
                disabled={task.busy}
                onPress={() => void task.run(prepare)}
              />
            </Card>
          ) : (
            <Card>
              <Label>{order.status}</Label>
              <Heading>Total · {money(order.total, currency)}</Heading>
              <Copy>
                Subtotal: {money(order.subtotal, currency)}
                {`\n`}Discount: {money(order.discount, currency)}
                {`\n`}Tax: {money(order.tax, currency)}
                {`\n`}Tip: {money(order.tip, currency)}
              </Copy>
              {order.tenders?.map((t, i) => (
                <Copy key={i}>
                  {t.method}: {money(t.amount, currency)}
                </Copy>
              ))}
              {order.status === "pending" && (
                <>
                  <Button
                    title="Open secure card checkout →"
                    disabled={task.busy}
                    onPress={() =>
                      void task.run(async () => {
                        const r = await session.api<{ url: string }>(
                          "/commerce/orders/" + order.id + "/card",
                          "POST",
                          {},
                        );
                        await openPayment(r.url);
                        await refresh();
                      })
                    }
                  />
                  <Button
                    secondary
                    title="Record cash payment"
                    disabled={task.busy || !!order.stripe_session}
                    onPress={() => setCash(true)}
                  />
                  <Copy muted>
                    Card status updates only after the payment provider confirms
                    it. Return here and refresh after paying.
                  </Copy>
                </>
              )}
              {cash && order.status === "pending" && (
                <>
                  <Copy>
                    Confirm you received {money(order.total, currency)} in cash.
                  </Copy>
                  <Button
                    title="Confirm cash received"
                    disabled={task.busy}
                    onPress={() =>
                      void task.run(async () => {
                        await session.api(
                          "/commerce/orders/" + order.id + "/pay",
                          "POST",
                          {
                            tenders: [{ method: "cash", amount: order.total }],
                          },
                        );
                        setCash(false);
                        await refresh();
                      })
                    }
                  />
                  <Button
                    secondary
                    title="Back"
                    onPress={() => setCash(false)}
                  />
                </>
              )}
              {order.status === "paid" &&
                ["confirmed", "checked-in"].includes(a.status) && (
                  <Button
                    title="Complete visit"
                    disabled={task.busy}
                    onPress={() =>
                      void task.run(async () => {
                        await session.api("/appointments/" + id, "PATCH", {
                          status: "completed",
                        });
                        await refresh();
                        task.setMessage("Visit completed.");
                      })
                    }
                  />
                )}
              <Button
                secondary
                title="Refresh receipt & status"
                disabled={task.busy}
                onPress={() => void task.run(refresh)}
              />
            </Card>
          )}
        </>
      )}
      {task.feedback}
    </Page>
  );
}
