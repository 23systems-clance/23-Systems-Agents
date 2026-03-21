/**
 * Public billing setup routes (no admin auth).
 *
 * Handles magic link redirect for client payment onboarding.
 * Mounted at /billing/setup in server.ts.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { validateMagicLink } from '../services/billing/magicLinkService.js';
import { config } from '../config/index.js';
import logger from '../lib/logger.js';

export const billingSetupRouter = Router();

/**
 * GET /billing/setup/:token
 * Client-facing magic link redirect.
 */
billingSetupRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const result = await validateMagicLink(req.params.token as string);

    if (!result.valid) {
      if (result.reason === 'expired') {
        res.status(410).send(`
          <!DOCTYPE html>
          <html><head><title>Link Expired</title>
          <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}
          .box{text-align:center;max-width:400px;padding:40px;}.h1{font-size:24px;margin-bottom:16px;}.p{color:#666;}</style></head>
          <body><div class="box"><h1>Link Expired</h1><p>This billing setup link has expired. Please request a new one from your Slack channel.</p></div></body></html>
        `);
        return;
      }
      res.status(404).send(`
        <!DOCTYPE html>
        <html><head><title>Invalid Link</title>
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}
        .box{text-align:center;max-width:400px;padding:40px;}</style></head>
        <body><div class="box"><h1>Invalid Link</h1><p>This link is not valid.</p></div></body></html>
      `);
      return;
    }

    const stripe = new Stripe(config.billing.stripeSecretKey);
    const profile = result.billingProfile;

    if (result.used) {
      // Already used -- redirect to Stripe Customer Portal
      if (profile.stripeCustomerId) {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: profile.stripeCustomerId,
          return_url: config.billing.appBaseUrl,
        });
        res.redirect(303, portalSession.url);
        return;
      }
      res.status(410).send(`
        <!DOCTYPE html>
        <html><head><title>Already Used</title>
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}
        .box{text-align:center;max-width:400px;padding:40px;}</style></head>
        <body><div class="box"><h1>Link Already Used</h1><p>This billing setup link has already been used.</p></div></body></html>
      `);
      return;
    }

    // Valid + not used: Create Stripe Checkout Session (setup mode)
    let customerId = profile.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { billingProfileId: profile.id, slackTeamId: profile.slackTeamId },
      });
      customerId = customer.id;
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      success_url: `${config.billing.appBaseUrl}/billing/setup/success`,
      cancel_url: `${config.billing.appBaseUrl}/billing/setup/cancelled`,
      metadata: { billingProfileId: profile.id },
    });

    res.redirect(303, checkoutSession.url!);
  } catch (error) {
    logger.error('Magic link redirect error', { token: req.params.token, error });
    res.status(500).send(`
      <!DOCTYPE html>
      <html><head><title>Error</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}
      .box{text-align:center;max-width:400px;padding:40px;}</style></head>
      <body><div class="box"><h1>Something Went Wrong</h1><p>Please try again or contact support.</p></div></body></html>
    `);
  }
});
