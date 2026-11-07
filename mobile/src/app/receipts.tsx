import { useState } from "react";
import {
  Button,
  Card,
  Copy,
  Empty,
  Heading,
  Page,
  useTask,
} from "../components/ui";
import { useSession } from "../lib/session";
import { money } from "../lib/api";
import { openPayment } from "../lib/payments";
export default function Receipts() {
  const session = useSession(),
    task = useTask(),
    [receipt, setReceipt] = useState<{
      total: number;
      tenders: { method: string; amount: number }[];
    } | null>(null);
  return (
    <Page title="ALL\nSQUARED UP." back refresh>
      {!session.portal ? (
        <Empty
          title="Sign in as a customer"
          body="Your receipts and membership billing appear here."
        />
      ) : (
        <>
          {session.portal.orders.length === 0 && (
            <Empty
              title="No receipts yet"
              body="Paid visits and purchases will appear here."
            />
          )}
          {session.portal.orders.map((order) => (
            <Card key={order.id}>
              <Heading>
                {money(order.total, session.catalog?.settings.currency)}
              </Heading>
              <Copy>
                {order.status} · {new Date(order.created).toLocaleDateString()}
              </Copy>
              <Button
                secondary
                title="View receipt"
                disabled={task.busy}
                onPress={() =>
                  void task.run(async () => {
                    setReceipt(
                      await session.api(
                        "/commerce/orders/" + order.id + "/receipt",
                      ),
                    );
                  })
                }
              />
              {order.status === "pending" && (
                <Button
                  title="Pay securely by card"
                  disabled={task.busy}
                  onPress={() =>
                    void task.run(async () => {
                      const link = await session.api<{ url: string }>(
                        "/commerce/orders/" + order.id + "/card",
                        "POST",
                        {},
                      );
                      await openPayment(link.url);
                      await session.refresh();
                    })
                  }
                />
              )}
            </Card>
          ))}
          {session.portal.memberships.map((m) => (
            <Card key={m.id}>
              <Heading>Membership billing</Heading>
              <Copy>
                {m.status} · {m.credits} credits
              </Copy>
              <Button
                secondary
                title="Manage membership"
                disabled={task.busy}
                onPress={() =>
                  void task.run(async () => {
                    const link = await session.api<{ url: string }>(
                      "/membership/portal",
                      "POST",
                      { subscriptionId: m.id },
                    );
                    await openPayment(link.url);
                    await session.refresh();
                  })
                }
              />
            </Card>
          ))}
        </>
      )}
      {receipt && (
        <Card>
          <Heading>
            Receipt · {money(receipt.total, session.catalog?.settings.currency)}
          </Heading>
          {receipt.tenders.map((t, i) => (
            <Copy key={i}>
              {t.method}: {money(t.amount, session.catalog?.settings.currency)}
            </Copy>
          ))}
          <Button
            secondary
            title="Close receipt"
            onPress={() => setReceipt(null)}
          />
        </Card>
      )}
      {task.feedback}
    </Page>
  );
}
