import Stripe from "stripe";

export const getStripe = (env: CloudflareBindings) =>
  new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });