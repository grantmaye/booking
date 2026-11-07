import * as WebBrowser from "expo-web-browser";
export async function openPayment(url: string) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    !["checkout.stripe.com", "billing.stripe.com"].includes(target.hostname)
  )
    throw Error("The studio returned an unrecognized payment address.");
  await WebBrowser.openBrowserAsync(target.href);
}
